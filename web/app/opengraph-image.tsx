import { ImageResponse } from "next/og";

// Open Graph card. Shows up when the URL is shared in Slack / WeChat / Twitter.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "NP-Master · 从基因组到 BGC，一站式发现与注释";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top: brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 14,
              background: "rgb(99, 102, 241)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
              <path d="M6 4c0 4 8 6 10 12s-8 8-10 12" stroke="white" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M26 4c0 4-8 6-10 12s8 8 10 12" stroke="white" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
              <rect x="10" y="14" width="12" height="4.5" rx="2.25" fill="white" />
            </svg>
          </div>
          <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.01em" }}>NP-Master</span>
        </div>

        {/* Center: headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <h1 style={{ fontSize: 86, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.03em", margin: 0 }}>
            从基因组到 BGC<br />一站式发现与注释
          </h1>
          <p style={{ fontSize: 28, color: "rgba(255,255,255,0.72)", margin: 0, maxWidth: 900 }}>
            基于基因组语言模型 Evo2 7B，16 GPU 并行 + MIBiG 已知簇比对 + IGV 可视化
          </p>
        </div>

        {/* Bottom: stats strip */}
        <div style={{ display: "flex", gap: 48, alignItems: "flex-end", color: "rgba(255,255,255,0.85)" }}>
          <Stat n="14×" h="并行加速" />
          <Stat n="57%" h="OER 召回" />
          <Stat n="7"   h="BGC 类别" />
          <Stat n="50 MB" h="单次上限" />
          <div style={{ marginLeft: "auto", fontSize: 22, color: "rgba(255,255,255,0.55)" }}>np-master-web.vercel.app</div>
        </div>
      </div>
    ),
    size,
  );
}

function Stat({ n, h }: { n: string; h: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>{n}</span>
      <span style={{ fontSize: 18, opacity: 0.65, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>
    </div>
  );
}
