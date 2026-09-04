"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SignedJobArtifact } from "@/lib/job-artifacts";
import { useI18n } from "@/lib/i18n/client";
import { EVIDENCE_CHIP, bgcTypeMeta, functionClassColor, functionClassMeta } from "../constants";
import { formatBp, formatPercent, formatRange, formatScore } from "../format";
import { cdsDisplayFunction, evidenceKey, extendedLength, seedGeneOf } from "../stats";
import type { CdsFeature, PfamDomain, Region } from "../types";
import { FeedbackBox } from "./FeedbackBox";
import { GeneTrack } from "./GeneTrack";

export function RegionDetailView({
  jobId,
  jobTitle,
  region,
  bgcId,
  genomeArtifacts,
  isLoggedIn,
  annoSourceGff3,
  backHref,
}: {
  jobId: string;
  jobTitle: string;
  region: Region;
  bgcId: string;
  genomeArtifacts: SignedJobArtifact[];
  isLoggedIn: boolean;
  annoSourceGff3: boolean;
  backHref: string;
}) {
  const { t, locale } = useI18n();
  const typeMeta = bgcTypeMeta(region.bgc_type);
  const seed = seedGeneOf(region);
  const extLen = extendedLength(region);
  const spanStart = region.ext_start_bp ?? region.start_bp;
  const spanEnd = region.ext_end_bp ?? region.end_bp;
  // Degenerate CDS rows (end <= start) cannot be drawn on the gene track, so
  // they are dropped here once — the gene map, this table and the detail card
  // all share the same array and therefore the same indexes.
  const cdsList = (region.cds_features ?? []).filter(
    (cds) => Number(cds.end ?? 0) > Number(cds.start ?? 0),
  );
  const [selectedCds, setSelectedCds] = useState<number | null>(null);
  const selected = selectedCds != null && selectedCds < cdsList.length ? cdsList[selectedCds] : null;
  const dnaArtifact = genomeArtifacts.find((a) => a.kind === "extended_regions_fna");

  return (
    <div className="animate-fade-in mx-auto w-full max-w-6xl space-y-5 px-5 sm:px-6">
      {/* ── header ─────────────────────────────────────────── */}
      <div>
        <Link
          href={backHref}
          className="inline-flex max-w-full items-center gap-1 text-xs text-fg-muted transition-colors duration-150 hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="truncate">{t.region.back} · {jobTitle}</span>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{bgcId}</h1>
          <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-xs font-medium ${typeMeta.className}`}>
            {typeMeta.label}
          </span>
          <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-xs font-medium ${EVIDENCE_CHIP[evidenceKey(region)]}`}>
            {t.evidence[evidenceKey(region)]}
          </span>
        </div>
        <p className="numeric-display mt-2 text-sm text-fg-muted">
          {region.genome_name === region.contig
            ? region.contig
            : `${region.genome_name} · ${region.contig}`} · {formatRange(spanStart, spanEnd)} · {extLen != null ? formatBp(extLen) : formatBp(region.end_bp - region.start_bp)}
        </p>
      </div>

      {/* ── 1. gene map + selected-gene panel ──────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.track}</h2>
        <div className="lg:flex lg:items-start lg:gap-5">
          <div className="min-w-0 flex-1">
            <GeneTrack region={region} cdsList={cdsList} selectedIndex={selectedCds} onSelect={setSelectedCds} />
          </div>
          {cdsList.length > 0 && (
            <div className="mt-4 lg:mt-3 lg:w-80 lg:shrink-0">
              {selected != null && selectedCds != null ? (
                <CdsDetailCard cds={selected} index={selectedCds} onClose={() => setSelectedCds(null)} />
              ) : (
                <p className="rounded-btn border border-dashed border-white/[0.08] px-3 py-2.5 text-xs text-fg-subtle">
                  {t.region.selectGeneHint}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 2. gene / CDS overview ─────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.cdsOverview}</h2>
        {cdsList.length === 0 ? (
          <div className="mt-3 text-sm text-fg-muted">{t.region.noCds}</div>
        ) : (
          <div className="mt-3 overflow-auto rounded-btn border border-white/[0.06]">
            <table className="w-full min-w-[40rem] text-xs">
              <thead className="sticky top-0 bg-surface/95 text-left backdrop-blur-sm">
                <tr className="border-b border-white/[0.06] text-micro uppercase tracking-wider text-fg-subtle">
                  <th className="px-3 py-2.5 font-medium">{t.region.colGene}</th>
                  <th className="px-3 py-2.5 font-medium">{t.region.colProduct}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.region.colCdsLen}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.region.colAaLen}</th>
                  <th className="px-3 py-2.5 font-medium">{t.region.colClass}</th>
                </tr>
              </thead>
              <tbody>
                {cdsList.map((cds, i) => {
                  const fn = cdsDisplayFunction(cds);
                  const fnText = fn ? `${fn.text}${fn.pfamPredicted ? ` ${t.region.pfamPredicted}` : ""}` : "-";
                  return (
                    <tr
                      key={`${cds.locus_tag ?? "cds"}-${i}`}
                      onClick={() => setSelectedCds(selectedCds === i ? null : i)}
                      className={`cursor-pointer border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03] ${selectedCds === i ? "bg-brand/[0.08]" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-fg">{cds.locus_tag || `cds_${i + 1}`}</td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <span className="block truncate text-fg-muted" title={fn ? fn.text : ""}>{fnText}</span>
                      </td>
                      <td className="numeric-display px-3 py-2 text-right text-fg-muted">
                        {formatBp(Math.max(0, Number(cds.end ?? 0) - Number(cds.start ?? 0)))}
                      </td>
                      <td className="numeric-display px-3 py-2 text-right text-fg-muted">
                        {cds.length_aa != null ? `${cds.length_aa} aa` : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: functionClassColor(cds.function_class) }}
                          />
                          <span className="truncate text-fg-muted">{functionClassMeta(cds.function_class, locale).label}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. core domains ────────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.coreDomains}</h2>
        {seed && (
          <div className="mt-3 rounded-btn border border-brand/25 bg-brand/[0.06] px-3 py-2 text-xs">
            <span className="text-fg-subtle">{t.region.seedEvidence}: </span>
            <span className="font-medium text-fg">{seed.name}</span>
            {seed.extra > 0 && <span className="text-fg-subtle"> +{seed.extra}</span>}
          </div>
        )}
        <DomainTable domains={flattenDomains(cdsList)} />
      </section>

      {/* ── 4. MIBiG comparison ────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.mibigCompare}</h2>
        <MibigPanel region={region} />
      </section>

      {/* ── 5. evidence ────────────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.evidence}</h2>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-btn border border-white/[0.06] bg-white/[0.06] sm:grid-cols-4">
          <EvidenceMeta label={t.region.coreScore} value={formatScore(region.score)} />
          <EvidenceMeta label={t.region.typeScore} value={formatScore(region.type_score)} />
          <EvidenceMeta label={t.region.evidenceRating} value={t.evidence[evidenceKey(region)]} />
          <EvidenceMeta label={t.region.annoSource} value={annoSourceGff3 ? t.region.srcGff3 : t.region.srcProdigal} />
        </div>
        <TypeScores scores={region.type_scores} />
      </section>

      {/* ── 6. sequences ───────────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.region.sequences}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <SeqButton
            label={t.region.seqProtein}
            title={`${bgcId}_cds.faa`}
            disabled={!cdsList.some((c) => c.aa_sequence)}
            onClick={() => downloadFasta(`${bgcId}_cds.faa`, cdsList, "aa")}
          />
          <SeqButton
            label={t.region.seqNt}
            title={`${bgcId}_cds.fna`}
            disabled={!cdsList.some((c) => c.nt_sequence)}
            onClick={() => downloadFasta(`${bgcId}_cds.fna`, cdsList, "nt")}
          />
          {dnaArtifact ? (
            <a href={dnaArtifact.url} title={dnaArtifact.filename} className={seqBtnClass(false)}>
              {t.region.seqDna}
            </a>
          ) : (
            <span className={seqBtnClass(true)}>{t.region.seqDna}</span>
          )}
        </div>
      </section>

      {/* ── feedback ───────────────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">{t.feedback.regionTitle}</h2>
        <p className="mt-1 text-xs text-fg-muted">{t.feedback.hint}</p>
        <div className="mt-3">
          <FeedbackBox jobId={jobId} regionId={region.id} isLoggedIn={isLoggedIn} variant="region" />
        </div>
      </section>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────── */

function seqBtnClass(disabled: boolean) {
  return `rounded-btn border px-3 py-2.5 text-left text-xs font-medium transition-colors duration-150 ${
    disabled
      ? "cursor-not-allowed border-white/[0.06] text-fg-subtle"
      : "border-white/[0.08] bg-white/[0.02] text-fg hover:border-white/[0.16] hover:bg-white/[0.04]"
  }`;
}

function SeqButton({ label, title, disabled, onClick }: { label: string; title?: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={seqBtnClass(disabled)}>
      {label}
    </button>
  );
}

function downloadFasta(filename: string, cdsList: CdsFeature[], kind: "aa" | "nt") {
  const records = cdsList
    .map((cds, i) => {
      const seq = (kind === "aa" ? cds.aa_sequence : cds.nt_sequence) ?? "";
      if (!seq) return null;
      const header = `${cds.locus_tag ?? `cds_${i + 1}`} ${cds.product ?? ""}`.trim();
      return `>${header}\n${seq.replace(/(.{80})/g, "$1\n")}`;
    })
    .filter(Boolean);
  if (records.length === 0) return;
  const blob = new Blob([records.join("\n") + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TypeScores({ scores }: { scores: Record<string, number> | null }) {
  const items = Object.entries(scores ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6);
  if (items.length === 0) return null;
  return (
    <div className="mt-4 space-y-2.5">
      {items.map(([type, value], i) => {
        const meta = bgcTypeMeta(type);
        const normalized = Number(value) <= 1 ? Number(value) : Number(value) / 100;
        return (
          <div key={type} className="grid grid-cols-[7rem,1fr,3.5rem] items-center gap-2 text-xs">
            <div className="truncate text-fg-muted">{meta.label}</div>
            <div className="h-1.5 overflow-hidden rounded-pill bg-white/[0.06]">
              <div
                className={`h-full rounded-pill ${i === 0 ? meta.barClassName : "bg-white/20"}`}
                style={{ width: `${Math.max(2, Math.min(100, normalized * 100))}%` }}
              />
            </div>
            <div className="numeric-display text-right text-fg">{formatPercent(Number(value))}</div>
          </div>
        );
      })}
    </div>
  );
}

function MibigPanel({ region }: { region: Region }) {
  const { t } = useI18n();
  const hits = region.mibig_hits ?? [];
  if (hits.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{t.region.noMibig}</div>;
  }
  const best = hits[0];
  const bestCluster = best.cluster_product || best.product || t.explorer.unknownProduct;
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-btn border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
        <EvidenceMeta label={t.region.mibigBest} value={best.bgc_id || "-"} mono />
        <EvidenceMeta
          label={t.region.mibigProduct}
          value={bestCluster}
          title={best.cluster_product && best.product ? best.product : undefined}
        />
        <EvidenceMeta label={t.region.mibigIdentity} value={best.identity == null ? "-" : formatPercent(best.identity)} />
      </div>
      {hits.length > 1 && (
        <div className="space-y-1.5">
          {hits.slice(1, 5).map((hit, i) => (
            <div key={`${hit.bgc_id ?? "hit"}-${i}`} className="flex items-center justify-between gap-3 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs">
              <span className="truncate font-mono text-fg">{hit.bgc_id || "-"}</span>
              <span className="truncate text-fg-subtle" title={hit.cluster_product && hit.product ? hit.product : undefined}>
                {hit.cluster_product || hit.product || t.explorer.unknownProduct}
              </span>
              <span className="numeric-display shrink-0 text-brand">{hit.identity == null ? "-" : formatPercent(hit.identity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DomainTable({ domains }: { domains: Array<PfamDomain & { locusTag: string }> }) {
  const { t } = useI18n();
  if (domains.length === 0) {
    return <div className="mt-3 text-sm text-fg-muted">{t.region.noPfam}</div>;
  }
  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-btn border border-white/[0.06]">
      <table className="w-full min-w-[38rem] text-xs">
        <thead className="sticky top-0 bg-surface/95 text-left backdrop-blur-sm">
          <tr className="border-b border-white/[0.06] text-micro uppercase tracking-wider text-fg-subtle">
            <th className="px-3 py-2.5 font-medium">{t.region.colGene}</th>
            <th className="px-3 py-2.5 font-medium">{t.region.colDomain}</th>
            <th className="px-3 py-2.5 font-medium">{t.region.colAcc}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t.region.colBits}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t.region.colEvalue}</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d, i) => (
            <tr key={`${d.locusTag}-${d.accession ?? d.name}-${i}`} className="border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03]">
              <td className="px-3 py-2 font-mono text-fg">{d.locusTag}</td>
              <td className="max-w-[14rem] px-3 py-2">
                <span className="block truncate text-fg" title={d.name || ""}>{d.name || "-"}</span>
              </td>
              <td className="px-3 py-2 font-mono text-fg-muted">{d.accession || "-"}</td>
              <td className="numeric-display px-3 py-2 text-right text-fg-muted">{formatScore(d.bitscore, 1)}</td>
              <td className="numeric-display px-3 py-2 text-right text-fg-muted">
                {d.e_value == null ? "-" : Number(d.e_value).toExponential(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceMeta({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  // Numeric-looking values get tabular figures; text stays in the base font.
  const numeric = /^[\d.,%\-– ]+$/.test(value);
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5" title={title}>
      <div className="text-micro text-fg-subtle">{label}</div>
      <div className={`mt-0.5 truncate text-small font-medium text-fg ${mono ? "font-mono" : numeric ? "numeric-display" : ""}`}>{value}</div>
    </div>
  );
}

/* ── selected-CDS detail card (antiSMASH-style side panel) ── */

function CdsDetailCard({ cds, index, onClose }: { cds: CdsFeature; index: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const fn = cdsDisplayFunction(cds);
  const classMeta = functionClassMeta(cds.function_class, locale);
  const start = Number(cds.start ?? 0);
  const end = Number(cds.end ?? 0);
  const strand = Number(cds.strand ?? 1);
  const domains = [...(cds.pfam_domains ?? [])].sort((a, b) => Number(b.bitscore ?? 0) - Number(a.bitscore ?? 0));

  return (
    <div className="rounded-btn border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-sm font-semibold text-fg">{cds.locus_tag || `cds_${index + 1}`}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="×"
          className="shrink-0 rounded-btn px-1.5 text-sm leading-5 text-fg-subtle transition-colors hover:text-fg"
        >
          ×
        </button>
      </div>
      <div className="mt-1.5">
        <span className={`inline-flex rounded-pill px-2 py-0.5 text-micro font-medium ${classMeta.className}`}>
          {classMeta.label}
        </span>
      </div>

      <dl className="mt-3 space-y-2 text-xs">
        <CardRow label={t.region.cardFunction} title={fn?.text}>
          {fn ? `${fn.text}${fn.pfamPredicted ? ` ${t.region.pfamPredicted}` : ""}` : "-"}
        </CardRow>
        <CardRow label={t.region.cardLocation}>
          <span className="font-mono">{formatRange(start, end)} ({strand < 0 ? "−" : "+"})</span>
        </CardRow>
        <CardRow label={t.region.colCdsLen}>{formatBp(Math.max(0, end - start))}</CardRow>
        <CardRow label={t.region.colAaLen}>{cds.length_aa != null ? `${cds.length_aa} aa` : "-"}</CardRow>
      </dl>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <div className="text-micro uppercase tracking-wider text-fg-subtle">{t.region.cardPfam}</div>
        {domains.length === 0 ? (
          <div className="mt-1.5 text-xs text-fg-subtle">{t.region.noPfam}</div>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {domains.map((d, i) => (
              <li key={`${d.accession ?? d.name ?? "dom"}-${i}`} className="rounded-btn border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-micro">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-fg" title={d.name || ""}>{d.name || "-"}</span>
                  <span className="shrink-0 font-mono text-fg-subtle">{d.accession || "-"}</span>
                </div>
                <div className="numeric-display mt-0.5 text-fg-subtle">
                  E={d.e_value == null ? "-" : Number(d.e_value).toExponential(1)} · bits {formatScore(d.bitscore, 1)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 grid gap-2">
        <CopySeqButton label={t.region.copyAa} copiedLabel={t.region.copied} seq={cds.aa_sequence} />
        <CopySeqButton label={t.region.copyNt} copiedLabel={t.region.copied} seq={cds.nt_sequence} />
      </div>
    </div>
  );
}

function CardRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg" title={title}>{children}</dd>
    </div>
  );
}

function CopySeqButton({ label, copiedLabel, seq }: { label: string; copiedLabel: string; seq: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const disabled = !seq;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        if (!seq) return;
        if (await copyText(seq)) {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }
      }}
      className={seqBtnClass(disabled)}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

/** Clipboard copy with a textarea fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function flattenDomains(cdsFeatures: CdsFeature[]) {
  const rows: Array<PfamDomain & { locusTag: string }> = [];
  for (const cds of cdsFeatures) {
    for (const domain of cds.pfam_domains ?? []) {
      rows.push({ ...domain, locusTag: cds.locus_tag || "-" });
    }
  }
  return rows.sort((a, b) => Number(b.bitscore ?? 0) - Number(a.bitscore ?? 0));
}
