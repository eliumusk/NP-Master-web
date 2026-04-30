-- Per-user rate limit: max 3 jobs in queued|running at once.
-- Admins (profiles.is_admin = true) are exempt.

create or replace function public.enforce_user_job_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count int;
  is_admin_user boolean;
begin
  select is_admin into is_admin_user from public.profiles where id = new.user_id;
  if coalesce(is_admin_user, false) then
    return new;
  end if;

  select count(*) into active_count
    from public.jobs
   where user_id = new.user_id
     and status in ('queued', 'running');

  if active_count >= 3 then
    raise exception 'rate limit: at most 3 active jobs per user (queued or running)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_user_job_limit on jobs;
create trigger trg_enforce_user_job_limit
before insert on jobs
for each row execute function public.enforce_user_job_limit();
