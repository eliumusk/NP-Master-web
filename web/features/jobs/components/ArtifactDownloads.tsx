import type { SignedJobArtifact } from "@/lib/job-artifacts";
import { formatBytes } from "../format";

export function ArtifactDownloads({ artifacts }: { artifacts: SignedJobArtifact[] }) {
  if (artifacts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">结果下载</h2>
        <p className="mt-1 text-sm text-fg-muted">签名链接一小时内有效，刷新页面会重新生成。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {artifacts.map((artifact) => (
          <a
            key={`${artifact.kind}-${artifact.storage_path}`}
            href={artifact.url}
            className="rounded-card border border-border bg-surface p-3 text-sm transition hover:border-brand hover:bg-brand-soft"
          >
            <span className="block font-medium">{artifact.label}</span>
            <span className="mt-1 block truncate text-xs text-fg-muted">{artifact.filename}</span>
            <span className="numeric-display mt-2 block text-xs text-fg-muted">{formatBytes(artifact.bytes)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
