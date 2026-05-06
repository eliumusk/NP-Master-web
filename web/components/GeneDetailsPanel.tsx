"use client";

// Click-target details panel for a single CDS: locus tag, position, product,
// function class, Pfam domain list with InterPro links, and copyable AA / NT
// sequences. External BLAST link uses NCBI's web BLAST URL with the AA seed.

import { useState } from "react";
import { toast } from "sonner";

type PfamDomain = {
  name: string;
  accession: string;
  e_value: number;
  bitscore: number;
  env_start: number;
  env_end: number;
};

export type CDSFeature = {
  locus_tag: string;
  start: number;
  end: number;
  strand: 1 | -1;
  length_aa: number;
  product?: string;
  function_class: "core_biosynthetic" | "additional_biosynthetic" | "transport"
                | "regulatory" | "resistance" | "other";
  aa_sequence?: string;
  nt_sequence?: string;
  pfam_domains: PfamDomain[];
};

const CLASS_FILL: Record<CDSFeature["function_class"], string> = {
  core_biosynthetic:       "#dc2626",
  additional_biosynthetic: "#f472b6",
  transport:               "#2563eb",
  regulatory:              "#16a34a",
  resistance:              "#9ca3af",
  other:                   "#cbd5e1",
};

const CLASS_LABEL: Record<CDSFeature["function_class"], string> = {
  core_biosynthetic:       "核心生合",
  additional_biosynthetic: "辅助生合",
  transport:               "运输",
  regulatory:              "调控",
  resistance:              "抗性",
  other:                   "其他",
};

type Tab = "info" | "aa" | "nt";

export function GeneDetailsPanel({
  cds, regionContig, regionStartBp, onClose,
}: {
  cds: CDSFeature;
  regionContig: string;
  regionStartBp: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const fill = CLASS_FILL[cds.function_class];
  const absStart = regionStartBp + cds.start;
  const absEnd = regionStartBp + cds.end;
  const lenNt = cds.end - cds.start;

  return (
    <div className="rounded-card border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{cds.locus_tag}</span>
            <CopyChip text={cds.locus_tag} label="locus" />
            <span
              className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: fill + "22", color: fill }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fill }} />
              {CLASS_LABEL[cds.function_class]}
            </span>
            <span className="text-[11px] text-fg-muted">
              {cds.strand === 1 ? "+ 链" : "− 链"} · {cds.length_aa} aa · {lenNt.toLocaleString()} bp
            </span>
          </div>
          <div className="text-xs text-fg-muted">
            {cds.product || "hypothetical protein"}
          </div>
          <div className="numeric-display text-[11px] text-fg-subtle">
            <span className="font-mono">{regionContig}</span>:
            {absStart.toLocaleString()}–{absEnd.toLocaleString()}
            <span className="mx-2 opacity-50">·</span>
            <span>region 内 {cds.start.toLocaleString()}–{cds.end.toLocaleString()}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-btn px-2 py-1 text-fg-muted hover:bg-elevated hover:text-fg"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border px-3 pt-2 text-sm">
        {([
          { v: "info", label: "信息 + 域" },
          { v: "aa",   label: `蛋白质 (${cds.length_aa} aa)` },
          { v: "nt",   label: `DNA (${lenNt.toLocaleString()} bp)` },
        ] as const).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setTab(t.v)}
            className={`relative px-3 pb-2 pt-1 text-xs transition-colors ${
              tab === t.v
                ? "font-semibold text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "info" && <InfoTab cds={cds} />}
        {tab === "aa"   && <SequenceTab seq={cds.aa_sequence ?? ""} kind="aa" locus={cds.locus_tag} />}
        {tab === "nt"   && <SequenceTab seq={cds.nt_sequence ?? ""} kind="nt" locus={cds.locus_tag} />}
      </div>
    </div>
  );
}

function InfoTab({ cds }: { cds: CDSFeature }) {
  return (
    <div className="space-y-4">
      {/* Pfam domain list */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Pfam 域 ({cds.pfam_domains.length})
        </div>
        {cds.pfam_domains.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-elevated/40 p-3 text-xs text-fg-muted">
            未在 1e-5 阈值上命中任何 Pfam 域
          </div>
        ) : (
          <div className="space-y-1.5">
            {cds.pfam_domains.map((d, i) => {
              const acc = d.accession.split(".")[0];
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-elevated/40 px-3 py-2">
                  <a
                    href={`https://www.ebi.ac.uk/interpro/entry/pfam/${acc}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs font-semibold text-brand hover:underline"
                  >
                    {d.name}
                  </a>
                  <span className="font-mono text-[11px] text-fg-subtle">{d.accession}</span>
                  <span className="numeric-display text-[11px] text-fg-muted">
                    {d.env_start}–{d.env_end} aa
                  </span>
                  <span className="numeric-display text-[11px] text-fg-muted">
                    E = {d.e_value.toExponential(1)}
                  </span>
                  <span className="numeric-display text-[11px] text-fg-muted">
                    score {d.bitscore.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* External links */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">外部工具</div>
        <div className="flex flex-wrap gap-2">
          {cds.aa_sequence && (
            <ExternalBtn
              href={ncbiBlastpUrl(cds.aa_sequence, cds.locus_tag)}
              label="NCBI BLASTp"
              hint="提交蛋白质序列到 NCBI 网页 BLAST"
            />
          )}
          <ExternalBtn
            href={`https://www.ebi.ac.uk/interpro/search/sequence/?text=${encodeURIComponent(cds.aa_sequence ?? "")}`}
            label="InterProScan"
            hint="EBI InterPro sequence search"
          />
        </div>
      </div>
    </div>
  );
}

