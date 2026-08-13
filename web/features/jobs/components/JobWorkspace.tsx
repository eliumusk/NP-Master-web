"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { JobWorkspacePayload, RegionFilters } from "../types";
import { ALL_FILTER } from "../constants";
import { assignBgcIds, filterRegions, sortRegionsForTable } from "../stats";
import { ArtifactDownloads } from "./ArtifactDownloads";
import { FeedbackBox } from "./FeedbackBox";
import { JobHeader } from "./JobHeader";
import { JobOverview } from "./JobOverview";
import { RegionExplorer } from "./RegionExplorer";

const TERMINAL = new Set(["done", "failed", "canceled"]);

export function JobWorkspace({
  initialJob,
  initialGenomes,
  initialRegions,
  initialArtifacts,
  clientIdOverride,
  isLoggedIn,
}: JobWorkspacePayload) {
  const { t } = useI18n();
  const [job, setJob] = useState(initialJob);
  const [genomes, setGenomes] = useState(initialGenomes);
  const [regions, setRegions] = useState(initialRegions);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [filters, setFilters] = useState<RegionFilters>({
    safeOnly: true,
    contig: ALL_FILTER,
    bgcType: ALL_FILTER,
    tier: ALL_FILTER,
    query: "",
  });

  useEffect(() => {
    if (TERMINAL.has(job.status)) return;
    const query = clientIdOverride ? `?client_id=${encodeURIComponent(clientIdOverride)}` : "";
    const timer = setInterval(async () => {
      const [summaryRes, regionsRes] = await Promise.all([
        fetch(`/api/jobs/${job.id}${query}`),
        fetch(`/api/jobs/${job.id}/regions${query}`),
      ]);
      if (summaryRes.ok) {
        const next = await summaryRes.json();
        setJob(next.job);
        setGenomes(next.genomes);
        setArtifacts(next.artifacts ?? []);
      }
      if (regionsRes.ok) {
        const next = await regionsRes.json();
        setRegions(next.regions ?? []);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [clientIdOverride, job.id, job.status]);

  const bgcIds = useMemo(() => assignBgcIds(regions), [regions]);
  const tableRegions = useMemo(
    () => sortRegionsForTable(filterRegions(regions, filters, bgcIds)),
    [regions, filters, bgcIds],
  );
  const summaryUrl = useMemo(
    () => artifacts.find((a) => a.kind === "regions_csv" && a.genome_id === null)?.url ?? null,
    [artifacts],
  );
  const detailSuffix = clientIdOverride ? `?client_id=${encodeURIComponent(clientIdOverride)}` : "";

  return (
    <div className="animate-fade-in space-y-5">
      <JobHeader job={job} />
      <JobOverview job={job} genomes={genomes} regions={regions} summaryUrl={summaryUrl} />

      <RegionExplorer
        regions={tableRegions}
        allRegions={regions}
        filters={filters}
        bgcIds={bgcIds}
        detailHref={(regionId) => `/jobs/${job.id}/regions/${regionId}${detailSuffix}`}
        onFiltersChange={setFilters}
      />

      {job.status === "done" && (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold">{t.feedback.jobTitle}</h2>
          <p className="mt-1 text-xs text-fg-muted">{t.feedback.hint}</p>
          <div className="mt-3">
            <FeedbackBox jobId={job.id} regionId={null} isLoggedIn={isLoggedIn} variant="job" />
          </div>
        </section>
      )}

      <ArtifactDownloads artifacts={artifacts} />
    </div>
  );
}
