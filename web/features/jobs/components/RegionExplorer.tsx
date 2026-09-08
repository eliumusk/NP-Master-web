"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useI18n } from "@/lib/i18n/client";
import { ALL_FILTER, EVIDENCE_CHIP, bgcTypeMeta } from "../constants";
import { formatRange } from "../format";
import { evidenceKey, extendedLength, nearestNeighbour, seedGeneOf } from "../stats";
import type { Region, RegionFilters } from "../types";

export function RegionExplorer({
  regions,
  allRegions,
  filters,
  bgcIds,
  detailHref,
  onFiltersChange,
}: {
  regions: Region[];
  allRegions: Region[];
  filters: RegionFilters;
  bgcIds: Map<number, string>;
  detailHref: (regionId: number) => string;
  onFiltersChange: (filters: RegionFilters) => void;
}) {
  const { t, locale } = useI18n();
  const contigs = uniqueSorted(allRegions.map((r) => `${r.genome_name}|${r.contig}`));
  const multiGenome = new Set(allRegions.map((r) => r.genome_name)).size > 1;
  const types = uniqueSorted(allRegions.map((r) => r.bgc_type || "Other"));
  const evidenceKeys = uniqueSortedKeys(allRegions);
  // Group rows by genome (first-appearance order follows the active sort), so
  // multi-genome jobs never look like one mixed pool of regions.
  const groupMap = new Map<string, Region[]>();
  for (const region of regions) {
    const arr = groupMap.get(region.genome_name);
    if (arr) arr.push(region);
    else groupMap.set(region.genome_name, [region]);
  }
  const genomeGroups = [...groupMap.entries()];
  const neighbours = nearestNeighbour(allRegions);

  return (
    <section className="panel min-w-0 overflow-hidden">
      {/* ── filter bar ─────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">
            {t.explorer.showing} <span className="numeric-display font-medium text-fg">{regions.length}</span>
            <span className="text-fg-subtle"> {t.explorer.of} {allRegions.length}</span> {t.explorer.regionsUnit}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              {t.explorer.sortLabel}
              <select
                value={filters.sort}
                onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as RegionFilters["sort"] })}
                className="h-8 rounded-btn border border-white/[0.08] bg-white/[0.02] px-2 text-xs text-fg outline-none transition-colors focus:border-brand/60"
              >
                <option value="position">{t.explorer.sortPosition}</option>
                <option value="evidence">{t.explorer.sortEvidence}</option>
              </select>
            </label>
            <label
              title={t.explorer.safeOnlyTip}
              className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              <input
                type="checkbox"
                checked={filters.safeOnly}
                onChange={(event) => onFiltersChange({ ...filters, safeOnly: event.target.checked })}
                className="checkbox"
              />
              {t.explorer.safeOnly}
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr,1fr,1fr,1.6fr]">
          <FilterSelect
            allLabel={t.explorer.allTypes}
            value={filters.bgcType}
            onChange={(value) => onFiltersChange({ ...filters, bgcType: value })}
            options={types.map((value) => ({ value, label: bgcTypeMeta(value).label }))}
          />
          <FilterSelect
            allLabel={t.explorer.allTiers}
            value={filters.tier}
            onChange={(value) => onFiltersChange({ ...filters, tier: value })}
            options={evidenceKeys.map((key) => ({ value: key, label: t.evidence[key as keyof typeof t.evidence] ?? key }))}
          />
          <FilterSelect
            allLabel={multiGenome ? t.explorer.allGenomes : t.explorer.allContigs}
            value={filters.contig}
            onChange={(value) => onFiltersChange({ ...filters, contig: value })}
            options={contigs.map((value) => ({
              value,
              label: multiGenome ? value.replace("|", " · ") : value.split("|")[1],
            }))}
          />
          <input
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            placeholder={t.explorer.searchPlaceholder}
            className="h-9 w-full min-w-0 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 text-small text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand/60"
          />
        </div>
      </div>

      {/* ── main table ─────────────────────────────────────── */}
      <div className="max-h-[46rem] overflow-auto">
        {regions.length === 0 ? (
          <div className="m-4 rounded-card border border-dashed border-white/[0.08] p-10 text-center text-sm text-fg-muted">
            {t.explorer.empty}
          </div>
        ) : (
          <table className="w-full min-w-[62rem] text-small">
            <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm">
              <tr className="border-b border-white/[0.06] text-left text-micro uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">{t.explorer.colBgc}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colContig}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.explorer.colSpan}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.explorer.colLen}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colType}</th>
                <th className="px-3 py-2.5 font-medium" title={t.explorer.evidenceTip}>{t.explorer.colEvidence}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colSeed}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colMibig}</th>
              </tr>
            </thead>
            <tbody>
              {genomeGroups.map(([genome, rows]) => {
                const nSafe = rows.filter((r) => r.safe_pass).length;
                return (
                  <Fragment key={genome}>
                    {multiGenome && (
                      <tr className="border-y border-white/[0.06] bg-white/[0.03]">
                        <td colSpan={8} className="px-4 py-2">
                          <span className="text-xs font-medium text-fg">{genome}</span>
                          <span className="ml-2 text-micro text-fg-subtle">
                            {rows.length} {t.explorer.regionsUnit}
                            {nSafe > 0 ? ` · ${nSafe} ${t.explorer.groupSafe}` : ""}
                          </span>
                        </td>
                      </tr>
                    )}
                    {rows.map((region) => (
                      <RegionRow
                        key={region.id}
                        region={region}
                        bgcId={bgcIds.get(region.id) ?? `R${region.id}`}
                        nearTip={formatNearTip(neighbours.get(region.id), bgcIds, t.explorer.nearClusterTip)}
                        evidenceLabel={t.evidence[evidenceKey(region)]}
                        detailUrl={detailHref(region.id)}
                        noHitLabel={t.explorer.noHit}
                        unknownProduct={t.explorer.unknownProduct}
                        locale={locale}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function RegionRow({
  region,
  bgcId,
  nearTip,
  evidenceLabel,
  detailUrl,
  noHitLabel,
  unknownProduct,
}: {
  region: Region;
  bgcId: string;
  nearTip?: string | null;
  evidenceLabel: string;
  detailUrl: string;
  noHitLabel: string;
  unknownProduct: string;
  locale: string;
}) {
  const topHit = region.mibig_hits?.[0];
  const typeMeta = bgcTypeMeta(region.bgc_type);
  const seed = seedGeneOf(region);
  const extLen = extendedLength(region);
  const spanStart = region.ext_start_bp ?? region.start_bp;
  const spanEnd = region.ext_end_bp ?? region.end_bp;

  return (
    <tr className="relative cursor-pointer border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03]">
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5">
          <Link
            href={detailUrl}
            className="font-mono text-caption font-medium text-fg transition-colors before:absolute before:inset-0 hover:text-brand"
          >
            {bgcId}
          </Link>
          {nearTip && (
            <span title={nearTip} className="relative z-10 text-fg-subtle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
            </span>
          )}
        </span>
      </td>
      <td className="max-w-[10rem] px-3 py-3">
        <div className="truncate font-mono text-xs text-fg" title={region.contig}>{region.contig}</div>
      </td>
      <td className="numeric-display px-3 py-3 text-right text-xs text-fg-muted">
        {formatRange(spanStart, spanEnd)}
      </td>
      <td className="numeric-display px-3 py-3 text-right text-xs">
        {Math.round(extLen ?? Math.max(0, region.end_bp - region.start_bp)).toLocaleString()}
      </td>
      <td className="max-w-[10rem] px-3 py-3">
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeMeta.barClassName}`} />
          <span className="min-w-0 truncate text-fg-muted">{typeMeta.label}</span>
        </span>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-micro font-medium ${EVIDENCE_CHIP[evidenceKey(region)]}`}>
          {evidenceLabel}
        </span>
      </td>
      <td className="max-w-[12rem] px-3 py-3">
        {seed ? (
          <span className="block truncate text-xs text-fg" title={seed.name}>
            {seed.name}
            {seed.extra > 0 && <span className="text-fg-subtle"> +{seed.extra}</span>}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="max-w-[11rem] px-3 py-3 text-xs">
        {topHit?.bgc_id ? (
          <span className="block" title={topHit.product || unknownProduct}>
            <span className="block truncate text-fg">{topHit.cluster_product || topHit.product || unknownProduct}</span>
            <span className="block truncate font-mono text-micro text-fg-subtle">
              {topHit.bgc_id}
              {topHit.identity != null && ` · ${Math.round(topHit.identity * 100)}%`}
            </span>
          </span>
        ) : (
          <span className="text-fg-subtle">{noHitLabel}</span>
        )}
      </td>
    </tr>
  );
}

function FilterSelect({
  allLabel,
  value,
  options,
  onChange,
}: {
  allLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full min-w-0 rounded-btn border border-white/[0.08] bg-white/[0.02] px-2.5 text-small text-fg outline-none transition-colors focus:border-brand/60"
    >
      <option value={ALL_FILTER}>{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function uniqueSortedKeys(regions: Region[]) {
  const order = ["tier1", "tier2", "tier3", "tier4", "tier5", "none"];
  const present = new Set(regions.map((r) => evidenceKey(r)));
  return order.filter((key) => present.has(key as never));
}

function formatNearTip(
  near: { id: number; gap: number } | undefined,
  bgcIds: Map<number, string>,
  template: string,
): string | null {
  if (!near) return null;
  const id = bgcIds.get(near.id) ?? `R${near.id}`;
  return template.replace("{id}", id).replace("{gap}", (near.gap / 1000).toFixed(1));
}
