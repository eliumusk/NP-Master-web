import type { Config } from "tailwindcss";

// BGCMaster dark "instrument" theme. Semantic tokens map to CSS variables
// in app/globals.css — use `text-fg`, `bg-surface`, etc., not raw palette
// classes, in components. Status colours (success/warning/danger) are for
// state indication only; `bgc-*` hues are reserved for BGC product types.
// `fontSize` adds a fixed type scale (text-micro … text-display) — use it
// instead of arbitrary px sizes.

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:         "rgb(var(--bg) / <alpha-value>)",
        surface:    "rgb(var(--surface) / <alpha-value>)",
        elevated:   "rgb(var(--elevated) / <alpha-value>)",
        border:     "rgb(var(--border) / <alpha-value>)",
        fg:         "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
        "fg-subtle":"rgb(var(--fg-subtle) / <alpha-value>)",
        brand: {
          DEFAULT:  "rgb(var(--brand) / <alpha-value>)",
          fg:       "rgb(var(--brand-fg) / <alpha-value>)",
          soft:     "rgb(var(--brand-soft) / <alpha-value>)",
          softer:   "rgb(var(--brand-softer) / <alpha-value>)",
        },
        success:    "rgb(var(--success) / <alpha-value>)",
        warning:    "rgb(var(--warning) / <alpha-value>)",
        danger:     "rgb(var(--danger) / <alpha-value>)",
        // ── BGC type colours (dark-theme calibrated, antiSMASH-ish hues) ──
        bgc: {
          nrp:        "#60a5fa", // blue-400
          polyketide: "#a78bfa", // violet-400
          terpene:    "#34d399", // emerald-400
          ripp:       "#fb923c", // orange-400
          alkaloid:   "#f87171", // red-400
          saccharide: "#f472b6", // pink-400
          other:      "#94a3b8", // slate-400
        },
      },
      fontSize: {
        micro:   ["11px", "16px"],
        caption: ["12px", "16px"],
        small:   ["13px", "20px"],
        body:    ["14px", "22px"],
        lead:    ["15px", "24px"],
        kpi:     ["22px", "32px"],
        title:   ["24px", "32px"],
        display: ["40px", "1.15"],
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        pill: "9999px",
        btn:  "0.5rem",
        card: "0.75rem",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
