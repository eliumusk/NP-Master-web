"use client";

import { useI18n } from "@/lib/i18n/client";
import { ALL_FILTER, bgcTypeMeta, tierClassName, tierLabel } from "../constants";
import { formatBp, formatRange, formatScore } from "../format";
import { countDomains, extendedLength, regionLength } from "../stats";
import type { Region, RegionFilters } from "../types";

export function RegionExplorer({
  regions,
  allRegions,
  filters,
  selectedRegionId,
  onFiltersChange,
  onSelectRegion,
}: {
  regions: Region[];
  allRegions: Region[];
  filters: RegionFilters;
  selectedRegionId: number | null;
  onFiltersChange: (filters: RegionFilters) => void;
  onSelectRegion: (regionId: number) => void;
}) {
  const { t, locale } = useI18n();
  const genomes = uniqueSorted(allRegions.map((region) => region.genome_name));
  const types = uniqueSorted(allRegions.map((region) => region.bgc_type || "Other"));
  const tiers = uniqueSorted(allRegions.map((region) => region.safe_tier || ""));

  return (
    <section className="panel min-w-0 overflow-hidden">
      <div className="border-b border-white/[0.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">{t.explorer.title}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {t.explorer.showing} <span className="numeric-display text-brand">{regions.length}</span>
              <span className="text-fg-subtle"> {t.explorer.of} {allRegions.length}</span> {t.explorer.regionsUnit}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs transition hover:border-white/20">
            <input
              type="checkbox"
              checked={filters.safeOnly}
              onChange={(event) => onFiltersChange({ ...filters, safeOnly: event.target.checked })}
              className="h-3.5 w-3.5 accent-brand"
            />
            {t.explorer.safeOnly}
          </label>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr,1fr,1fr,1.4fr]">
          <FilterSelect
            allLabel={t.explorer.allGenomes}
            value={filters.genome}
            onChange={(value) => onFiltersChange({ ...filters, genome: value })}
            options={genomes.map((value) => ({ value, label: value }))}
          />
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
            options={tiers.map((value) => ({ value, label: tierLabel(value, locale) }))}
          />
          <input
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            placeholder={t.explorer.searchPlaceholder}
            className="h-9 w-full min-w-0 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 text-[13px] text-fg outline-none transition placeholder:text-fg-subtle focus:border-brand/60"
          />
        </div>
      </div>

      <div className="max-h-[46rem] overflow-auto">
        {regions.length === 0 ? (
          <div className="p-10 text-center text-sm text-fg-muted">{t.explorer.empty}</div>
        ) : (
          <table className="w-full min-w-[58rem] text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm">
              <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">{t.explorer.colRegion}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colLength}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.explorer.colScore}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colType}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colTier}</th>
                <th className="px-3 py-2.5 font-medium">{t.explorer.colCds}</th>
                <th className="px-4 py-2.5 font-medium">{t.explorer.colMibig}</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((region) => (
                <RegionRow
                  key={region.id}
                  region={region}
                  locale={locale}
                  selected={region.id === selectedRegionId}
                  onSelect={() => onSelectRegion(region.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function RegionRow({
  region,
  locale,
  selected,
  onSelect,
}: {
  region: Region;
  locale: "zh" | "en";
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const topHit = region.mibig_hits?.[0];
  const typeMeta = bgcTypeMeta(region.bgc_type);
  const scorePct = Math.round(Math.min(1, Math.max(0, region.score)) * 100);

  return (
    <tr
      className={`cursor-pointer border-b border-white/[0.04] transition ${
        selected
          ? "bg-brand/[0.07] shadow-[inset_2px_0_0_rgb(var(--brand))]"
          : "hover:bg-white/[0.03]"
      }`}
      onClick={onSelect}
    >
      <td className="max-w-[18rem] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-medium text-fg">{region.genome_name}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{region.contig}</div>
          <div className="numeric-display mt-0.5 text-[11px] text-fg-subtle">{formatRange(region.start_bp, region.end_bp)}</div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="numeric-display text-xs">{formatBp(regionLength(region))}</div>
        <div className="numeric-display mt-0.5 text-[11px] text-fg-subtle">
          {t.explorer.ext} {extendedLength(region) == null ? "-" : formatBp(extendedLength(region))}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <div className="hidden h-1 w-14 overflow-hidden rounded-pill bg-white/[0.06] md:block">
            <div className="h-full rounded-pill bg-gradient-to-r from-brand/60 to-brand" style={{ width: `${scorePct}%` }} />
          </div>
          <span className="numeric-display text-xs text-fg">{formatScore(region.score)}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex max-w-32 items-center rounded-pill px-2 py-0.5 text-[11px] font-medium ${typeMeta.className}`}>
          <span className="truncate">{typeMeta.label}</span>
        </span>
        <div className="numeric-display mt-0.5 text-[11px] text-fg-subtle">{formatScore(region.type_score)}</div>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex max-w-44 items-center rounded-pill px-2 py-0.5 text-[11px] font-medium ${tierClassName(region.safe_tier, region.safe_pass)}`}>
          <span className="truncate">{tierLabel(region.safe_tier, locale)}</span>
        </span>
        <div className="mt-0.5 text-[11px] text-fg-subtle">{region.safe_pass ? t.explorer.pass : t.explorer.fail}</div>
      </td>
      <td className="numeric-display px-3 py-3 text-xs text-fg-muted">
        {(region.cds_features?.length ?? 0).toLocaleString()} / {countDomains(region.cds_features).toLocaleString()}
      </td>
      <td className="max-w-[13rem] px-4 py-3 text-xs">
        {topHit?.bgc_id ? (
          <>
            <div className="truncate font-mono text-fg">{topHit.bgc_id}</div>
            <div className="mt-0.5 truncate text-fg-subtle">
              {topHit.product || t.explorer.unknownProduct} {topHit.identity != null ? `· ${Math.round(topHit.identity * 100)}%` : ""}
            </div>
          </>
        ) : (
          <span className="text-fg-subtle">{t.explorer.noHit}</span>
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
      className="h-9 w-full min-w-0 rounded-btn border border-white/[0.08] bg-white/[0.02] px-2.5 text-[13px] text-fg outline-none transition focus:border-brand/60"
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
