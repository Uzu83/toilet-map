// OSM (OpenStreetMap) のトイレデータを Supabase に投入するシードスクリプト
//
// 使い方(ローカル CLI):
//   npm run seed                          # デフォルト = 福岡市の amenity=toilets
//   npm run seed -- --region tokyo-23     # 市区プリセット指定
//   npm run seed -- --bbox 33.5,130.3,33.7,130.5
//   npm run seed -- --regions fukuoka-pref,tokyo-23  # 複数連続
//   npm run seed -- --inferred            # 駅・モール・公共施設を「推定青ピン」で追加投入
//   npm run seed -- --inferred-only       # 推定のみ(amenity=toilets はスキップ)
//   npm run seed -- --prefecture JP-13    # 都道府県境界で取得(ISO 3166-2:JP コード)
//   npm run seed -- --all-japan           # 47都道府県を順次取得(全国一括、Phase 0 方針)
//   npm run seed -- --all-japan --inferred  # 全国 + 推定青ピンも(時間かかる)
//   npm run seed -- --list                # 市区プリセット一覧
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
  fetchToiletsInPrefecture,
  fetchInferredFacilitiesInPrefecture,
  type OsmToiletNode,
} from "../src/lib/osm";
import {
  findRegion,
  findPrefecture,
  REGIONS,
  JP_PREFECTURES,
  type Region,
  type Prefecture,
} from "../src/lib/regions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  prefectures: Prefecture[];
  bbox: [number, number, number, number] | null;
  allJapan: boolean;
  includeToilets: boolean;
  includeInferred: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    regions: [],
    prefectures: [],
    bbox: null,
    allJapan: false,
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
    } else if (a === "--prefecture") {
      const p = findPrefecture(argv[++i] ?? "");
      if (p) out.prefectures.push(p);
    } else if (a === "--all-japan") {
      out.allJapan = true;
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
      console.log("市区プリセット:");
      for (const r of REGIONS) console.log(`  ${r.key.padEnd(16)} ${r.label}`);
      console.log("\n都道府県(--prefecture <code>):");
      for (const p of JP_PREFECTURES) console.log(`  ${p.code}  ${p.label}`);
      process.exit(0);
    }
  }
  if (
    out.regions.length === 0 &&
    out.prefectures.length === 0 &&
    !out.bbox &&
    !out.allJapan
  ) {
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

async function seedPrefecture(pref: Prefecture, args: Args) {
  console.log(`\n▶ ${pref.label} (${pref.code})`);
  if (args.includeToilets) {
    console.log("  [amenity=toilets] Overpass 取得中…");
    const nodes = await fetchToiletsInPrefecture(pref.code);
    console.log(`    ✓ ${nodes.length} 件取得`);
    if (nodes.length > 0) {
      console.log("    Supabase に upsert 中…");
      await upsertNodes(nodes);
    }
  }
  if (args.includeInferred) {
    console.log("  [推定青ピン: 駅/モール/公共施設/観光案内] Overpass 取得中…");
    const inferred = await fetchInferredFacilitiesInPrefecture(pref.code);
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
  for (const p of args.prefectures) {
    await seedPrefecture(p, args);
    // #F5 — 2000ms 待機: 複数都道府県を --regions で連続指定した場合に Overpass ミラーへの
    //   連続リクエストを緩和する。公式ミラーは短時間の連続大型クエリで一時 ban をかけることがある。
    //   2 秒は「ミラーへの負荷を下げながらシード時間を許容範囲に保つ」バランス値。
    await sleep(2000);
  }
  if (args.allJapan) {
    console.log(`\n🗾 全国モード: 47都道府県を順次取得します(Overpass レート制限のため間に待機を入れます)`);
    let i = 0;
    for (const p of JP_PREFECTURES) {
      i++;
      console.log(`\n[${i}/47] ──────────────`);
      try {
        await seedPrefecture(p, args);
      } catch (e) {
        console.error(`  ⚠️ ${p.label} 失敗(スキップして続行):`, e instanceof Error ? e.message : e);
      }
      // #F5 — 3000ms 待機: --all-japan は 47 都道府県を順に叩くため、連続 47 クエリになる。
      //   2000ms でも可だが、全国モードは特に大量であるため 3 秒に増やして ban リスクをさらに下げる。
      //   最終県の後は不要なので i < length のガードを入れる(余分な待機を避ける)。
      if (i < JP_PREFECTURES.length) await sleep(3000);
    }
  }
  console.log("\n🎉 シード完了");
}

main().catch((err) => {
  console.error("\n❌ シード失敗:", err);
  process.exit(1);
});
