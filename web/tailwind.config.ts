import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Brand colour: indigo (HSL 239 84 67). Locked across the design system.
// Semantic tokens map to CSS variables defined in app/globals.css.
// All foreground / surface / brand colours go through tokens; do NOT use raw
// `slate-*` / `indigo-*` in components — use `text-fg`, `bg-surface`, etc.

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // ── Semantic surface / fg tokens (var()'s defined in globals.css) ──
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
        // ── BGC type colours, calibrated to same HSL S=70 L=50 (light) ──
        // Aligned with antiSMASH-ish palette so colour conventions don't surprise users.
        bgc: {
          nrp:        { DEFAULT: "#3b82f6", soft: "#dbeafe", fg: "#1e40af" }, // blue
          polyketide: { DEFAULT: "#8b5cf6", soft: "#ede9fe", fg: "#5b21b6" }, // violet
          terpene:    { DEFAULT: "#10b981", soft: "#d1fae5", fg: "#047857" }, // emerald
          ripp:       { DEFAULT: "#f97316", soft: "#ffedd5", fg: "#c2410c" }, // orange
          alkaloid:   { DEFAULT: "#ef4444", soft: "#fee2e2", fg: "#b91c1c" }, // red
          saccharide: { DEFAULT: "#ec4899", soft: "#fce7f3", fg: "#be185d" }, // pink
          other:      { DEFAULT: "#64748b", soft: "#f1f5f9", fg: "#475569" }, // slate
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "PingFang SC",
               "Source Han Sans CN", "Noto Sans CJK SC", "Microsoft YaHei",
               "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace",
               "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        // Four-tier radius hierarchy — use these names in components.
        pill:    "9999px",     // badges
        btn:     "0.5rem",     // 8px — buttons, inputs
        card:    "0.5rem",     // 8px — cards and panels
        section: "0.5rem",     // 8px — large sections / dropzone
      },
      spacing: {
        // Section vertical rhythm: 96px
        section: "6rem",
      },
      maxWidth: {
        content: "72rem", // 6xl
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      animation: {
        "fade-in": "fade-in 250ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