function SequenceTab({ seq, kind, locus }: { seq: string; kind: "aa" | "nt"; locus: string }) {
  if (!seq) {
    return <div className="text-sm text-fg-muted">序列不可用</div>;
  }
  const wrapped = wrap(seq, 60);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={seq} label={kind === "aa" ? "蛋白质序列" : "DNA 序列"} />
        <CopyButton
          text={`>${locus}\n${wrapped}\n`}
          label="复制 FASTA"
          hint="带 > 头的 FASTA 格式，方便粘贴到 BLAST 等工具"
        />
        <span className="ml-auto text-[11px] text-fg-muted">{seq.length.toLocaleString()} {kind === "aa" ? "aa" : "bp"}</span>
      </div>
      <pre className="max-h-72 overflow-auto rounded-card border border-border bg-elevated/40 p-3 font-mono text-[11px] leading-relaxed text-fg">
        {wrapped}
      </pre>
    </div>
  );
}

function CopyChip({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); toast.success(`已复制 ${label}`); }
        catch { toast.error("浏览器禁止访问剪贴板"); }
      }}
      className="rounded-btn px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-elevated hover:text-fg"
      aria-label={`复制 ${label}`}
    >
      📋
    </button>
  );
}

function CopyButton({ text, label, hint }: { text: string; label: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); toast.success(`已复制 ${label}`); }
        catch { toast.error("浏览器禁止访问剪贴板"); }
      }}
      title={hint}
      className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated"
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z"/><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z"/></svg>
      复制 {label}
    </button>
  );
}

function ExternalBtn({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={hint}
      className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated"
    >
      {label}
      <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4h5v5M9 11l7-7M14 13v3a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1h3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

function ncbiBlastpUrl(seq: string, name: string): string {
  // NCBI BLAST web GUI accepts a query via PROGRAM=blastp + DATABASE=nr +
  // QUERY=<sequence> in URL. Sequence should be FASTA-formatted (with header).
  // Truncate very long sequences if needed (URL length limit ~8 KB).
  const fasta = `>${name}\n${seq}`;
  return "https://blast.ncbi.nlm.nih.gov/Blast.cgi?" + new URLSearchParams({
    PROGRAM: "blastp",
    PAGE_TYPE: "BlastSearch",
    LINK_LOC: "blasthome",
    QUERY: fasta,
  }).toString();
}

function wrap(s: string, n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += n) lines.push(s.slice(i, i + n));
  return lines.join("\n");
}
