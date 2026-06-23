import { ALL_FILTER, TIER_ORDER } from "./constants";
import type { CdsFeature, Region, RegionFilters } from "./types";

export type CountStat = {
  key: string;
  label: string;
  count: number;
};

export function regionLength(region: Region) {
  return Math.max(0, region.end_bp - region.start_bp);
}

export function extendedLength(region: Region) {
  if (region.ext_start_bp == null || region.ext_end_bp == null) return null;
  return Math.max(0, region.ext_end_bp - region.ext_start_bp);
}

export function countBy<T>(items: T[], keyFn: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) || "未分组";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({ key, label: key, count }));
}

export function typeCounts(regions: Region[]) {
  return countBy(regions, (region) => region.bgc_type || "Other")
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function tierCounts(regions: Region[]) {
  return countBy(regions, (region) => region.safe_tier || "未分级")
    .sort((a, b) => tierRank(a.key) - tierRank(b.key));
}

export function genomeCounts(regions: Region[]) {
  return countBy(regions, (region) => region.genome_name)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function filterRegions(regions: Region[], filters: RegionFilters) {
  const q = filters.query.trim().toLowerCase();
  return regions.filter((region) => {
    if (filters.safeOnly && !region.safe_pass) return false;
    if (filters.genome !== ALL_FILTER && region.genome_name !== filters.genome) return false;
    if (filters.bgcType !== ALL_FILTER && (region.bgc_type || "Other") !== filters.bgcType) return false;
    if (filters.tier !== ALL_FILTER && (region.safe_tier || "未分级") !== filters.tier) return false;
    if (!q) return true;
    return [
      region.genome_name,
      region.contig,
      region.bgc_type,
      region.safe_tier,
      region.safe_type_label,
      region.mibig_hits?.[0]?.bgc_id,
      region.mibig_hits?.[0]?.product,
    ].some((value) => String(value ?? "").toLowerCase().includes(q));
  });
}

export function countDomains(cdsFeatures: CdsFeature[] | null | undefined) {
  return (cdsFeatures ?? []).reduce((sum, cds) => sum + (cds.pfam_domains?.length ?? 0), 0);
}

export function countFunctionClasses(cdsFeatures: CdsFeature[] | null | undefined) {
  return countBy(cdsFeatures ?? [], (cds) => cds.function_class || "other")
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function tierRank(tier: string) {
  const exact = TIER_ORDER.indexOf(tier);
  if (exact >= 0) return exact;
  const prefix = TIER_ORDER.findIndex((item) => tier.startsWith(item.slice(0, 5)));
  return prefix >= 0 ? prefix : TIER_ORDER.length;
}
