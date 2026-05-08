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
};

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

function tagBool(tags: Record<string, string> | undefined, key: string): boolean | null {
  const v = tags?.[key];
  if (v == null) return null;
  if (["yes", "1", "true"].includes(v)) return true;
  if (["no", "0", "false"].includes(v)) return false;
  return null;
}

async function postOverpass(query: string): Promise<{ elements: OverpassNode[] }> {
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
      return (await res.json()) as { elements: OverpassNode[] };
    } catch (err) {
      errors.push(`${endpoint} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Overpass API 全ミラー失敗:\n${errors.join("\n")}`);
}

export async function fetchToiletsInBbox(
  bbox: [number, number, number, number]
): Promise<OsmToiletNode[]> {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:90];node["amenity"="toilets"](${s},${w},${n},${e});out;`;
  const json = await postOverpass(query);
  return json.elements
    .filter((el) => el.type === "node")
    .map((el) => {
      const tags = el.tags ?? {};
      const wheelchair = tags.wheelchair;
      return {
        osmId: el.id,
        lat: el.lat,
        lng: el.lon,
        name: tags.name ?? tags["name:ja"] ?? null,
        hasWashlet: tagBool(tags, "toilets:washbasin") ?? tagBool(tags, "washlet"),
        hasPaper: tagBool(tags, "toilets:paper_supplied"),
        hasSoap: tagBool(tags, "toilets:hand_washing") ?? tagBool(tags, "soap"),
        hasDiaperTable:
          tagBool(tags, "changing_table") ?? tagBool(tags, "diaper"),
        isUniversal:
          wheelchair === "yes" ? true : wheelchair === "no" ? false : null,
      };
    });
}
