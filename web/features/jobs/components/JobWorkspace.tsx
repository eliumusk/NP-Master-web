"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobWorkspacePayload, Region, RegionFilters } from "../types";
import { ALL_FILTER } from "../constants";
import { filterRegions } from "../stats";
import { ArtifactDownloads } from "./ArtifactDownloads";
import { JobHeader } from "./JobHeader";
import { JobOverview } from "./JobOverview";
import { RegionDetail } from "./RegionDetail";
import { RegionExplorer } from "./RegionExplorer";

const TERMINAL = new Set(["done", "failed", "canceled"]);

export function JobWorkspace({
  initialJob,
  initialGenomes,
  initialRegions,
  initialArtifacts,
  clientIdOverride,
}: JobWorkspacePayload) {
  const [job, setJob] = useState(initialJob);
  const [genomes, setGenomes] = useState(initialGenomes);
  const [regions, setRegions] = useState(initialRegions);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(initialRegions[0]?.id ?? null);
  const [filters, setFilters] = useState<RegionFilters>({
    safeOnly: true,
    genome: ALL_FILTER,
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

  const filteredRegions = useMemo(() => filterRegions(regions, filters), [regions, filters]);
  const selectedRegion = useMemo(
    () => pickSelectedRegion(regions, filteredRegions, selectedRegionId),
    [filteredRegions, regions, selectedRegionId],
  );

  useEffect(() => {
    if (!selectedRegion && filteredRegions[0]) {
      setSelectedRegionId(filteredRegions[0].id);
    }
  }, [filteredRegions, selectedRegion]);

  return (
    <div className="animate-fade-in space-y-5">
      <JobHeader job={job} />
      <JobOverview job={job} genomes={genomes} regions={regions} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_27rem]">
        <RegionExplorer
          regions={filteredRegions}
          allRegions={regions}
          filters={filters}
          selectedRegionId={selectedRegion?.id ?? null}
          onFiltersChange={setFilters}
          onSelectRegion={setSelectedRegionId}
        />
        <div className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6.5rem)] xl:overflow-y-auto xl:pr-1">
          <RegionDetail region={selectedRegion} />
        </div>
      </div>

      <ArtifactDownloads artifacts={artifacts} />
    </div>
  );
}

function pickSelectedRegion(regions: Region[], filtered: Region[], selectedId: number | null) {
  if (selectedId != null) {
    const current = filtered.find((region) => region.id === selectedId);
    if (current) return current;
  }
  return filtered[0] ?? regions[0] ?? null;
}
