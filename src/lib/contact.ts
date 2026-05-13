// 公開表記ポリシー(Notion「🪪 公開表記ポリシー」2026-05-10 確定)に基づく集約モジュール。
// - 本名(フルネーム)は public な面に出さない。運営者表記はハンドルかチーム名を使う。
// - 問い合わせ窓口は Google Form のみ。事業者用メアドは公開サイトに表示しない
//   (NEXT_PUBLIC_CONTACT_EMAIL を明示設定しない限り null = 非表示)。

export const SITE_OPERATOR = "Toshiki"; // ハンドル
export const SITE_TEAM = "TosaGiken（東佐技研）"; // チーム名

export const CONTACT_FORM_URL = "https://forms.gle/iKxY3vB6tg4t4vTW9";

// Ko-fi の応援(任意の投げ銭)ページ。広告は入れず、収益化は Ko-fi のリンク 1 本のみ。
// ハンドル名義のページ(本名・事業者メアドは出さない)。
export const KO_FI_URL = "https://ko-fi.com/uz_u83";

// 公開サイトには出さない。env で明示しない限り null。
export const CONTACT_EMAIL: string | null =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;
