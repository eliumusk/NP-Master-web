-- Pipeline-side region id (e.g. BGC_M0007 / BGC_D0025 from regions.csv), so
-- web pages can be cross-referenced with downloaded artifacts. Historical rows
-- keep NULL; the UI falls back to the positional display id (assignBgcIds).
alter table public.regions add column if not exists bgc_id text;

create index if not exists regions_job_bgc_id_idx on public.regions (job_id, bgc_id);
