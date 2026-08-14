import { getDictionary, type Locale } from "@/lib/i18n";

export const ALL_FILTER = "__all__";

export const TIER_ORDER = [
  "Tier1_known_like_high_confidence",
  "Tier2_biosynthetic_supported",
  "Tier3_novel_architecture_or_low_confidence",
  "Tier4_fragmentary_or_contig_edge",
  "Tier4_fragmentary_or_single_gene",
  "Tier5_embedding_only_or_likely_FP",
  "Tier5_primary_metabolism_risk",
];

// Chips are translucent tints on the dark surfaces; class strings must stay
// literal so Tailwind's JIT picks them up.
export const BGC_TYPE_META: Record<string, { label: string; className: string; barClassName: string }> = {
  NRP: {
    label: "NRP",
    className: "bg-bgc-nrp/15 text-bgc-nrp ring-1 ring-inset ring-bgc-nrp/30",
    barClassName: "bg-bgc-nrp",
  },
  Polyketide: {
    label: "Polyketide",
    className: "bg-bgc-polyketide/15 text-bgc-polyketide ring-1 ring-inset ring-bgc-polyketide/30",
    barClassName: "bg-bgc-polyketide",
  },
  Terpene: {
    label: "Terpene",
    className: "bg-bgc-terpene/15 text-bgc-terpene ring-1 ring-inset ring-bgc-terpene/30",
    barClassName: "bg-bgc-terpene",
  },
  RiPP: {
    label: "RiPP",
    className: "bg-bgc-ripp/15 text-bgc-ripp ring-1 ring-inset ring-bgc-ripp/30",
    barClassName: "bg-bgc-ripp",
  },
  Alkaloid: {
    label: "Alkaloid",
    className: "bg-bgc-alkaloid/15 text-bgc-alkaloid ring-1 ring-inset ring-bgc-alkaloid/30",
    barClassName: "bg-bgc-alkaloid",
  },
  Saccharide: {
    label: "Saccharide",
    className: "bg-bgc-saccharide/15 text-bgc-saccharide ring-1 ring-inset ring-bgc-saccharide/30",
    barClassName: "bg-bgc-saccharide",
  },
  Other: {
    label: "Other",
    className: "bg-bgc-other/15 text-bgc-other ring-1 ring-inset ring-bgc-other/30",
    barClassName: "bg-bgc-other",
  },
};

export const FUNCTION_CLASS_META: Record<string, { className: string }> = {
  core_biosynthetic: { className: "bg-bgc-polyketide/15 text-bgc-polyketide ring-1 ring-inset ring-bgc-polyketide/30" },
  additional_biosynthetic: { className: "bg-bgc-ripp/15 text-bgc-ripp ring-1 ring-inset ring-bgc-ripp/30" },
  transport: { className: "bg-bgc-nrp/15 text-bgc-nrp ring-1 ring-inset ring-bgc-nrp/30" },
  regulatory: { className: "bg-bgc-terpene/15 text-bgc-terpene ring-1 ring-inset ring-bgc-terpene/30" },
  resistance: { className: "bg-bgc-alkaloid/15 text-bgc-alkaloid ring-1 ring-inset ring-bgc-alkaloid/30" },
  other: { className: "bg-bgc-other/15 text-bgc-other ring-1 ring-inset ring-bgc-other/30" },
};

// Solid hex per function class — used as SVG fill on the gene track.
export const FUNCTION_CLASS_COLORS: Record<string, string> = {
  core_biosynthetic: "#a78bfa",
  additional_biosynthetic: "#fb923c",
  transport: "#60a5fa",
  regulatory: "#34d399",
  resistance: "#f87171",
  other: "#94a3b8",
};

export function bgcTypeMeta(type: string | null | undefined) {
  return BGC_TYPE_META[type || "Other"] ?? BGC_TYPE_META.Other;
}

export function functionClassMeta(functionClass: string | null | undefined, locale: Locale = "zh") {
  const key = functionClass || "other";
  const dict = getDictionary(locale);
  const meta = FUNCTION_CLASS_META[key] ?? FUNCTION_CLASS_META.other;
  const label = (dict.functionClass as Record<string, string>)[key] ?? dict.functionClass.other;
  return { label, className: meta.className };
}

export function functionClassColor(functionClass: string | null | undefined) {
  return FUNCTION_CLASS_COLORS[functionClass || "other"] ?? FUNCTION_CLASS_COLORS.other;
}

export function tierLabel(tier: string | null | undefined, locale: Locale = "zh") {
  const dict = getDictionary(locale);
  if (!tier) return dict.tier.unranked;
  if (tier.startsWith("Tier1")) return dict.tier.tier1;
  if (tier.startsWith("Tier2")) return dict.tier.tier2;
  if (tier.startsWith("Tier3")) return dict.tier.tier3;
  if (tier.startsWith("Tier4")) return dict.tier.tier4;
  if (tier.startsWith("Tier5")) return dict.tier.tier5;
  return tier;
}

// Evidence chip classes — single source for the explorer table, the region
// detail header and tierClassName. tier1/tier2 share the success colour; the
// label text carries the distinction. Class strings must stay literal so
// Tailwind's JIT picks them up.
export const EVIDENCE_CHIP: Record<string, string> = {
  tier1: "bg-success/10 text-success ring-1 ring-inset ring-success/30",
  tier2: "bg-success/10 text-success ring-1 ring-inset ring-success/30",
  tier3: "bg-warning/10 text-warning ring-1 ring-inset ring-warning/30",
  tier4: "bg-white/[0.03] text-fg-muted ring-1 ring-inset ring-white/[0.08]",
  tier5: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/30",
  none: "bg-white/[0.03] text-fg-muted ring-1 ring-inset ring-white/[0.08]",
};

export function tierClassName(tier: string | null | undefined, safePass?: boolean) {
  if (!tier) return EVIDENCE_CHIP.none;
  if (tier.startsWith("Tier1")) return EVIDENCE_CHIP.tier1;
  if (tier.startsWith("Tier2")) return EVIDENCE_CHIP.tier2;
  if (tier.startsWith("Tier3")) return EVIDENCE_CHIP.tier3;
  if (safePass) return EVIDENCE_CHIP.tier4;
  return EVIDENCE_CHIP.tier5;
}
