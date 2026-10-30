import type { CdsFeature } from "./types";

type RegionWithCds<TCds = CdsFeature[] | null> = {
  cds_features?: TCds;
};

export function trimRegionPayload<T extends RegionWithCds>(regions: T[] | null | undefined) {
  return (regions ?? []).map((region) => ({
    ...region,
    cds_features: trimCdsFeatures(region.cds_features),
  }));
}

function trimCdsFeatures(cdsFeatures: CdsFeature[] | null | undefined) {
  if (!Array.isArray(cdsFeatures)) return cdsFeatures ?? null;
  return cdsFeatures.map((cds) => {
    const { aa_sequence: _aaSequence, nt_sequence: _ntSequence, ...visibleCds } = cds;
    return visibleCds;
  });
}
