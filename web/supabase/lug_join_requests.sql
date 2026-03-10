-- Solicitudes de ingreso a LUG (popup popNewLUG + alerta admins)
-- Ejecutar una vez en Supabase SQL Editor

begin;

create table if not exists public.lug_join_requests (
  id uuid primary key default gen_random_uuid(),
  lug_id uuid not null references public.lugs(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  request_message text,
  requester_social_contact text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

alter table public.lug_join_requests add column if not exists request_message text;
alter table public.lug_join_requests add column if not exists requester_social_contact text;

create index if not exists lug_join_requests_lug_id_idx on public.lug_join_requests (lug_id);
create index if not exists lug_join_requests_requester_idx on public.lug_join_requests (requester_user_id);
create index if not exists lug_join_requests_status_idx on public.lug_join_requests (status);

create unique index if not exists lug_join_requests_one_pending_per_user_idx
  on public.lug_join_requests (requester_user_id)
  where status = 'pending';

alter table public.lug_join_requests enable row level security;

drop policy if exists lug_join_requests_insert_self on public.lug_join_requests;
create policy lug_join_requests_insert_self
  on public.lug_join_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists lug_join_requests_select_self on public.lug_join_requests;
create policy lug_join_requests_select_self
  on public.lug_join_requests
  for select
  to authenticated
  using (requester_user_id = auth.uid());

drop policy if exists lug_join_requests_select_lug_admins on public.lug_join_requests;
create policy lug_join_requests_select_lug_admins
  on public.lug_join_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.lug_memberships lm
      where lm.user_id = auth.uid()
        and lm.lug_id = lug_join_requests.lug_id
        and lm.role = 'admin'
    )
  );

drop policy if exists lug_join_requests_update_lug_admins on public.lug_join_requests;
create policy lug_join_requests_update_lug_admins
  on public.lug_join_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.lug_memberships lm
      where lm.user_id = auth.uid()
        and lm.lug_id = lug_join_requests.lug_id
        and lm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.lug_memberships lm
      where lm.user_id = auth.uid()
        and lm.lug_id = lug_join_requests.lug_id
        and lm.role = 'admin'
    )
  );

drop policy if exists lug_join_requests_delete_self_pending on public.lug_join_requests;
create policy lug_join_requests_delete_self_pending
  on public.lug_join_requests
  for delete
  to authenticated
  using (
    requester_user_id = auth.uid()
    and status = 'pending'
  );

create or replace function public.get_lug_join_requests_public(p_lug_id uuid)
returns table (
  id uuid,
  lug_id uuid,
  requester_user_id uuid,
  requester_display_name text,
  requester_social_platform text,
  requester_social_handle text,
  request_message text,
  requester_social_contact text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    r.id,
    r.lug_id,
    r.requester_user_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(u.email, ''), '@', 1),
      'Usuario'
    ) as requester_display_name,
    case
      when lower(coalesce(u.raw_user_meta_data ->> 'social_platform', '')) in ('instagram', 'facebook')
        then lower(u.raw_user_meta_data ->> 'social_platform')
      else null
    end as requester_social_platform,
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'social_handle', '')), '') as requester_social_handle,
    nullif(trim(coalesce(r.request_message, '')), '') as request_message,
    nullif(trim(coalesce(r.requester_social_contact, '')), '') as requester_social_contact,
    r.status,
    r.created_at
  from public.lug_join_requests r
  join auth.users u on u.id = r.requester_user_id
  where r.lug_id = p_lug_id
    and r.status = 'pending'
    and auth.uid() is not null
    and exists (
      select 1
      from public.lug_memberships lm
      where lm.user_id = auth.uid()
        and lm.lug_id = p_lug_id
        and lm.role = 'admin'
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_lug_join_requests_public(uuid) to authenticated;

commit;

-- Verificacion sugerida:
-- select status, count(*) from public.lug_join_requests group by status;
