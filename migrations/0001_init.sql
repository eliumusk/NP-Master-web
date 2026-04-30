-- NP-Master web service initial schema.
-- Single model: evo2_per_token_unet. Job lifecycle: queued -> running -> done|failed.

create extension if not exists pgcrypto;

create type job_status as enum ('queued', 'running', 'done', 'failed', 'canceled');

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  -- input
  fasta_path         text not null,                -- key in fasta-uploads bucket
  fasta_sha256       text not null,
  fasta_bytes        bigint not null check (fasta_bytes > 0 and fasta_bytes <= 10 * 1024 * 1024),
  threshold          real not null default 0.50 check (threshold > 0 and threshold < 1),
  min_len_bp         integer not null default 2000 check (min_len_bp >= 100),
  -- runtime
  status             job_status not null default 'queued',
  worker_id          text,
  last_heartbeat     timestamptz,
  -- outputs (worker-only writes; user can read)
  result_csv_path    text,
  result_bed_path    text,
  result_fai_path    text,
  result_fasta_path  text,
  log_tail           text,
  error              text,
  -- timestamps
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz
);

create index jobs_status_created_at_idx on jobs (status, created_at);
create index jobs_user_recent_idx       on jobs (user_id, created_at desc);
create index jobs_running_heartbeat_idx on jobs (status, last_heartbeat) where status = 'running';

create table regions (
  id        bigserial primary key,
  job_id    uuid not null references jobs(id) on delete cascade,
  contig    text not null,
  start_bp  integer not null,
  end_bp    integer not null,
  score     real not null
);

create index regions_job_id_idx on regions (job_id);

create table feature_cache (
  fasta_sha256   text primary key,
  features_path  text not null,        -- absolute path on Voc NFS
  bytes          bigint not null,
  last_used_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Auto-provision a profile row when a new auth user is created.
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
