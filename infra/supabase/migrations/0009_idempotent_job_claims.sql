alter table public.jobs
  add column if not exists claim_token uuid;

create unique index if not exists jobs_claim_token_idx
  on public.jobs (claim_token)
  where claim_token is not null;

drop function if exists public.claim_next_job(text);

create or replace function public.claim_next_job(worker text, token uuid)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed jobs;
begin
  select j.* into claimed
    from jobs j
   where j.status = 'running'
     and j.worker_id = worker
     and j.claim_token = token
   limit 1;

  if claimed.id is not null then
    return next claimed;
    return;
  end if;

  update jobs
     set status = 'queued',
         worker_id = null,
         claim_token = null,
         started_at = null,
         last_heartbeat = null,
         log_tail = '领取连接中断，已自动重新排队',
         error = null
   where status = 'running'
     and log_tail = 'worker 已领取任务'
     and coalesce(last_heartbeat, started_at) < now() - interval '2 minutes';

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
         claim_token = token,
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

drop function if exists public.job_heartbeat(uuid);

create or replace function public.job_heartbeat(job uuid, token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update jobs set last_heartbeat = now()
   where id = job and status = 'running' and claim_token = token;
$$;

revoke all on function public.claim_next_job(text, uuid) from public, anon, authenticated;
revoke all on function public.job_heartbeat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_job(text, uuid) to service_role;
grant execute on function public.job_heartbeat(uuid, uuid) to service_role;
