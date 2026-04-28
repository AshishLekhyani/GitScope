import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "GitScope — GitHub analytics dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: "absolute",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)",
            top: "-100px",
            left: "-100px",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(217,119,6,0.15) 0%, transparent 70%)",
            bottom: "-50px",
            right: "100px",
          }}
        />

        {/* Logo mark — hexagon via clip-path (avoids edge font download for ⬡) */}
        <div
          style={{
            width: "80px",
            height: "80px",
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
            marginBottom: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: "72px",
            fontWeight: 900,
            background: "linear-gradient(90deg, #e2e8f0, #fde68a)",
            backgroundClip: "text",
            color: "transparent",
            letterSpacing: "-2px",
            marginBottom: "16px",
          }}
        >
          GitScope
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "28px",
            color: "#94a3b8",
            fontWeight: 500,
            textAlign: "center",
            maxWidth: "700px",
          }}
        >
          GitHub Analytics &amp; Codebase Intelligence
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "40px",
          }}
        >
          {["Security Scans", "AI Code Review", "Repo Analytics", "Team Insights"].map((label) => (
            <div
              key={label}
              style={{
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: "100px",
                padding: "8px 20px",
                color: "#fde68a",
                fontSize: "18px",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
