-- Ejecutar una vez en Supabase SQL Editor
-- Lista usuarios registrados (solo visible para usuario master)

drop function if exists public.get_registered_users_master();

create or replace function public.get_registered_users_master()
returns table (
  user_id text,
  display_name text,
  email text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    u.id::text as user_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(u.email, '@', 1), ''),
      u.email,
      u.id::text
    ) as display_name,
    coalesce(u.email, '') as email,
    u.created_at
  from auth.users u
  where lower(coalesce(auth.jwt() ->> 'email', '')) = 'martindasnoy@gmail.com'
  order by u.created_at desc;
$$;

revoke all on function public.get_registered_users_master() from public;
grant execute on function public.get_registered_users_master() to authenticated;
