// OpenStreetMap Overpass API ラッパー
// Overpass はパブリックインスタンスを利用、シードは1回だけ&ローカル CLI 想定
// 公開ミラーを順番にフォールバック(レート制限・UA ブロック対策)

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT =
  "toilet-map-seed/1.0 (https://github.com/uzu83/toilet-map; tosagiken.info@gmail.com)";

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

export async function fetchToiletsInBbox(
  bbox: [number, number, number, number]
): Promise<OsmToiletNode[]> {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:90];node["amenity"="toilets"](${s},${w},${n},${e});out;`;
  const json = await postOverpass(query);
  return json.elements
    .filter((el) => el.type === "node")
    .map((el): OsmToiletNode | null => {
      const coords = elementCoords(el);
      if (!coords) return null;
      const tags = el.tags ?? {};
      const wheelchair = tags.wheelchair;
      return {
        osmId: el.id,
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
    const query = `[out:json][timeout:90];(${selectorQueries.join(";")};);out center;`;
    const json = await postOverpass(query);
    for (const el of json.elements) {
      const coords = elementCoords(el);
      if (!coords) continue;
      const tags = el.tags ?? {};
      // OSM 上の単一ノードでも node + way + relation 同 ID で重複しうるため、type prefix で衝突回避
      const idPrefix =
        el.type === "way" ? 1_000_000_000_000 : el.type === "relation" ? 2_000_000_000_000 : 0;
      all.push({
        osmId: idPrefix + el.id,
        lat: coords.lat,
        lng: coords.lng,
        name: pickName(tags, cat.nameKeys) ?? `(${cat.label})`,
        hasWashlet: null,
        hasPaper: null,
        hasSoap: null,
        hasDiaperTable: null,
        isUniversal: tags.wheelchair === "yes" ? true : null,
        openingHours: tags["opening_hours"] ?? null,
        source: "inferred",
        inferredAccess: cat.inferredAccess,
      });
    }
  }
  // 同座標の重複(amenity=toilets と駅の代表点が同じ等)はそのまま入れて DB の osm_id でユニーク制御
  return all;
}
