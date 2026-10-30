import { ALL_FILTER } from "./constants";
import type { CdsFeature, Region, RegionFilters, RegionSortMode } from "./types";

export function extendedLength(region: Region) {
  if (region.ext_start_bp == null || region.ext_end_bp == null) return null;
  return Math.max(0, region.ext_end_bp - region.ext_start_bp);
}

export function filterRegions(regions: Region[], filters: RegionFilters, bgcIds?: Map<number, string>) {
  const q = filters.query.trim().toLowerCase();
  return regions.filter((region) => {
    if (filters.safeOnly && !region.safe_pass) return false;
    if (filters.contig !== ALL_FILTER && `${region.genome_name}|${region.contig}` !== filters.contig) return false;
    if (filters.bgcType !== ALL_FILTER && (region.bgc_type || "Other") !== filters.bgcType) return false;
    if (filters.tier !== ALL_FILTER && evidenceKey(region) !== filters.tier) return false;
    if (!q) return true;
    const geneText = (region.cds_features ?? [])
      .map((cds) => `${cds.locus_tag ?? ""} ${cds.product ?? ""}`)
      .join(" ");
    return [
      bgcIds?.get(region.id),
      region.bgc_id,
      region.genome_name,
      region.contig,
      region.bgc_type,
      region.safe_type_label,
      region.mibig_hits?.[0]?.bgc_id,
      region.mibig_hits?.[0]?.product,
      geneText,
    ].some((value) => String(value ?? "").toLowerCase().includes(q));
  });
}

// ── Display helpers for the candidate-centric results view ─────────────

/** Stable display ids. Prefers the pipeline-side bgc_id (matches downloaded
 * CSV/zip artifacts); rows predating migration 0007 fall back to positional
 * ids (BGC_0001…) in biological order: genome, contig, start. */
export function assignBgcIds(
  regions: Array<Pick<Region, "id" | "genome_name" | "contig" | "start_bp" | "bgc_id">>,
): Map<number, string> {
  const sorted = [...regions].sort((a, b) =>
    a.genome_name.localeCompare(b.genome_name)
    || a.contig.localeCompare(b.contig)
    || a.start_bp - b.start_bp,
  );
  const map = new Map<number, string>();
  let fallback = 0;
  for (const region of sorted) {
    if (region.bgc_id) {
      map.set(region.id, region.bgc_id);
    } else {
      fallback += 1;
      map.set(region.id, `BGC_${String(fallback).padStart(4, "0")}`);
    }
  }
  return map;
}

/** Evidence bucket used for the 证据 column and the evidence sort mode. */
export function evidenceKey(region: Region): "tier1" | "tier2" | "tier3" | "tier4" | "tier5" | "none" {
  const tier = region.safe_tier || "";
  if (tier.startsWith("Tier1")) return "tier1";
  if (tier.startsWith("Tier2")) return "tier2";
  if (tier.startsWith("Tier3")) return "tier3";
  if (tier.startsWith("Tier4")) return "tier4";
  if (tier.startsWith("Tier5")) return "tier5";
  return "none";
}

export function evidenceRank(region: Region) {
  const order = { tier1: 0, tier2: 1, tier3: 2, tier4: 3, tier5: 4, none: 5 } as const;
  return order[evidenceKey(region)];
}

/**
 * Table ordering. "position" (default) follows the BGC numbering assigned by
 * assignBgcIds (genome → contig → start); "evidence" ranks by evidence rating
 * first, then detection score.
 */
export function sortRegionsForTable(regions: Region[], mode: RegionSortMode = "position"): Region[] {
  if (mode === "evidence") {
    return [...regions].sort((a, b) =>
      evidenceRank(a) - evidenceRank(b) || b.score - a.score,
    );
  }
  return [...regions].sort((a, b) =>
    a.genome_name.localeCompare(b.genome_name)
    || a.contig.localeCompare(b.contig)
    || a.start_bp - b.start_bp,
  );
}

/**
 * Display name for a CDS function. Prodigal-annotated runs have no real
 * product names ("hypothetical protein"), so fall back to the name of the
 * highest-bitscore Pfam domain (flagged as a prediction). null = nothing known.
 */
