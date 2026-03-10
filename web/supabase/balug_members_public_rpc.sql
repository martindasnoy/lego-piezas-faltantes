-- Ejecutar una vez en Supabase SQL Editor
-- Lista de integrantes del LUG actual del usuario (nombre + red social)

drop function if exists public.get_balug_members_public();

create or replace function public.get_balug_members_public()
returns table (
  display_name text,
  social_platform text,
  social_handle text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with my_lug as (
    select lm.lug_id
    from public.lug_memberships lm
    where lm.user_id = auth.uid()
    order by
      case when lm.role = 'admin' then 0 else 1 end,
      lm.joined_at asc
    limit 1
  )
  select
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(u.email, '@', 1), ''),
      'Usuario'
    ) as display_name,
    case
      when lower(coalesce(u.raw_user_meta_data ->> 'social_platform', '')) in ('instagram', 'facebook')
        then lower(u.raw_user_meta_data ->> 'social_platform')
      else null
    end as social_platform,
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'social_handle', '')), '') as social_handle,
    u.created_at
  from my_lug ml
  join public.lug_memberships lm on lm.lug_id = ml.lug_id
  join auth.users u on u.id = lm.user_id
  where auth.uid() is not null
  order by lower(
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(u.email, '@', 1), ''),
      'Usuario'
    )
  );
$$;

revoke all on function public.get_balug_members_public() from public;
grant execute on function public.get_balug_members_public() to authenticated;
