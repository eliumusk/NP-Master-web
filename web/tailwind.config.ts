import type { Config } from "tailwindcss";

// BGCMaster dark "instrument" theme. Semantic tokens map to CSS variables
// in app/globals.css — use `text-fg`, `bg-surface`, etc., not raw palette
// classes, in components.

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
        accent:     "rgb(var(--accent) / <alpha-value>)",
        // ── BGC type colours (dark-theme calibrated, antiSMASH-ish hues) ──
        bgc: {
          nrp:        { DEFAULT: "#60a5fa", soft: "#dbeafe", fg: "#1e40af" }, // blue-400
          polyketide: { DEFAULT: "#a78bfa", soft: "#ede9fe", fg: "#5b21b6" }, // violet-400
          terpene:    { DEFAULT: "#34d399", soft: "#d1fae5", fg: "#047857" }, // emerald-400
          ripp:       { DEFAULT: "#fb923c", soft: "#ffedd5", fg: "#c2410c" }, // orange-400
          alkaloid:   { DEFAULT: "#f87171", soft: "#fee2e2", fg: "#b91c1c" }, // red-400
          saccharide: { DEFAULT: "#f472b6", soft: "#fce7f3", fg: "#be185d" }, // pink-400
          other:      { DEFAULT: "#94a3b8", soft: "#f1f5f9", fg: "#475569" }, // slate-400
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        pill:    "9999px",
        btn:     "0.5rem",
        card:    "0.75rem",
        section: "0.875rem",
      },
      maxWidth: {
        content: "72rem",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