export function cdsDisplayFunction(cds: CdsFeature): { text: string; pfamPredicted: boolean } | null {
  const product = (cds.product ?? "").trim();
  if (product && !/hypothetical/i.test(product)) return { text: product, pfamPredicted: false };
  const top = (cds.pfam_domains ?? [])
    .filter((d) => (d.name ?? "").trim())
    .sort((a, b) => Number(b.bitscore ?? 0) - Number(a.bitscore ?? 0))[0];
  if (top) return { text: (top.name ?? "").trim(), pfamPredicted: true };
  return null;
}

/** Representative seed gene: first core-biosynthetic CDS (product or locus). */
export function seedGeneOf(region: Region): { name: string; extra: number } | null {
  const cds = region.cds_features ?? [];
  const cores = cds.filter((c) => c.function_class === "core_biosynthetic");
  const pick = cores[0] ?? cds.find((c) => (c.pfam_domains?.length ?? 0) > 0) ?? cds[0];
  if (!pick) return null;
  const name = pick.product || pick.locus_tag || "";
  if (!name) return null;
  return { name, extra: Math.max(0, cores.length - 1) };
}

/** Region id of the nearest same-contig neighbour within maxGapBp, if any.
 *  Used to flag likely split/hybrid clusters in the explorer table. */
export function nearestNeighbour(
  regions: Array<Pick<Region, "id" | "genome_name" | "contig" | "start_bp" | "end_bp">>,
  maxGapBp = 5000,
): Map<number, { id: number; gap: number }> {
  const out = new Map<number, { id: number; gap: number }>();
  const byContig = new Map<string, typeof regions>();
  for (const r of regions) {
    const key = `${r.genome_name}|${r.contig}`;
    const arr = byContig.get(key);
    if (arr) arr.push(r);
    else byContig.set(key, [r]);
  }
  for (const arr of byContig.values()) {
    const sorted = [...arr].sort((a, b) => a.start_bp - b.start_bp);
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      let best: { id: number; gap: number } | null = null;
      if (prev) {
        const gap = Math.max(0, r.start_bp - prev.end_bp);
        if (gap <= maxGapBp) best = { id: prev.id, gap };
      }
      if (next) {
        const gap = Math.max(0, next.start_bp - r.end_bp);
        if (gap <= maxGapBp && (!best || gap < best.gap)) best = { id: next.id, gap };
      }
      if (best) out.set(r.id, best);
    }
  }
  return out;
}

/** Chain-merge regions on the same contig whose gaps are <= maxGapBp.
 *  Returns regionId -> { group, size, members } for groups with >= 2 regions;
 *  group numbers are assigned in genomic order (1-based). */
export function clusterGroups(
  regions: Array<Pick<Region, "id" | "genome_name" | "contig" | "start_bp" | "end_bp">>,
  maxGapBp = 10_000,
): Map<number, { group: number; size: number; members: number[] }> {
  const byContig = new Map<string, typeof regions>();
  for (const r of regions) {
    const key = `${r.genome_name}|${r.contig}`;
    const arr = byContig.get(key);
    if (arr) arr.push(r);
    else byContig.set(key, [r]);
  }
  const chains: number[][] = [];
  for (const arr of byContig.values()) {
    const sorted = [...arr].sort((a, b) => a.start_bp - b.start_bp);
    let chain: number[] = [];
    let chainEnd = -Infinity;
    for (const r of sorted) {
      if (chain.length > 0 && r.start_bp - chainEnd > maxGapBp) {
        chains.push(chain);
        chain = [];
      }
      chain.push(r.id);
      chainEnd = Math.max(chainEnd, r.end_bp);
    }
    if (chain.length) chains.push(chain);
  }
  const out = new Map<number, { group: number; size: number; members: number[] }>();
  let n = 0;
  for (const chain of chains) {
    if (chain.length < 2) continue;
    n += 1;
    for (const id of chain) out.set(id, { group: n, size: chain.length, members: chain });
  }
  return out;
}
