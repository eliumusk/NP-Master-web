import { bgcTypeMeta, functionClassMeta, tierClassName, tierLabel } from "../constants";
import { formatBp, formatPercent, formatRange, formatScore } from "../format";
import { countDomains, countFunctionClasses, extendedLength, regionLength } from "../stats";
import type { CdsFeature, MibigHit, PfamDomain, Region } from "../types";

type DomainRow = PfamDomain & {
  locusTag: string;
  functionClass?: string;
};

export function RegionDetail({ region }: { region: Region | null }) {
  if (!region) {
    return (
      <aside className="rounded-card border border-dashed border-border bg-elevated/30 p-8 text-center text-sm text-fg-muted">
        选择一个区域查看 CDS、Pfam 和类型证据。
      </aside>
    );
  }

  const typeMeta = bgcTypeMeta(region.bgc_type);
  const functionCounts = countFunctionClasses(region.cds_features);
  const domainRows = flattenDomains(region.cds_features);

  return (
    <aside className="min-w-0 space-y-4">
      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">区域详情</h2>
            <p className="mt-1 truncate font-mono text-xs text-fg-muted">{region.genome_name} · {region.contig}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${typeMeta.className}`}>{typeMeta.label}</span>
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${tierClassName(region.safe_tier, region.safe_pass)}`}>
              {tierLabel(region.safe_tier)}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Meta label="核心坐标" value={formatRange(region.start_bp, region.end_bp)} />
          <Meta
            label="扩展坐标"
            value={region.ext_start_bp == null || region.ext_end_bp == null ? "-" : formatRange(region.ext_start_bp, region.ext_end_bp)}
          />
          <Meta label="核心长度" value={formatBp(regionLength(region))} />
          <Meta label="扩展长度" value={extendedLength(region) == null ? "-" : formatBp(extendedLength(region))} />
          <Meta label="区域分数" value={formatScore(region.score)} />
          <Meta label="类型分数" value={formatScore(region.type_score)} />
          <Meta label="安全标签" value={region.safe_type_label || "-"} />
          <Meta label="CDS / Pfam" value={`${region.cds_features?.length ?? 0} / ${countDomains(region.cds_features)}`} />
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">类型概率</h3>
        <TypeScores scores={region.type_scores} />
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">功能域概览</h3>
        {functionCounts.length === 0 ? (
          <div className="mt-3 text-sm text-fg-muted">暂无 CDS 注释。</div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {functionCounts.map((item) => {
              const meta = functionClassMeta(item.key);
              return (
                <span key={item.key} className={`inline-flex rounded-pill px-2 py-1 text-xs font-medium ${meta.className}`}>
                  {meta.label} · {item.count}
                </span>
              );
            })}
          </div>
        )}
        <CdsTrack region={region} />
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">CDS 明细</h3>
          <span className="numeric-display text-xs text-fg-muted">{region.cds_features?.length ?? 0}</span>
        </div>
        <CdsTable cdsFeatures={region.cds_features ?? []} />
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Pfam hits</h3>
          <span className="numeric-display text-xs text-fg-muted">{domainRows.length}</span>
        </div>
        <DomainTable domains={domainRows} />
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">MIBiG 近邻</h3>
        <MibigList hits={region.mibig_hits ?? []} />
      </section>
    </aside>
  );
}

