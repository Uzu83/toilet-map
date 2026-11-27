import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 020 の SQL を文字列で見る。行ロックやデッドロック自体は live smoke でしか確かめられないので、
// ここでは「書き換えない」「ロック順」「番号の重複なし」を固定する。
const DIR = "supabase/migrations";
const FILE = "020_review_facilities_and_submission_queue.sql";
const sql = readFileSync(`${DIR}/${FILE}`, "utf8");

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function ${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

describe(FILE, () => {
  it("番号 020 は他の migration と重ならない(PR #55 は 019_osm_sync)", () => {
    const prefixes = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 3));
    expect(prefixes.filter((p) => p === "020")).toHaveLength(1);
    expect(readdirSync(DIR)).not.toContain("019_review_facilities_and_submission_queue.sql");
    expect(new Set(prefixes).size).toBe(prefixes.length);
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
