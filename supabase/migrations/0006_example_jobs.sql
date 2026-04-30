-- Add an "is_example" flag so we can showcase a real precomputed run on the
-- landing page without requiring sign-in or a new GPU job.
--
-- Example jobs:
--   * have user_id IS NULL and client_id IS NULL
--   * are publicly readable (handled in /jobs/[id] server component, which
--     calls service-role when is_example = true)
--   * are seeded once via service-role from a real /jobs row.

alter table jobs add column if not exists is_example boolean not null default false;

alter table jobs drop constraint if exists jobs_owner_present;
alter table jobs add constraint jobs_owner_present
  check (user_id is not null or client_id is not null or is_example = true);

create index if not exists jobs_example_idx on jobs (is_example) where is_example = true;

-- Seed: promote the well-known GCA_000156475.1 / 32-region run as the public
-- example. Idempotent — only flips the flag if the row exists.
update jobs set is_example = true
  where id = '59327055-15a7-42e0-9610-c04bafcb3b27' and is_example = false;