function TypeScores({ scores }: { scores: Record<string, number> | null }) {
  const items = Object.entries(scores ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (items.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">暂无分类概率。</div>;
  }

  return (
    <div className="mt-3 space-y-3">
      {items.map(([type, value]) => {
        const meta = bgcTypeMeta(type);
        const normalized = Number(value) <= 1 ? Number(value) : Number(value) / 100;
        return (
          <div key={type} className="grid grid-cols-[6.5rem,1fr,3.5rem] items-center gap-2 text-xs">
            <div className="truncate text-fg-muted">{meta.label}</div>
            <div className="h-2 overflow-hidden rounded-pill bg-elevated">
              <div className={`h-full rounded-pill ${meta.barClassName}`} style={{ width: `${Math.max(2, Math.min(100, normalized * 100))}%` }} />
            </div>
            <div className="numeric-display text-right">{formatPercent(Number(value))}</div>
          </div>
        );
      })}
    </div>
  );
}

function CdsTrack({ region }: { region: Region }) {
  const cdsFeatures = region.cds_features ?? [];
  if (cdsFeatures.length === 0) return null;

  const extent = Math.max(regionLength(region), ...cdsFeatures.map((cds) => Number(cds.end ?? 0)));

  return (
    <div className="mt-4 overflow-hidden rounded-btn border border-border bg-elevated/30 p-3">
      <div className="relative h-16">
        <div className="absolute left-0 right-0 top-7 h-px bg-border" />
        {cdsFeatures.map((cds, index) => {
          const start = Math.max(0, Number(cds.start ?? 0));
          const end = Math.max(start + 1, Number(cds.end ?? start + 1));
          const left = (start / extent) * 100;
          const width = Math.max(0.8, ((end - start) / extent) * 100);
          const meta = functionClassMeta(cds.function_class);
          return (
            <div
              key={`${cds.locus_tag ?? "cds"}-${index}`}
              title={`${cds.locus_tag ?? "CDS"} ${start}-${end}`}
              className={`absolute top-4 h-6 rounded-btn border border-bg/60 ${meta.className}`}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-fg-muted">
        <span>0 bp</span>
        <span>{formatBp(extent)}</span>
      </div>
    </div>
  );
}

function CdsTable({ cdsFeatures }: { cdsFeatures: CdsFeature[] }) {
  if (cdsFeatures.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">暂无 CDS 注释。</div>;
  }

  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-btn border border-border">
      <table className="w-full min-w-[38rem] text-xs">
        <thead className="sticky top-0 bg-elevated text-left text-fg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">locus</th>
            <th className="px-3 py-2 font-medium">位置</th>
            <th className="px-3 py-2 font-medium">方向</th>
            <th className="px-3 py-2 font-medium">功能</th>
            <th className="px-3 py-2 font-medium">Pfam</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cdsFeatures.map((cds, index) => {
            const meta = functionClassMeta(cds.function_class);
            return (
              <tr key={`${cds.locus_tag ?? "cds"}-${index}`}>
                <td className="max-w-[10rem] px-3 py-2">
                  <div className="truncate font-mono">{cds.locus_tag || "-"}</div>
                  <div className="mt-1 truncate text-fg-muted">{cds.product || "-"}</div>
                </td>
                <td className="numeric-display px-3 py-2">{formatRange(Number(cds.start ?? 0), Number(cds.end ?? 0))}</td>
                <td className="numeric-display px-3 py-2">{Number(cds.strand ?? 1) < 0 ? "-" : "+"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-pill px-2 py-0.5 font-medium ${meta.className}`}>{meta.label}</span>
                </td>
                <td className="px-3 py-2">{cds.pfam_domains?.length ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DomainTable({ domains }: { domains: DomainRow[] }) {
  if (domains.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">暂无 Pfam 命中。</div>;
  }

  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-btn border border-border">
      <table className="w-full min-w-[42rem] text-xs">
        <thead className="sticky top-0 bg-elevated text-left text-fg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">CDS</th>
            <th className="px-3 py-2 font-medium">domain</th>
            <th className="px-3 py-2 text-right font-medium">bitscore</th>
            <th className="px-3 py-2 text-right font-medium">e-value</th>
            <th className="px-3 py-2 font-medium">范围</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {domains.map((domain, index) => (
            <tr key={`${domain.locusTag}-${domain.accession ?? domain.name}-${index}`}>
              <td className="max-w-[10rem] px-3 py-2">
                <div className="truncate font-mono">{domain.locusTag}</div>
                <div className="mt-1 truncate text-fg-muted">{functionClassMeta(domain.functionClass).label}</div>
              </td>
              <td className="max-w-[13rem] px-3 py-2">
                <div className="truncate font-medium">{domain.name || "-"}</div>
                <div className="mt-1 truncate font-mono text-fg-muted">{domain.accession || "-"}</div>
              </td>
              <td className="numeric-display px-3 py-2 text-right">{formatScore(domain.bitscore, 1)}</td>
              <td className="numeric-display px-3 py-2 text-right">{formatScientific(domain.e_value)}</td>
              <td className="numeric-display px-3 py-2">
                {domain.env_start == null || domain.env_end == null ? "-" : `${domain.env_start}-${domain.env_end}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MibigList({ hits }: { hits: MibigHit[] }) {
  if (hits.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">暂无 MIBiG 近邻。</div>;
  }

  return (
    <div className="mt-3 space-y-2">
      {hits.slice(0, 6).map((hit, index) => (
        <div key={`${hit.bgc_id ?? "hit"}-${index}`} className="rounded-btn border border-border bg-elevated/30 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-mono font-medium">{hit.bgc_id || "-"}</span>
            <span className="numeric-display shrink-0 text-fg-muted">{hit.identity == null ? "-" : formatPercent(hit.identity)}</span>
          </div>
          <div className="mt-1 truncate text-fg-muted">{hit.product || "未知产物"}</div>
        </div>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-btn border border-border bg-elevated/30 px-3 py-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="numeric-display mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function flattenDomains(cdsFeatures: CdsFeature[] | null | undefined) {
  const rows: DomainRow[] = [];
  for (const cds of cdsFeatures ?? []) {
    for (const domain of cds.pfam_domains ?? []) {
      rows.push({
        ...domain,
        locusTag: cds.locus_tag || "-",
        functionClass: cds.function_class,
      });
    }
  }
  return rows.sort((a, b) => Number(b.bitscore ?? 0) - Number(a.bitscore ?? 0));
}

function formatScientific(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toExponential(1);
}
