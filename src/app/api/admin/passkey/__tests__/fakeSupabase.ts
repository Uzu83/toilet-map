// パスキー route テスト用の小さな in-memory Supabase もどき。
// WHY 実 DB 風にするか: challenge の「1 回だけ取り出す(DELETE ... RETURNING)」と期限切れを、
//   呼び出し順のモックではなく状態で確かめたいから。対応するのはこの機能が使う呼び出しだけ。

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

export type FakeDb = {
  tables: Record<string, Row[]>;
  // テーブル名 → そのテーブルへの次の操作で返すエラー
  failNext: Record<string, { code?: string; message: string } | undefined>;
};

export function makeFakeDb(): FakeDb {
  return { tables: { admin_passkeys: [], admin_webauthn_challenges: [] }, failNext: {} };
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "delete" | "update" = "select";
  private payload: Row | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    this.returning = true;
    return this;
  }
  insert(v: Row) {
    this.op = "insert";
    this.payload = v;
    return this;
  }
  update(v: Row) {
    this.op = "update";
    this.payload = v;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) < v);
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  private exec(): Result {
    const err = this.db.failNext[this.table];
    if (err) {
      this.db.failNext[this.table] = undefined;
      return { data: null, error: err };
    }
    const rows = (this.db.tables[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];
    if (this.op === "insert") {
      const row: Row = { ...this.payload };
      if (this.table === "admin_webauthn_challenges" && row.id === undefined) row.id = randomUUID();
      if (this.table === "admin_passkeys" && rows.some((r) => r.credential_id === row.credential_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows.push(row);
      out = [row];
    } else if (this.op === "delete") {
      out = rows.filter(match);
      this.db.tables[this.table] = rows.filter((r) => !match(r));
    } else if (this.op === "update") {
      out = rows.filter(match);
      for (const r of out) Object.assign(r, this.payload);
    } else {
      out = rows.filter(match);
    }
    const data = this.returning || this.op === "select" ? out.map((r) => ({ ...r })) : null;
    if (this.mode === "single") {
      if (!data || data.length !== 1) return { data: null, error: { code: "PGRST116", message: "not single" } };
      return { data: data[0], error: null };
    }
    if (this.mode === "maybeSingle") return { data: data?.[0] ?? null, error: null };
    return { data, error: null };
  }

  then<T1 = Result, T2 = never>(
    onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
  }
}

export function makeFakeSupabase(db: FakeDb) {
  return { from: (table: string) => new Query(db, table) };
}
