import { LoginForm } from "./LoginForm";

// 管理サブツリー全体で静的化しない方針を統一する(他の admin route/page と揃える)。
// WHY ここでも明示: page セグメントの dynamic は親 layout から継承されない。
//   さらにこの page は env(ADMIN_PASSWORD の有無)をリクエスト時に読むので、static 化すると表示がズレる。
export const dynamic = "force-dynamic";

// /admin/login — 運営専用ログイン(日本語のみ・簡素)。
// 主はパスキー(Issue #61)。パスワードの入力欄は ADMIN_PASSWORD が設定されているときだけ出す
//   (パスキー導入後は ADMIN_PASSWORD を消して止める。失くしたときは設定し直せば戻る)。
// 秘密値そのものはクライアントへ渡さない(有無の真偽値だけ)。
export default function AdminLoginPage() {
  const passwordLoginEnabled = (process.env.ADMIN_PASSWORD ?? "").length > 0;
  return <LoginForm passwordLoginEnabled={passwordLoginEnabled} />;
}
