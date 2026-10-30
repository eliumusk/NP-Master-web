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

revoke all on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;
