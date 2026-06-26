// OpenStreetMap Overpass API ラッパー
// Overpass はパブリックインスタンスを利用、シードは1回だけ&ローカル CLI 想定
// 公開ミラーを順番にフォールバック(レート制限・UA ブロック対策)
//
// #F6 — Overpass timeout の設定根拠:
//   公式ミラー(overpass-api.de 等)は連続リクエストや大きな空間クエリで一時 ban をかける。
//   timeout は「Overpass サーバー側の最大処理時間」の宣言であり、DB ロック解放のヒントになる。
//   大きいほど大規模クエリを完走させやすいが、スロット消費が長くなるため適切に使い分ける:
//     90 s  — bbox 単体の推定施設(カテゴリ別、狭域)
//     120 s — bbox 単体のトイレ(全 type、ミラー先が遅いケースを考慮して余裕を持たせる)
//     180 s — 都道府県全域クエリ(ISO3166-2 境界使用、広域のため大きめに設定)
//   これらは経験的な推奨値であり、ミラーのキャパシティ次第で変わる可能性がある。

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT =
  "toilet-map-seed/1.0 (+https://github.com/Uzu83/toilet-map)";

export type OsmToiletNode = {
  osmId: number;
  lat: number;
  lng: number;
  name: string | null;
  hasWashlet: boolean | null;
  hasPaper: boolean | null;
  hasSoap: boolean | null;
  hasDiaperTable: boolean | null;
  isUniversal: boolean | null;
  openingHours: string | null;
  source: "osm" | "inferred";
  inferredAccess: "open" | "ask" | "permission" | null;
};

// 推定青ピン候補: 漏らすUXを起こさない確実な施設のみ
// (コンビニ・ファストフードは customer-only 慣例の例外多発のため対象外)
export type InferredCategory = {
  key: string;
  label: string;
  // Overpass クエリの本体(node|way|relation を全部対象)
  selectors: string[];
  inferredAccess: "open" | "ask" | "permission";
  // ピンの代表名にどの tag を使うか(優先順)
  nameKeys: string[];
};

export const INFERRED_CATEGORIES: InferredCategory[] = [
  {
    key: "station",
    label: "駅",
    selectors: ['["railway"="station"]', '["public_transport"="station"]'],
    inferredAccess: "open",
    nameKeys: ["name:ja", "name"],
  },
  {
    key: "mall",
    label: "ショッピングモール・百貨店",
    selectors: ['["shop"="mall"]', '["shop"="department_store"]'],
    inferredAccess: "open",
    nameKeys: ["name:ja", "name"],
  },
  {
    key: "civic",
    label: "公民館・図書館・市民施設",
    selectors: [
      '["amenity"="community_centre"]',
      '["amenity"="library"]',
      '["amenity"="townhall"]',
    ],
    inferredAccess: "open",
    nameKeys: ["name:ja", "name"],
  },
  {
    key: "tourism",
    label: "観光案内所",
    selectors: ['["tourism"="information"]["information"="office"]'],
    inferredAccess: "open",
    nameKeys: ["name:ja", "name"],
  },
];

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number }; // way / relation の代表座標
  tags?: Record<string, string>;
};

// #12 — osm_id オフセット方式の根拠:
//   OSM のノード/ウェイ/リレーションは各型内でユニークだが型をまたいで id が重複する。
//   DB の `toilets.osm_id` は upsert の conflict key のため、型が違っても同じ id だと
//   誤って上書きされる(例: node 12345 と way 12345 を別エントリとして保持できない)。
//   オフセットで型ごとに数値空間を分離して衝突を防ぐ:
//     node:     [0,       1e12)  — そのまま
//     way:      [1e12,    2e12)  — + 1_000_000_000_000
//     relation: [2e12,    3e12)  — + 2_000_000_000_000
//   OSM の実 id は 2026 年時点で way が ~10億、relation が ~1億程度なので
//   1e12 オフセットで重複しない(node も同様に ~10億程度)。
//   範囲が将来溢れる可能性はほぼないが、万一に備えてここを唯一の定義箇所にして変更を一箇所で吸収する。
function osmIdPrefix(type: OverpassElement["type"]): number {
  if (type === "way") return 1_000_000_000_000;
  if (type === "relation") return 2_000_000_000_000;
  return 0; // node
}

// #12 + #23 — 推定青ピンの共通マッピング(Prefecture / Bbox の 2 つの inferred 関数で使う)。
// wheelchair は三値: yes=true, no=false, それ以外/未指定=null。
// #23 修正前は tags.wheelchair==="yes" ? true : null の 2-way だったため、
//   明示的に "no" とタグされた施設(例: バリアフリー非対応の市民会館)が null になり
//   「情報なし」扱いになっていた。"no" を false に落とすことで実態通り「対応不可」として記録する。
function mapInferredElements(
  elements: OverpassElement[],
  cat: InferredCategory,
): OsmToiletNode[] {
  const result: OsmToiletNode[] = [];
  for (const el of elements) {
    const coords = elementCoords(el);
    if (!coords) continue;
    const tags = el.tags ?? {};
    const wc = tags.wheelchair;
    result.push({
      osmId: osmIdPrefix(el.type) + el.id,
      lat: coords.lat,
      lng: coords.lng,
      name: pickName(tags, cat.nameKeys) ?? `(${cat.label})`,
      hasWashlet: null,
      hasPaper: null,
      hasSoap: null,
      hasDiaperTable: null,
      // three-way: yes→true, no→false, 未定義/その他→null
      isUniversal: wc === "yes" ? true : wc === "no" ? false : null,
      openingHours: tags["opening_hours"] ?? null,
      source: "inferred",
      inferredAccess: cat.inferredAccess,
    });
  }
  return result;
}

