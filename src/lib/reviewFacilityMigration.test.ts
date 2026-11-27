import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 20261127213301 の SQL を文字列で見る。行ロックやデッドロック自体は live smoke でしか確かめられないので、
// ここでは「書き換えない」「ロック順」「ファイル名の重複なしと辞書順」を固定する。
const DIR = "supabase/migrations";
const FILE = "20261127213301_review_facilities_and_submission_queue.sql";
const sql = readFileSync(`${DIR}/${FILE}`, "utf8");

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function ${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

describe(FILE, () => {
  it("ファイル名は一意で、001–018（と 019 があれば 019）より辞書順で後に並ぶ", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.filter((f) => f === FILE)).toHaveLength(1);
    expect(files).not.toContain("020_review_facilities_and_submission_queue.sql");
    expect(files).not.toContain("019_review_facilities_and_submission_queue.sql");
    expect(new Set(files).size).toBe(files.length);
    // supabase db push はファイル名の辞書順で適用する。
    // 019_osm_sync.sql（PR #55）も "019_" < "2026..." なので本ファイルより先になる。
    for (const f of files) {
      if (/^0\d{2}_/.test(f)) {
        expect(f < FILE, `${f} should sort before ${FILE}`).toBe(true);
      }
    }
  });

  it("pending の claim は値やレビューを書き換えず、新しい行にする", () => {
    const fn = body("insert_review_with_claims");
    expect(fn).not.toMatch(/do update set/i);
    expect(fn).not.toMatch(/set\s+review_id\s*=/i);
    expect(fn).not.toMatch(/value\s*=\s*excluded/i);
    expect(fn).toMatch(/status = 'superseded'/);
    expect(fn).toMatch(/on conflict \(toilet_id, field\) where status = 'pending' do nothing/);
    expect(sql).toMatch(/'pending', 'approved', 'rejected', 'no_op', 'superseded'/);
  });

  it("承認はトイレ → claim の順に行ロックを取る", () => {
    const fn = body("admin_decide_facility_claim");
    const toiletLock = fn.indexOf("from toilets where id = v_toilet_id for update");
    const claimLock = fn.indexOf("from review_facility_claims where id = p_claim_id for update");
    const apply = fn.indexOf("admin_apply_edit(");
    expect(toiletLock).toBeGreaterThan(-1);
    expect(claimLock).toBeGreaterThan(toiletLock);
    expect(apply).toBeGreaterThan(claimLock);
  });

  it("レビュー側はトイレ(reviews の外部キー)→ claim の順", () => {
    const fn = body("insert_review_with_claims");
    const reviewInsert = fn.indexOf("insert into reviews");
    const claimLock = fn.indexOf("for update");
    expect(reviewInsert).toBeGreaterThan(-1);
    expect(claimLock).toBeGreaterThan(reviewInsert);
  });
});
