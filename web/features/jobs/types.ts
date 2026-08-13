import type { SignedJobArtifact } from "@/lib/job-artifacts";

export type JobStatus = "awaiting_upload" | "queued" | "running" | "done" | "failed" | "canceled" | string;

export type JobSummary = {
  id: string;
  title: string;
  status: JobStatus;
  error: string | null;
  log_tail: string | null;
  n_genomes: number;
  n_regions: number;
  n_safe: number;
  threshold: number;
  extend_threshold: number;
  min_support_windows: number;
  min_len_bp: number;
  safe_tier_min: string;
  extend_flank_bp: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type GenomeSummary = {
  id: string;
  genome_name: string;
  original_name: string;
  fasta_bytes: number;
  status: JobStatus;
  error: string | null;
  n_regions: number;
  n_safe: number;
};

export type MibigHit = {
  bgc_id?: string;
  identity?: number;
  product?: string;
};

export type PfamDomain = {
  name?: string;
  accession?: string;
  e_value?: number;
  bitscore?: number;
  env_start?: number;
  env_end?: number;
  hmm_start?: number;
  hmm_end?: number;
};

export type CdsFeature = {
  locus_tag?: string;
  start?: number;
  end?: number;
  strand?: number;
  length_aa?: number;
  product?: string;
  function_class?: string;
  aa_sequence?: string;
  nt_sequence?: string;
  pfam_domains?: PfamDomain[];
};

export type Region = {
  id: number;
  genome_name: string;
  contig: string;
  start_bp: number;
  end_bp: number;
  ext_start_bp: number | null;
  ext_end_bp: number | null;
  score: number;
  bgc_type: string | null;
  type_score: number | null;
  type_scores: Record<string, number> | null;
  safe_tier: string | null;
  safe_pass: boolean;
  safe_type_label: string | null;
  mibig_hits: MibigHit[] | null;
  cds_features: CdsFeature[] | null;
};

export type JobWorkspacePayload = {
  initialJob: JobSummary;
  initialGenomes: GenomeSummary[];
  initialRegions: Region[];
  initialArtifacts: SignedJobArtifact[];
  clientIdOverride?: string;
  isLoggedIn: boolean;
};

export type RegionFilters = {
  safeOnly: boolean;
  genome: string;
  bgcType: string;
  tier: string;
  query: string;
};