function tagBool(tags: Record<string, string> | undefined, key: string): boolean | null {
  const v = tags?.[key];
  if (v == null) return null;
  if (["yes", "1", "true"].includes(v)) return true;
  if (["no", "0", "false"].includes(v)) return false;
  return null;
}

async function postOverpass(query: string): Promise<{ elements: OverpassElement[] }> {
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        const text = await res.text();
        errors.push(`${endpoint} -> ${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      return (await res.json()) as { elements: OverpassElement[] };
    } catch (err) {
      errors.push(`${endpoint} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Overpass API 全ミラー失敗:\n${errors.join("\n")}`);
}

function pickName(tags: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    if (tags[k]) return tags[k]!;
  }
  return null;
}

function elementCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

function mapToiletElements(elements: OverpassElement[]): OsmToiletNode[] {
  return elements
    .filter((el) => el.type === "node" || el.center)
    .map((el): OsmToiletNode | null => {
      const coords = elementCoords(el);
      if (!coords) return null;
      const tags = el.tags ?? {};
      const wheelchair = tags.wheelchair;
      return {
        osmId: osmIdPrefix(el.type) + el.id, // #12 — 共通ヘルパに集約
        lat: coords.lat,
        lng: coords.lng,
        name: pickName(tags, ["name:ja", "name"]),
        hasWashlet: tagBool(tags, "toilets:washbasin") ?? tagBool(tags, "washlet"),
        hasPaper: tagBool(tags, "toilets:paper_supplied"),
        hasSoap: tagBool(tags, "toilets:hand_washing") ?? tagBool(tags, "soap"),
        hasDiaperTable:
          tagBool(tags, "changing_table") ?? tagBool(tags, "diaper"),
        isUniversal:
          wheelchair === "yes" ? true : wheelchair === "no" ? false : null,
        openingHours: tags["opening_hours"] ?? null,
        source: "osm",
        inferredAccess: null,
      };
    })
    .filter((n): n is OsmToiletNode => n !== null);
}

export async function fetchToiletsInBbox(
  bbox: [number, number, number, number]
): Promise<OsmToiletNode[]> {
  const [s, w, n, e] = bbox;
  // #22 — node 単体では「トイレとして登録されたビル(way)や関係(relation)」が取れない。
  //   --bbox / --region シードでは node しか拾えず、way/relation の公衆トイレが無音で欠落していた。
  //   fetchToiletsInPrefecture と同様に node+way+relation を union してから `out center` で
  //   座標を取る。`out center` が必須なのは way/relation がノード座標を持たず center を
  //   Overpass に計算させる必要があるため。mapToiletElements は el.center を既にハンドルする。
  const query = `[out:json][timeout:120];(
  node["amenity"="toilets"](${s},${w},${n},${e});
  way["amenity"="toilets"](${s},${w},${n},${e});
  relation["amenity"="toilets"](${s},${w},${n},${e});
);
out center;`;
  const json = await postOverpass(query);
  return mapToiletElements(json.elements);
}

// ISO 3166-2:JP コード(例: "JP-13")の都道府県境界内の amenity=toilets を取得。
// node / way / relation すべて対象、way/relation は center 座標で代表点を取る。
export async function fetchToiletsInPrefecture(iso3166_2: string): Promise<OsmToiletNode[]> {
  const query = `[out:json][timeout:180];
area["ISO3166-2"="${iso3166_2}"]->.a;
(
  node["amenity"="toilets"](area.a);
  way["amenity"="toilets"](area.a);
  relation["amenity"="toilets"](area.a);
);
out center;`;
  const json = await postOverpass(query);
  return mapToiletElements(json.elements);
}

export async function fetchInferredFacilitiesInPrefecture(
  iso3166_2: string
): Promise<OsmToiletNode[]> {
  const all: OsmToiletNode[] = [];
  for (const cat of INFERRED_CATEGORIES) {
    const selectorQueries = cat.selectors.flatMap((sel) => [
      `node${sel}(area.a)`,
      `way${sel}(area.a)`,
      `relation${sel}(area.a)`,
    ]);
    const query = `[out:json][timeout:180];
area["ISO3166-2"="${iso3166_2}"]->.a;
(${selectorQueries.join(";")};);
out center;`;
    const json = await postOverpass(query);
    // #12 + #23 — 共通 mapInferredElements で wheelchair 三値化込みで変換
    all.push(...mapInferredElements(json.elements, cat));
  }
  return all;
}

export async function fetchInferredFacilities(
  bbox: [number, number, number, number]
): Promise<OsmToiletNode[]> {
  const [s, w, n, e] = bbox;
  const all: OsmToiletNode[] = [];
  for (const cat of INFERRED_CATEGORIES) {
    const selectorQueries = cat.selectors.flatMap((sel) => [
      `node${sel}(${s},${w},${n},${e})`,
      `way${sel}(${s},${w},${n},${e})`,
      `relation${sel}(${s},${w},${n},${e})`,
    ]);
    // #F6 — timeout:90 は bbox(狭域)クエリ向け設定(ファイル先頭コメント参照)
    const query = `[out:json][timeout:90];(${selectorQueries.join(";")};);out center;`;
    const json = await postOverpass(query);
    // #12 + #23 — 共通 mapInferredElements で osmIdPrefix + wheelchair 三値化込みで変換。
    // 同座標の重複(amenity=toilets と駅の代表点が同じ等)はそのまま入れて DB の osm_id でユニーク制御。
    all.push(...mapInferredElements(json.elements, cat));
  }
  return all;
}
