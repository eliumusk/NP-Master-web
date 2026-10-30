-- FASTA upload cap is defined by the Supabase project's global storage upload limit
-- (50 MiB on the Free plan), which cannot be raised from SQL. Keep the bucket limit
-- aligned with web/lib/limits.ts (FASTA_MAX_BYTES). After upgrading the project plan
-- and raising the global limit in Settings -> Storage, bump the value below and in
-- web/lib/limits.ts together (1 GiB = 1073741824).
update storage.buckets
set file_size_limit = 52428800
where id = 'fasta-uploads';
