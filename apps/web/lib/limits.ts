// Single source of truth for upload/batch limits.
// NOTE: FASTA_MAX_BYTES must not exceed the Supabase project's global storage
// upload cap (50 MB on the Free plan); the bucket's file_size_limit should
// match this value — see supabase/migrations/0006_raise_fasta_upload_limit.sql.
export const FASTA_MAX_BYTES = 50 * 1024 * 1024;
export const GFF3_MAX_BYTES = 20 * 1024 * 1024;
export const AUTH_MAX_FILES = 64;
export const ANON_MAX_FILES = 1;

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
