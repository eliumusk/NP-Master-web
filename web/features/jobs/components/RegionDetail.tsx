"use client";

import { useI18n } from "@/lib/i18n/client";
import { bgcTypeMeta, functionClassMeta, tierClassName, tierLabel } from "../constants";
import { formatBp, formatPercent, formatRange, formatScore } from "../format";
import { countDomains, countFunctionClasses, extendedLength, regionLength } from "../stats";
import type { CdsFeature, MibigHit, PfamDomain, Region } from "../types";
import { GeneTrack } from "./GeneTrack";

type DomainRow = PfamDomain & {
  locusTag: string;
  functionClass?: string;
};

export function RegionDetail({ region }: { region: Region | null }) {
  const { t, locale } = useI18n();

  if (!region) {
    return (
      <aside className="rounded-card border border-dashed border-white/[0.1] bg-white/[0.02] p-10 text-center text-sm text-fg-muted">
        {t.detail.empty}
      </aside>
    );
  }

  const typeMeta = bgcTypeMeta(region.bgc_type);
  const functionCounts = countFunctionClasses(region.cds_features);
  const domainRows = flattenDomains(region.cds_features);

  return (
    <aside className="min-w-0 space-y-4">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{t.detail.title}</h2>
            <p className="mt-1 truncate font-mono text-xs text-fg-muted">{region.genome_name} · {region.contig}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-medium ${typeMeta.className}`}>{typeMeta.label}</span>
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-medium ${tierClassName(region.safe_tier, region.safe_pass)}`}>
              {tierLabel(region.safe_tier, locale)}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-btn border border-white/[0.06] bg-white/[0.05]">
          <Meta label={t.detail.metaCore} value={formatRange(region.start_bp, region.end_bp)} />
          <Meta
            label={t.detail.metaExt}
            value={region.ext_start_bp == null || region.ext_end_bp == null ? "-" : formatRange(region.ext_start_bp, region.ext_end_bp)}
          />
          <Meta label={t.detail.metaCoreLen} value={formatBp(regionLength(region))} />
          <Meta label={t.detail.metaExtLen} value={extendedLength(region) == null ? "-" : formatBp(extendedLength(region))} />
          <Meta label={t.detail.metaScore} value={formatScore(region.score)} />
          <Meta label={t.detail.metaTypeScore} value={formatScore(region.type_score)} />
          <Meta label={t.detail.metaSafeLabel} value={region.safe_type_label || "-"} />
          <Meta label={t.detail.metaCdsPfam} value={`${region.cds_features?.length ?? 0} / ${countDomains(region.cds_features)}`} />
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.detail.track}</h3>
          <span className="text-[11px] text-fg-subtle">{t.detail.trackNote}</span>
        </div>
        <GeneTrack region={region} />
      </section>

      <section className="panel p-5">
        <h3 className="text-sm font-semibold">{t.detail.typeScores}</h3>
        <TypeScores scores={region.type_scores} noData={t.detail.noTypeScores} />
      </section>

      <section className="panel p-5">
        <h3 className="text-sm font-semibold">{t.detail.functionOverview}</h3>
        {functionCounts.length === 0 ? (
          <div className="mt-3 text-sm text-fg-muted">{t.detail.noCds}</div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {functionCounts.map((item) => {
              const meta = functionClassMeta(item.key, locale);
              return (
                <span key={item.key} className={`inline-flex rounded-pill px-2 py-1 text-[11px] font-medium ${meta.className}`}>
                  {meta.label} · {item.count}
                </span>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.detail.cdsTable}</h3>
          <span className="numeric-display text-xs text-fg-subtle">{region.cds_features?.length ?? 0}</span>
        </div>
        <CdsTable cdsFeatures={region.cds_features ?? []} />
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.detail.pfamTable}</h3>
          <span className="numeric-display text-xs text-fg-subtle">{domainRows.length}</span>
        </div>
        <DomainTable domains={domainRows} />
      </section>

      <section className="panel p-5">
        <h3 className="text-sm font-semibold">{t.detail.mibigList}</h3>
        <MibigList hits={region.mibig_hits ?? []} />
      </section>
    </aside>
  );
}

function TypeScores({ scores, noData }: { scores: Record<string, number> | null; noData: string }) {
  const items = Object.entries(scores ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (items.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{noData}</div>;
  }

  return (
    <div className="mt-3 space-y-3">
      {items.map(([type, value]) => {
        const meta = bgcTypeMeta(type);
        const normalized = Number(value) <= 1 ? Number(value) : Number(value) / 100;
        return (
          <div key={type} className="grid grid-cols-[6.5rem,1fr,3.5rem] items-center gap-2 text-xs">
            <div className="truncate text-fg-muted">{meta.label}</div>
            <div className="h-1.5 overflow-hidden rounded-pill bg-white/[0.06]">
              <div className={`h-full rounded-pill ${meta.barClassName}`} style={{ width: `${Math.max(2, Math.min(100, normalized * 100))}%` }} />
            </div>
            <div className="numeric-display text-right text-fg">{formatPercent(Number(value))}</div>
          </div>
        );
      })}
    </div>
  );
}

function CdsTable({ cdsFeatures }: { cdsFeatures: CdsFeature[] }) {
  const { t, locale } = useI18n();
  if (cdsFeatures.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{t.detail.noCds}</div>;
  }

  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-btn border border-white/[0.06]">
      <table className="w-full min-w-[38rem] text-xs">
        <thead className="sticky top-0 bg-surface/95 text-left backdrop-blur-sm">
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="px-3 py-2.5 font-medium">{t.detail.colLocus}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colPos}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colStrand}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colFunc}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colPfam}</th>
          </tr>
        </thead>
        <tbody>
          {cdsFeatures.map((cds, index) => {
            const meta = functionClassMeta(cds.function_class, locale);
            return (
              <tr key={`${cds.locus_tag ?? "cds"}-${index}`} className="border-b border-white/[0.04] last:border-0">
                <td className="max-w-[10rem] px-3 py-2">
                  <div className="truncate font-mono text-fg">{cds.locus_tag || "-"}</div>
                  <div className="mt-0.5 truncate text-fg-subtle">{cds.product || "-"}</div>
                </td>
                <td className="numeric-display px-3 py-2 text-fg-muted">{formatRange(Number(cds.start ?? 0), Number(cds.end ?? 0))}</td>
                <td className="numeric-display px-3 py-2 text-fg-muted">{Number(cds.strand ?? 1) < 0 ? "−" : "+"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>{meta.label}</span>
                </td>
                <td className="numeric-display px-3 py-2 text-fg-muted">{cds.pfam_domains?.length ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DomainTable({ domains }: { domains: DomainRow[] }) {
  const { t, locale } = useI18n();
  if (domains.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{t.detail.noPfam}</div>;
  }

  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-btn border border-white/[0.06]">
      <table className="w-full min-w-[42rem] text-xs">
        <thead className="sticky top-0 bg-surface/95 text-left backdrop-blur-sm">
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="px-3 py-2.5 font-medium">{t.detail.colCds}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colDomain}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t.detail.colBits}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t.detail.colEvalue}</th>
            <th className="px-3 py-2.5 font-medium">{t.detail.colRange}</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((domain, index) => (
            <tr key={`${domain.locusTag}-${domain.accession ?? domain.name}-${index}`} className="border-b border-white/[0.04] last:border-0">
              <td className="max-w-[10rem] px-3 py-2">
                <div className="truncate font-mono text-fg">{domain.locusTag}</div>
                <div className="mt-0.5 truncate text-fg-subtle">{functionClassMeta(domain.functionClass, locale).label}</div>
              </td>
              <td className="max-w-[13rem] px-3 py-2">
                <div className="truncate font-medium text-fg">{domain.name || "-"}</div>
                <div className="mt-0.5 truncate font-mono text-fg-subtle">{domain.accession || "-"}</div>
              </td>
              <td className="numeric-display px-3 py-2 text-right text-fg-muted">{formatScore(domain.bitscore, 1)}</td>
              <td className="numeric-display px-3 py-2 text-right text-fg-muted">{formatScientific(domain.e_value)}</td>
              <td className="numeric-display px-3 py-2 text-fg-muted">
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
  const { t } = useI18n();
  if (hits.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{t.detail.noMibig}</div>;
  }

  return (
    <div className="mt-3 space-y-1.5">
      {hits.slice(0, 6).map((hit, index) => (
        <div key={`${hit.bgc_id ?? "hit"}-${index}`} className="rounded-btn border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-mono font-medium text-fg">{hit.bgc_id || "-"}</span>
            <span className="numeric-display shrink-0 text-brand">{hit.identity == null ? "-" : formatPercent(hit.identity)}</span>
          </div>
          <div className="mt-0.5 truncate text-fg-subtle">{hit.product || t.explorer.unknownProduct}</div>
        </div>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5">
      <div className="text-[11px] text-fg-subtle">{label}</div>
      <div className="numeric-display mt-0.5 truncate text-[13px] font-medium text-fg">{value}</div>
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
