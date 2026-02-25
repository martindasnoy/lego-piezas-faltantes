-- Ejecutar una vez en Supabase SQL Editor
-- Devuelve lotes de listas publicas para todos los usuarios logueados

drop function if exists public.get_public_pool_lots();

create or replace function public.get_public_pool_lots()
returns table (
  id text,
  list_id text,
  owner_id text,
  claimed_by_id text,
  claimed_by_name text,
  claimed_status text,
  part_num text,
  part_name text,
  color_name text,
  quantity integer,
  list_name text,
  owner_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    li.id::text,
    li.list_id::text,
    l.owner_id::text,
    latest_offer.offered_by::text as claimed_by_id,
    coalesce(
      nullif(ou.raw_user_meta_data ->> 'display_name', ''),
      nullif(ou.raw_user_meta_data ->> 'full_name', ''),
      nullif(ou.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(ou.email, '@', 1), ''),
      ou.email,
      latest_offer.offered_by::text
    ) as claimed_by_name,
    latest_offer.status as claimed_status,
    li.part_num,
    li.part_name,
    li.color_name,
    li.quantity::integer,
    l.name as list_name,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      u.email,
      l.owner_id::text
    ) as owner_name
  from public.list_items li
  join public.lists l on l.id::text = li.list_id::text
  left join auth.users u on u.id = l.owner_id
  left join lateral (
    select o.offered_by, o.status
    from public.offers o
    where o.list_item_id::text = li.id::text
      and o.status in ('pending', 'accepted')
    order by o.created_at desc
    limit 1
  ) as latest_offer on true
  left join auth.users ou on ou.id = latest_offer.offered_by
  where l.is_public = true
  order by lower(coalesce(li.part_name, li.part_num)), li.part_num;
$$;

revoke all on function public.get_public_pool_lots() from public;
grant execute on function public.get_public_pool_lots() to authenticated;
