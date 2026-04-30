-- RLS policies + RPCs for worker queue ops.
-- Convention: anon/authenticated roles can only see/insert their own data.
-- service_role (used by worker + Vercel server routes) bypasses RLS.

alter table profiles      enable row level security;
alter table jobs          enable row level security;
alter table regions       enable row level security;
alter table feature_cache enable row level security;

-- ── profiles ────────────────────────────────────────────────────────
create policy "profiles_self_select" on profiles
  for select using (id = auth.uid());

create policy "profiles_self_update" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ── jobs ────────────────────────────────────────────────────────────
-- Users can read their own jobs.
create policy "jobs_self_select" on jobs
  for select using (user_id = auth.uid());

-- Users can insert with status='queued' and only self-owned rows. They cannot
-- preset any worker-managed columns.
create policy "jobs_self_insert" on jobs
  for insert with check (
    user_id = auth.uid()
    and status = 'queued'
    and worker_id is null
    and last_heartbeat is null
    and result_csv_path is null
    and result_bed_path is null
    and result_fai_path is null
    and result_fasta_path is null
    and started_at is null
    and finished_at is null
  );

-- Users can cancel their own queued jobs (status: queued -> canceled). All
-- other transitions are forbidden via a trigger below; RLS only gates row
-- visibility, not column-level mutation.
create policy "jobs_self_cancel" on jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Trigger: non-admin users may only flip queued -> canceled. Everything else
-- requires service_role.
create or replace function public.guard_job_user_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin_user boolean;
begin
  -- service_role / supabase_admin bypass: when the calling role is not the
  -- 'authenticated' role we're either anon (denied earlier) or service.
  if current_setting('request.jwt.claim.role', true) is null
     or current_setting('request.jwt.claim.role', true) <> 'authenticated' then
    return new;
  end if;

  select is_admin into is_admin_user from public.profiles where id = auth.uid();
  if is_admin_user then
    return new;
  end if;

  if old.status = 'queued' and new.status = 'canceled'
     and new.user_id = old.user_id
     and new.fasta_path = old.fasta_path
     and new.fasta_sha256 = old.fasta_sha256 then
    return new;
  end if;

  raise exception 'jobs: only cancellation of queued jobs is permitted via user role';
end;
$$;

drop trigger if exists trg_guard_job_user_update on jobs;
create trigger trg_guard_job_user_update
before update on jobs
for each row execute function public.guard_job_user_update();

-- ── regions ─────────────────────────────────────────────────────────
create policy "regions_via_owner_job" on regions
  for select using (
    exists (select 1 from jobs j where j.id = regions.job_id and j.user_id = auth.uid())
  );

-- ── feature_cache ───────────────────────────────────────────────────
-- service_role only; no policies for authenticated/anon.

-- ── Worker RPCs ─────────────────────────────────────────────────────
-- Atomically claim the oldest queued job for this worker.
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
     set status         = 'running',
         worker_id      = worker,
         started_at     = now(),
         last_heartbeat = now()
    from candidate
   where j.id = candidate.id
   returning j.* into claimed;

  if claimed.id is not null then
    return next claimed;
  end if;
  return;
end;
$$;

revoke all on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;

-- Heartbeat for a running job.
create or replace function public.job_heartbeat(job uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update jobs set last_heartbeat = now()
   where id = job and status = 'running';
$$;

revoke all on function public.job_heartbeat(uuid) from public, anon, authenticated;
grant execute on function public.job_heartbeat(uuid) to service_role;

-- Watchdog: requeue jobs whose heartbeat is stale > 2 min.
create or replace function public.requeue_stale_running()
returns integer
language sql
security definer
set search_path = public
as $$
  with bumped as (
    update jobs
       set status = 'queued',
           worker_id = null,
           started_at = null,
           last_heartbeat = null,
           log_tail = coalesce(log_tail, '') || E'\n[watchdog] heartbeat stale; requeued'
     where status = 'running'
       and (last_heartbeat is null or last_heartbeat < now() - interval '2 minutes')
     returning id
  )
  select count(*)::int from bumped;
$$;

revoke all on function public.requeue_stale_running() from public, anon, authenticated;
grant execute on function public.requeue_stale_running() to service_role;
