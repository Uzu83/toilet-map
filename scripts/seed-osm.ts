// OSM (OpenStreetMap) のトイレデータを Supabase に投入するシードスクリプト
//
// 使い方(ローカル CLI):
//   npm run seed                          # デフォルト = 福岡市の amenity=toilets
//   npm run seed -- --region tokyo-23     # プリセット指定
//   npm run seed -- --bbox 33.5,130.3,33.7,130.5
//   npm run seed -- --regions fukuoka-pref,tokyo-23  # 複数連続
//   npm run seed -- --inferred            # 駅・モール・公共施設を「推定青ピン」で追加投入
//   npm run seed -- --inferred-only       # 推定のみ(amenity=toilets はスキップ)
//
// 必要な環境変数(.env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SECRET_KEY

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  fetchToiletsInBbox,
  fetchInferredFacilities,
  type OsmToiletNode,
} from "../src/lib/osm";
import { findRegion, REGIONS, type Region } from "../src/lib/regions";

// 簡易 .env.local ローダ(dotenv 依存しないため)
// 仕様: 引用符なしの値は `<空白>#` 以降をコメントとして剥がし trim、
//       引用符 ("..." または '...') 内では # を文字として保持
function loadDotenv(path: string) {
  try {
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      const dq = val.startsWith('"');
      const sq = val.startsWith("'");
      if (dq || sq) {
        const quote = dq ? '"' : "'";
        const end = val.indexOf(quote, 1);
        val = end > 0 ? val.slice(1, end) : val.slice(1);
      } else {
        // 引用符なし: 空白+# 以降のインラインコメントを除去
        const commentMatch = val.match(/\s+#.*$/);
        if (commentMatch) val = val.slice(0, commentMatch.index);
        val = val.trim();
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ファイルがなければ無視
  }
}

loadDotenv(resolve(process.cwd(), ".env.local"));

type Args = {
  regions: Region[];
  bbox: [number, number, number, number] | null;
  includeToilets: boolean;
  includeInferred: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    regions: [],
    bbox: null,
    includeToilets: true,
    includeInferred: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region") {
      const r = findRegion(argv[++i] ?? "");
      if (r) out.regions.push(r);
    } else if (a === "--regions") {
      for (const k of (argv[++i] ?? "").split(",")) {
        const r = findRegion(k.trim());
        if (r) out.regions.push(r);
      }
    } else if (a === "--bbox") {
      const parts = (argv[++i] ?? "").split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        out.bbox = parts as [number, number, number, number];
      }
    } else if (a === "--inferred") {
      out.includeInferred = true;
    } else if (a === "--inferred-only") {
      out.includeInferred = true;
      out.includeToilets = false;
    } else if (a === "--list") {
      console.log("利用可能なリージョン:");
      for (const r of REGIONS) console.log(`  ${r.key.padEnd(16)} ${r.label}`);
      process.exit(0);
    }
  }
  if (out.regions.length === 0 && !out.bbox) {
    out.regions.push(findRegion("fukuoka-city")!);
  }
  return out;
}

async function upsertNodes(nodes: OsmToiletNode[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY を .env.local に設定してください");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // PostGIS の geography point を入れる WKT 形式
  const rows = nodes.map((n) => ({
    osm_id: n.osmId,
    name: n.name,
    location: `SRID=4326;POINT(${n.lng} ${n.lat})`,
    has_washlet: n.hasWashlet,
    has_paper: n.hasPaper,
    has_soap: n.hasSoap,
    has_diaper_table: n.hasDiaperTable,
    is_universal: n.isUniversal,
    source: n.source,
    inferred_access: n.inferredAccess,
    opening_hours: n.openingHours,
  }));

  // 大量挿入時は 500 件ずつバッチ
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("toilets")
      .upsert(batch, { onConflict: "osm_id", count: "exact" });
    if (error) throw error;
    upserted += count ?? batch.length;
    process.stdout.write(`  …${upserted}/${rows.length} 投入\r`);
  }
  console.log(`\n  ✓ ${upserted} 件を upsert しました`);
}

async function seedOne(
  label: string,
  bbox: [number, number, number, number],
  args: Args
) {
  console.log(`\n▶ ${label}: bbox=${bbox.join(",")}`);

  if (args.includeToilets) {
    console.log("  [amenity=toilets] Overpass 取得中…");
    const nodes = await fetchToiletsInBbox(bbox);
    console.log(`    ✓ ${nodes.length} 件取得`);
    if (nodes.length > 0) {
      console.log("    Supabase に upsert 中…");
      await upsertNodes(nodes);
    }
  }

  if (args.includeInferred) {
    console.log("  [推定青ピン: 駅/モール/公共施設/観光案内] Overpass 取得中…");
    const inferred = await fetchInferredFacilities(bbox);
    console.log(`    ✓ ${inferred.length} 件取得`);
    if (inferred.length > 0) {
      console.log("    Supabase に upsert 中…");
      await upsertNodes(inferred);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.bbox) {
    await seedOne(`カスタム範囲`, args.bbox, args);
  }
  for (const r of args.regions) {
    await seedOne(r.label, r.bbox, args);
  }
  console.log("\n🎉 シード完了");
}

main().catch((err) => {
  console.error("\n❌ シード失敗:", err);
  process.exit(1);
});
