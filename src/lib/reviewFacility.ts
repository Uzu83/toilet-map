// レビュー任意項目(紙・ウォシュレット・石けん・おむつ台・営業時間)の入力検証。
//
// 副作用なし。/api/reviews が rate limit や DB より前に呼ぶ。
// 未送信・null・空文字は「不明」= 承認キューに積まない。必須項目は増やさない。
// 名前・メール・電話はこの関数の入力に含めない(受け取っても読まない)。

export const FACILITY_BOOL_FIELDS = [
  "has_paper",
  "has_washlet",
  "has_soap",
  "has_diaper_table",
] as const;

export const FACILITY_FIELDS = [...FACILITY_BOOL_FIELDS, "opening_hours"] as const;

export type FacilityBoolField = (typeof FACILITY_BOOL_FIELDS)[number];
export type FacilityField = (typeof FACILITY_FIELDS)[number];

// クライアントは既存の hasWashlet に合わせた camelCase。
const BOOL_KEYS: ReadonlyArray<[string, FacilityBoolField]> = [
  ["hasPaper", "has_paper"],
  ["hasWashlet", "has_washlet"],
  ["hasSoap", "has_soap"],
  ["hasDiaperTable", "has_diaper_table"],
];

export const MAX_OPENING_HOURS_INPUT = 200;

export type ReviewFacilities = {
  has_paper: boolean | null;
  has_washlet: boolean | null;
  has_soap: boolean | null;
  has_diaper_table: boolean | null;
  opening_hours: string | null;
};

const EMPTY: ReviewFacilities = {
  has_paper: null,
  has_washlet: null,
  has_soap: null,
  has_diaper_table: null,
  opening_hours: null,
};

export class ReviewFacilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewFacilityValidationError";
  }
}

function parseBool(key: string, value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new ReviewFacilityValidationError(`${key} must be boolean or null`);
  }
  return value;
}

// 「ここトイレない」報告は設備を受け取らない(本番列の材料にしない)。
// 通常レビューでも未選択は null のまま。true/false と非空の営業時間だけが承認対象。
export function parseReviewFacilities(
  body: unknown,
  opts: { notAToilet: boolean },
): ReviewFacilities {
  if (opts.notAToilet) return { ...EMPTY };
  const input =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const out: ReviewFacilities = { ...EMPTY };
  for (const [camel, snake] of BOOL_KEYS) {
    out[snake] = parseBool(camel, input[camel]);
  }

  const hours = input.openingHours;
  if (hours === undefined || hours === null) {
    out.opening_hours = null;
  } else if (typeof hours !== "string") {
    throw new ReviewFacilityValidationError("openingHours must be a string or null");
  } else {
    const trimmed = hours.trim();
    if (trimmed.length === 0) {
      out.opening_hours = null;
    } else if (trimmed.length > MAX_OPENING_HOURS_INPUT) {
      throw new ReviewFacilityValidationError("openingHours too long");
    } else {
      out.opening_hours = trimmed;
    }
  }
  return out;
}

// 管理画面の設備承認カードに出す「どのトイレか」。
// 名前が無い・トイレ行が読めないときも、id の先頭と個別ページのリンクで区別できるようにする。
export function facilityClaimToiletLabel(
  toiletId: string,
  toilet: { name: string | null } | undefined,
): { name: string; shortId: string; href: string } {
  const name = toilet?.name?.trim();
  return {
    name: name ? name : "名称未設定",
    shortId: toiletId.slice(0, 8),
    href: `/toilet/${encodeURIComponent(toiletId)}`,
  };
}
