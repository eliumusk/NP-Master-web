import type { SignedJobArtifact } from "@/lib/job-artifacts";
import { useI18n } from "@/lib/i18n/client";
import { formatBytes } from "../format";

export function ArtifactDownloads({ artifacts }: { artifacts: SignedJobArtifact[] }) {
  const { t } = useI18n();
  if (artifacts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">{t.artifacts.title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{t.artifacts.note}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {artifacts.map((artifact) => (
          <a
            key={`${artifact.kind}-${artifact.storage_path}`}
            href={artifact.url}
            className="panel group flex items-start gap-3 p-3.5 transition hover:border-brand/40"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-brand-soft text-brand transition group-hover:bg-brand-softer">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{artifact.label}</span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">{artifact.filename}</span>
              <span className="numeric-display mt-1 block text-[11px] text-fg-muted">{formatBytes(artifact.bytes)}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
