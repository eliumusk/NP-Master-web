-- BGCMaster destructive initial schema.
-- Run on a fresh/reset Supabase project. Historical NP-Master compatibility is
-- intentionally not preserved.

create extension if not exists pgcrypto;

create type job_status as enum (
  'awaiting_upload',
  'queued',
  'running',
  'done',
  'failed',
  'canceled'
);

create type genome_status as enum (
  'awaiting_upload',
  'queued',
  'running',
  'done',
  'failed',
  'skipped'
);

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,
  client_id           uuid,
  title               text not null default 'BGCMaster batch',
  source              text not null default 'upload',

  status              job_status not null default 'awaiting_upload',
  worker_id           text,
  last_heartbeat      timestamptz,
  log_tail            text,
  error               text,

  n_genomes           integer not null default 0 check (n_genomes >= 0),
  n_regions           integer not null default 0 check (n_regions >= 0),
  n_safe              integer not null default 0 check (n_safe >= 0),

  threshold           real not null default 0.95 check (threshold > 0 and threshold < 1),
  extend_threshold    real not null default 0.80 check (extend_threshold > 0 and extend_threshold < 1),
  min_support_windows integer not null default 3 check (min_support_windows >= 1),
  min_len_bp          integer not null default 2000 check (min_len_bp >= 100),
  safe_tier_min       text not null default 'Tier2',
  extend_flank_bp     integer not null default 5000 check (extend_flank_bp >= 0),

  result_zip_path     text,
  result_regions_path text,
  result_pfam_path    text,
  result_ext_csv_path text,
  result_ext_faa_path text,
  result_ext_fna_path text,

  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,

  constraint jobs_owner_present check (user_id is not null or client_id is not null)
);

create table genomes (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  genome_name     text not null,
  original_name   text not null,
  fasta_path      text not null,
  fasta_sha256    text not null,
  fasta_bytes     bigint not null check (fasta_bytes > 0),
  status          genome_status not null default 'awaiting_upload',
  error           text,
  n_regions       integer not null default 0 check (n_regions >= 0),
  n_safe          integer not null default 0 check (n_safe >= 0),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique(job_id, genome_name)
);

create table regions (
  id                bigserial primary key,
  job_id            uuid not null references jobs(id) on delete cascade,
  genome_id         uuid not null references genomes(id) on delete cascade,
  genome_name       text not null,
  contig            text not null,
  start_bp          integer not null,
  end_bp            integer not null,
  ext_start_bp      integer,
  ext_end_bp        integer,
  length_bp         integer generated always as (end_bp - start_bp) stored,
  score             real not null,
  bgc_type          text,
  type_score        real,
  type_scores       jsonb,
  safe_tier         text,
  safe_pass         boolean not null default false,
  safe_type_label   text,
  mibig_hits        jsonb,
  cds_features      jsonb,
  created_at        timestamptz not null default now(),
  check (end_bp > start_bp)
);

create table cds_features (
  id             bigserial primary key,
  region_id      bigint not null references regions(id) on delete cascade,
  locus_tag      text not null,
  start_bp       integer not null,
  end_bp         integer not null,
  strand         smallint not null check (strand in (-1, 1)),
  length_aa      integer,
  product        text,
  function_class text,
  aa_sequence    text,
  nt_sequence    text
);

create table pfam_hits (
  id          bigserial primary key,
  cds_id      bigint references cds_features(id) on delete cascade,
  region_id   bigint not null references regions(id) on delete cascade,
  locus_tag   text not null,
  domain      text not null,
  accession   text,
  clan        text,
  description text,
  e_value     double precision,
  bitscore    double precision,
  hmm_start   integer,
  hmm_end     integer,
  seq_start   integer,
  seq_end     integer
);

create table job_artifacts (
  id           bigserial primary key,
  job_id       uuid not null references jobs(id) on delete cascade,
  genome_id    uuid references genomes(id) on delete cascade,
  kind         text not null,
  storage_path text not null,
  content_type text not null default 'application/octet-stream',
  bytes        bigint,
  created_at   timestamptz not null default now(),
  unique(job_id, genome_id, kind)
);

create table feature_cache (
  fasta_sha256  text primary key,
  features_path text not null,
  bytes         bigint not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index jobs_owner_user_idx on jobs (user_id, created_at desc) where user_id is not null;
create index jobs_owner_client_idx on jobs (client_id, created_at desc) where client_id is not null;
create index jobs_status_created_idx on jobs (status, created_at);
create index genomes_job_idx on genomes (job_id, genome_name);
create index regions_job_idx on regions (job_id);
create index regions_genome_idx on regions (genome_id, score desc);
create index regions_safe_idx on regions (job_id, safe_pass, safe_tier);
create index cds_region_idx on cds_features (region_id);
create index pfam_region_idx on pfam_hits (region_id);
create index pfam_cds_idx on pfam_hits (cds_id);
create index artifacts_job_idx on job_artifacts (job_id, kind);

alter table profiles enable row level security;
alter table jobs enable row level security;
alter table genomes enable row level security;
alter table regions enable row level security;
alter table cds_features enable row level security;
alter table pfam_hits enable row level security;
alter table job_artifacts enable row level security;
alter table feature_cache enable row level security;

create policy profiles_self_select on profiles
  for select using (id = auth.uid());

create policy jobs_self_select on jobs
  for select using (user_id = auth.uid());

create policy genomes_via_job_owner on genomes
  for select using (
    exists (select 1 from jobs j where j.id = genomes.job_id and j.user_id = auth.uid())
  );

create policy regions_via_job_owner on regions
  for select using (
    exists (select 1 from jobs j where j.id = regions.job_id and j.user_id = auth.uid())
  );

create policy cds_via_region_owner on cds_features
  for select using (
    exists (
      select 1
      from regions r join jobs j on j.id = r.job_id
      where r.id = cds_features.region_id and j.user_id = auth.uid()
    )
  );

create policy pfam_via_region_owner on pfam_hits
  for select using (
    exists (
      select 1
      from regions r join jobs j on j.id = r.job_id
      where r.id = pfam_hits.region_id and j.user_id = auth.uid()
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.claim_next_job(worker text)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed jobs;
begin
  with candidate as (
    select id from jobs
    where status = 'queued'
    order by created_at asc
    limit 1
    for update skip locked
  )
  update jobs j
     set status = 'running',
         worker_id = worker,
         started_at = coalesce(j.started_at, now()),
         last_heartbeat = now(),
         log_tail = 'worker 已领取任务'
    from candidate
   where j.id = candidate.id
   returning j.* into claimed;

  if claimed.id is not null then
    return next claimed;
  end if;
  return;
end;
$$;

create or replace function public.job_heartbeat(job uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update jobs set last_heartbeat = now()
   where id = job and status = 'running';
$$;

revoke all on function public.claim_next_job(text) from public, anon, authenticated;
revoke all on function public.job_heartbeat(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;
grant execute on function public.job_heartbeat(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('fasta-uploads', 'fasta-uploads', false, 52428800),
  ('results', 'results', false, null)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
