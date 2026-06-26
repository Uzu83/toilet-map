import { beforeEach, describe, expect, it, vi } from "vitest";

// H3 — toilets.ts の単体テスト: getIndexableToiletIdsPage ページング + getToiletById UUID ガード

// supabase クライアントをモック化。各テストで rpcMock の戻り値を差し替える。
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabasePublishable: () => ({ rpc: rpcMock }),
}));

// react の cache() は no-op でラップ(テスト環境ではリクエストスコープなし)
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // cache は関数をそのまま返す(per-request memoization をバイパス)
    cache: (fn: unknown) => fn,
  };
});

import { getIndexableToiletIdsPage, getToiletById } from "@/lib/toilets";

// ページングに使う stub 行
function makeRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${offset + i}`,
    created_at: "2024-01-01T00:00:00Z",
  }));
}

describe("getIndexableToiletIdsPage — ページング (H3)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("1バッチ < 1000件: 全件返してループを抜ける", async () => {
    // 300 件を 1 回で返す → 完了
    rpcMock.mockResolvedValueOnce({ data: makeRows(300), error: null });
    const result = await getIndexableToiletIdsPage(0, 300);
    expect(result).toHaveLength(300);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("2バッチ × 1000件: 連結してループを抜ける", async () => {
    // limit=2000 → 1バッチ目 1000件(完了しない), 2バッチ目 1000件(done)
    rpcMock
      .mockResolvedValueOnce({ data: makeRows(1000), error: null })
      .mockResolvedValueOnce({ data: makeRows(1000, 1000), error: null });
    const result = await getIndexableToiletIdsPage(0, 2000);
    expect(result).toHaveLength(2000);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    // 2バッチ目は offset=1000 を渡すはず
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({ p_offset: 1000 });
  });

  it("最初のバッチが空 → 空配列を返す", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await getIndexableToiletIdsPage(0, 500);
    expect(result).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("getToiletById — UUID ガード (H3)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("不正 UUID → null を返す(RPC は呼ばない)", async () => {
    const result = await getToiletById("not-a-uuid");
    expect(result).toBeNull();
    // isUuid で弾かれるため RPC は一切呼ばれない
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("空文字 → null を返す(RPC は呼ばない)", async () => {
    const result = await getToiletById("");
    expect(result).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
