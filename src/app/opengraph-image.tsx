import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Loo map - 近くのトイレを最速で見つける地図";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          <span>近くのトイレ</span>
          <span>·</span>
          <span>3タップ</span>
          <span>·</span>
          <span>許可色+星評価</span>
        </div>
        <div
          style={{
            marginTop: 56,
            display: "flex",
            gap: 16,
          }}
        >
          {[
            { c: "#3B82F6", t: "声かけ不要" },
            { c: "#F59E0B", t: "一声かけて" },
            { c: "#EF4444", t: "要許可" },
          ].map((x) => (
            <div
              key={x.t}
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
