import type { SupabaseClient } from "@supabase/supabase-js";

type ArtifactRow = {
  id: number;
  genome_id: string | null;
  kind: string;
  storage_path: string;
  content_type: string;
  bytes: number | null;
  created_at: string;
};

export type SignedJobArtifact = ArtifactRow & {
  label: string;
  filename: string;
  url: string;
};

const VISIBLE_KINDS = new Set([
  "results_zip",
  "regions_csv",
  "regions_gbk",
  "regions_bed",
  "scores_bedgraph",
  "extended_regions_fna",
  "extended_cds_faa",
  "extended_cds_fna",
  "extended_cds_csv",
  "pfam_domtbl",
]);

const KIND_LABELS: Record<string, string> = {
  results_zip: "完整结果包 ZIP",
  regions_csv: "候选区域 CSV",
  regions_gbk: "候选区域 GenBank",
  regions_bed: "候选区域 BED",
  scores_bedgraph: "窗口分数 BedGraph",
  extended_regions_fna: "扩展区域 FASTA",
  extended_cds_faa: "CDS 蛋白 FASTA",
  extended_cds_fna: "CDS 核酸 FASTA",
  extended_cds_csv: "CDS 注释 CSV",
  pfam_domtbl: "Pfam domtbl",
};

const KIND_ORDER = [
  "results_zip",
  "regions_csv",
  "regions_gbk",
  "extended_cds_csv",
  "extended_cds_faa",
  "extended_cds_fna",
  "extended_regions_fna",
  "pfam_domtbl",
  "scores_bedgraph",
  "regions_bed",
];

export async function getSignedJobArtifacts(
  admin: SupabaseClient,
  jobId: string,
): Promise<SignedJobArtifact[]> {
  const { data, error } = await admin
    .from("job_artifacts")
    .select("id,genome_id,kind,storage_path,content_type,bytes,created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const rows = (data as ArtifactRow[])
    .filter((row) => VISIBLE_KINDS.has(row.kind))
    .sort(compareArtifacts);

  const bucket = process.env.RESULTS_BUCKET ?? "results";
  const signed = await Promise.all(rows.map(async (row) => {
    const filename = basename(row.storage_path);
    const { data: urlData } = await admin.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, 60 * 60, { download: filename });
    if (!urlData?.signedUrl) return null;
    return {
      ...row,
      filename,
      label: artifactLabel(row),
      url: urlData.signedUrl,
    };
  }));

  return signed.filter((item): item is SignedJobArtifact => item !== null);
}

function compareArtifacts(a: ArtifactRow, b: ArtifactRow) {
  const byKind = kindRank(a.kind) - kindRank(b.kind);
  if (byKind !== 0) return byKind;
  if (a.genome_id === null && b.genome_id !== null) return -1;
  if (a.genome_id !== null && b.genome_id === null) return 1;
  return a.storage_path.localeCompare(b.storage_path);
}

function kindRank(kind: string) {
  const idx = KIND_ORDER.indexOf(kind);
  return idx >= 0 ? idx : KIND_ORDER.length;
}

function artifactLabel(row: ArtifactRow) {
  const base = KIND_LABELS[row.kind] ?? row.kind;
  const genomeName = row.genome_id ? parentDirectory(row.storage_path) : "";
  return genomeName ? `${base} · ${genomeName}` : base;
}

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "download";
}

function parentDirectory(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.at(-2) ?? "" : "";
}
