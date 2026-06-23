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

export const BGC_TYPE_META: Record<string, { label: string; className: string; barClassName: string }> = {
  NRP: {
    label: "NRP",
    className: "bg-bgc-nrp-soft text-bgc-nrp-fg",
    barClassName: "bg-bgc-nrp",
  },
  Polyketide: {
    label: "Polyketide",
    className: "bg-bgc-polyketide-soft text-bgc-polyketide-fg",
    barClassName: "bg-bgc-polyketide",
  },
  Terpene: {
    label: "Terpene",
    className: "bg-bgc-terpene-soft text-bgc-terpene-fg",
    barClassName: "bg-bgc-terpene",
  },
  RiPP: {
    label: "RiPP",
    className: "bg-bgc-ripp-soft text-bgc-ripp-fg",
    barClassName: "bg-bgc-ripp",
  },
  Alkaloid: {
    label: "Alkaloid",
    className: "bg-bgc-alkaloid-soft text-bgc-alkaloid-fg",
    barClassName: "bg-bgc-alkaloid",
  },
  Saccharide: {
    label: "Saccharide",
    className: "bg-bgc-saccharide-soft text-bgc-saccharide-fg",
    barClassName: "bg-bgc-saccharide",
  },
  Other: {
    label: "Other",
    className: "bg-bgc-other-soft text-bgc-other-fg",
    barClassName: "bg-bgc-other",
  },
};

export const FUNCTION_CLASS_META: Record<string, { label: string; className: string }> = {
  core_biosynthetic: { label: "核心合成", className: "bg-bgc-polyketide-soft text-bgc-polyketide-fg" },
  additional_biosynthetic: { label: "修饰合成", className: "bg-bgc-ripp-soft text-bgc-ripp-fg" },
  transport: { label: "转运", className: "bg-bgc-nrp-soft text-bgc-nrp-fg" },
  regulatory: { label: "调控", className: "bg-bgc-terpene-soft text-bgc-terpene-fg" },
  resistance: { label: "抗性", className: "bg-bgc-alkaloid-soft text-bgc-alkaloid-fg" },
  other: { label: "其他", className: "bg-bgc-other-soft text-bgc-other-fg" },
};

export function bgcTypeMeta(type: string | null | undefined) {
  return BGC_TYPE_META[type || "Other"] ?? BGC_TYPE_META.Other;
}

export function functionClassMeta(functionClass: string | null | undefined) {
  return FUNCTION_CLASS_META[functionClass || "other"] ?? FUNCTION_CLASS_META.other;
}

export function tierLabel(tier: string | null | undefined) {
  if (!tier) return "未分级";
  if (tier.startsWith("Tier1")) return "Tier1 高置信已知相似";
  if (tier.startsWith("Tier2")) return "Tier2 生物合成证据";
  if (tier.startsWith("Tier3")) return "Tier3 新颖/低置信";
  if (tier.startsWith("Tier4")) return "Tier4 片段/边界";
  if (tier.startsWith("Tier5")) return "Tier5 低优先级/风险";
  return tier;
}

export function tierClassName(tier: string | null | undefined, safePass?: boolean) {
  if (!tier) return "bg-elevated text-fg-muted";
  if (tier.startsWith("Tier1")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (tier.startsWith("Tier2")) return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
  if (tier.startsWith("Tier3")) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  if (safePass) return "bg-elevated text-fg";
  return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
}
