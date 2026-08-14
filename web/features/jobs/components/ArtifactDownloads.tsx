import type { SignedJobArtifact } from "@/lib/job-artifacts";
import { useI18n } from "@/lib/i18n/client";
import { formatBytes } from "../format";

export function ArtifactDownloads({ artifacts }: { artifacts: SignedJobArtifact[] }) {
  const { t } = useI18n();
  if (artifacts.length === 0) return null;

  return (
    <details className="panel group p-5">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold">
        {t.workspace.advancedDownloads}
        <svg
          className="h-3.5 w-3.5 text-fg-subtle transition-transform duration-150 group-open:rotate-90"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 5l5 5-5 5" />
        </svg>
      </summary>
      <p className="mt-1 text-xs text-fg-muted">{t.artifacts.note}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {artifacts.map((artifact) => (
          <a
            key={`${artifact.kind}-${artifact.storage_path}`}
            href={artifact.url}
            className="flex items-start gap-3 rounded-btn border border-white/[0.06] bg-white/[0.02] p-3 transition-colors duration-150 hover:border-brand/40 hover:bg-white/[0.04]"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-brand-soft text-brand">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{artifact.label}</span>
              <span className="mt-0.5 block truncate font-mono text-micro text-fg-subtle">{artifact.filename}</span>
              <span className="numeric-display mt-1 block text-micro text-fg-muted">{formatBytes(artifact.bytes)}</span>
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
