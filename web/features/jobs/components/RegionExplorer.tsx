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
  const genomes = uniqueSorted(allRegions.map((region) => region.genome_name));
  const types = uniqueSorted(allRegions.map((region) => region.bgc_type || "Other"));
  const tiers = uniqueSorted(allRegions.map((region) => region.safe_tier || "未分级"));

  return (
    <section className="min-w-0 rounded-card border border-border bg-surface">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">候选区域</h2>
            <p className="mt-1 text-sm text-fg-muted">
              当前显示 <span className="numeric-display text-fg">{regions.length}</span> / {allRegions.length} 个区域
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-btn border border-border bg-elevated/40 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={filters.safeOnly}
              onChange={(event) => onFiltersChange({ ...filters, safeOnly: event.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            仅安全通过
          </label>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr,1fr,1fr,1.4fr]">
          <FilterSelect
            label="基因组"
            value={filters.genome}
            onChange={(value) => onFiltersChange({ ...filters, genome: value })}
            options={genomes.map((value) => ({ value, label: value }))}
          />
          <FilterSelect
            label="类型"
            value={filters.bgcType}
            onChange={(value) => onFiltersChange({ ...filters, bgcType: value })}
            options={types.map((value) => ({ value, label: bgcTypeMeta(value).label }))}
          />
          <FilterSelect
            label="等级"
            value={filters.tier}
            onChange={(value) => onFiltersChange({ ...filters, tier: value })}
            options={tiers.map((value) => ({ value, label: tierLabel(value) }))}
          />
          <label className="min-w-0 text-xs text-fg-muted">
            搜索
            <input
              value={filters.query}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
              placeholder="contig / MIBiG / 类型"
              className="mt-1 h-9 w-full rounded-btn border border-border bg-bg px-3 text-sm text-fg outline-none transition focus:border-brand"
            />
          </label>
        </div>
      </div>

      <div className="max-h-[46rem] overflow-auto">
        {regions.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-muted">没有匹配的区域。</div>
        ) : (
          <table className="w-full min-w-[58rem] text-sm">
            <thead className="sticky top-0 z-10 bg-elevated text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-3 font-medium">区域</th>
                <th className="px-3 py-3 font-medium">长度</th>
                <th className="px-3 py-3 text-right font-medium">分数</th>
                <th className="px-3 py-3 font-medium">类型</th>
                <th className="px-3 py-3 font-medium">等级</th>
                <th className="px-3 py-3 font-medium">CDS/Pfam</th>
                <th className="px-3 py-3 font-medium">MIBiG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {regions.map((region) => (
                <RegionRow
                  key={region.id}
                  region={region}
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

function RegionRow({ region, selected, onSelect }: { region: Region; selected: boolean; onSelect: () => void }) {
  const topHit = region.mibig_hits?.[0];
  const typeMeta = bgcTypeMeta(region.bgc_type);

  return (
    <tr
      className={`cursor-pointer transition hover:bg-elevated/60 ${selected ? "bg-brand-soft/70" : "bg-surface"}`}
      onClick={onSelect}
    >
      <td className="max-w-[18rem] px-3 py-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-medium">{region.genome_name}</div>
          <div className="mt-1 truncate font-mono text-xs text-fg-muted">{region.contig}</div>
          <div className="numeric-display mt-1 text-xs text-fg-muted">{formatRange(region.start_bp, region.end_bp)}</div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="numeric-display text-xs">{formatBp(regionLength(region))}</div>
        <div className="numeric-display mt-1 text-xs text-fg-muted">
          扩展 {extendedLength(region) == null ? "-" : formatBp(extendedLength(region))}
        </div>
      </td>
      <td className="numeric-display px-3 py-3 text-right">{formatScore(region.score)}</td>
      <td className="px-3 py-3">
        <span className={`inline-flex max-w-32 items-center rounded-pill px-2 py-0.5 text-xs font-medium ${typeMeta.className}`}>
          <span className="truncate">{typeMeta.label}</span>
        </span>
        <div className="numeric-display mt-1 text-xs text-fg-muted">{formatScore(region.type_score)}</div>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex max-w-44 items-center rounded-pill px-2 py-0.5 text-xs font-medium ${tierClassName(region.safe_tier, region.safe_pass)}`}>
          <span className="truncate">{tierLabel(region.safe_tier)}</span>
        </span>
        <div className="mt-1 text-xs text-fg-muted">{region.safe_pass ? "通过" : "未通过"}</div>
      </td>
      <td className="numeric-display px-3 py-3 text-xs">
        {(region.cds_features?.length ?? 0).toLocaleString()} / {countDomains(region.cds_features).toLocaleString()}
      </td>
      <td className="max-w-[13rem] px-3 py-3 text-xs">
        {topHit?.bgc_id ? (
          <>
            <div className="truncate font-mono">{topHit.bgc_id}</div>
            <div className="mt-1 truncate text-fg-muted">
              {topHit.product || "未知产物"} {topHit.identity != null ? `· ${Math.round(topHit.identity * 100)}%` : ""}
            </div>
          </>
        ) : (
          <span className="text-fg-muted">无近邻</span>
        )}
      </td>
    </tr>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 text-xs text-fg-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-btn border border-border bg-bg px-2 text-sm text-fg outline-none transition focus:border-brand"
      >
        <option value={ALL_FILTER}>全部</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
