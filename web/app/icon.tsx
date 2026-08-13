import { ImageResponse } from "next/og";

// Browser tab favicon — generated at build time. Same DNA + region motif
// as <Logo>, signal-teal on near-black tile.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "rgb(10, 15, 25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <path d="M6 4c0 4 8 6 10 12s-8 8-10 12" stroke="rgb(94,234,212)" strokeOpacity="0.5" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M26 4c0 4-8 6-10 12s8 8 10 12" stroke="rgb(94,234,212)" strokeOpacity="0.5" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="10" y="14" width="12" height="4.5" rx="2.25" fill="rgb(94,234,212)" />
        </svg>
      </div>
    ),
    size,
  );
}
