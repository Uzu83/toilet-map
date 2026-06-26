import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// #35 — OG 画像をロケール対応にする。
//
// WHY async Image() が必要か:
//   getTranslations はサーバー非同期 API。opengraph-image は [locale] ルートの下にあるため
//   params.locale を受け取れる。非同期にすることでサブタイトルとバッジラベルを i18n から取得する。
//
// WHY alt をハードコードしないか:
//   以前は "Loo map - 近くのトイレを最速で見つける地図" と日本語固定だった。
//   ロケール別に generateImageMetadata で alt を設定するのが理想だが、edge runtime では
//   getTranslations の await が可能か検証が必要であり、fallback として "Loo map" のブランド名のみを
//   alt に使う(全言語で通用し、次の人が拡張しやすい安全な最小)。
//   generateImageMetadata はこのファイルから export すれば Next が使うが、今回は export const alt
//   をシンプルに定義するだけにする。
export const alt = "Loo map";

// WHY access.*.label をここで引くか:
//   OG 画像のバッジラベル("声かけ不要" 等)が日本語固定だった。
//   ロケールが en/ko/zh の場合も同じ翻訳キーを使えばロケール別ラベルになる。
//   これらのキーは全 4 ロケールに存在する(CLAUDE.md 規約)。
export default async function Image({
  params,
}: {
  // Next 16 では dynamic route の params は Promise(opengraph-image.md: "v16.0.0 params is now a promise")。
  // ⚠️ sync で `params.locale` を読むと Promise オブジェクトの .locale = undefined となり、
  //    下の `?? "ja"` で常に日本語にフォールバックして OG 画像の多言語化が無効化される
  //    (ビルドは通るので発覚しにくい)。必ず await して取り出す。
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tApp = await getTranslations({ locale, namespace: "app" });
  const tAccess = await getTranslations({ locale, namespace: "access" });

  const subtitle = tApp("tagline");
  const badges = [
    { c: "#3B82F6", t: tAccess("open.label") },
    { c: "#F59E0B", t: tAccess("ask.label") },
    { c: "#EF4444", t: tAccess("permission.label") },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 220, lineHeight: 1, marginBottom: 24 }}>🚽</div>
        <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: -2, display: "flex", gap: 16 }}>
          <span style={{ color: "#FFFFFF" }}>Loo</span>
          <span style={{ color: "#10B981" }}>map</span>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 36,
            opacity: 0.95,
            display: "flex",
            gap: 24,
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            marginTop: 56,
            display: "flex",
            gap: 16,
          }}
        >
          {badges.map((x) => (
            <div
              key={x.c}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(255,255,255,0.16)",
                padding: "12px 22px",
                borderRadius: 999,
                fontSize: 28,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  background: x.c,
                  border: "3px solid white",
                }}
              />
              {x.t}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
