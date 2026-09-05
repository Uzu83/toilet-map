import { INFERRED_CATEGORIES } from "@/lib/osm";

// 全体が「(種別ラベル)」だけの名前を落とす。半角・全角の括弧どちらも対象。
const PAREN_ONLY = /^[（(](.+)[）)]$/;

/**
 * 表示・index に使える施設名か。使えないなら null。
 *
 * WHY INFERRED_CATEGORIES を関数内で読むか:
 *   このモジュールは osm.ts のラベルを真実の源として import し、osm.ts は
 *   pickName で usableToiletName を呼ぶ。循環 import になるため、モジュール
 *   初期化時に Set を作ると osm 側の const が未初期化のまま空集合になる。
 *   呼び出し時点(シード/描画)では両方初期化済みなので、都度 label を見る。
 *
 * WHY 「駅」単体は残すか:
 *   OSM の実名として「駅」があり得る。落とすのは推定ピンが埋め込んでいた
 *   括弧付き種別ラベル `(駅)` / `（駅）` だけ。
 */
export function usableToiletName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (
    /^\d{3}\b/.test(trimmed) ||
    /not found/i.test(trimmed) ||
    /<html/i.test(trimmed) ||
    /internal server error/i.test(trimmed)
  ) {
    return null;
  }

  const paren = PAREN_ONLY.exec(trimmed);
  if (paren && INFERRED_CATEGORIES.some((c) => c.label === paren[1])) {
    return null;
  }

  return trimmed;
}
