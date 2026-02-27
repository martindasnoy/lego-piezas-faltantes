-- Ejecutar una vez en Supabase SQL Editor
-- Devuelve lotes de listas publicas para todos los usuarios logueados

drop function if exists public.get_public_pool_lots();

create or replace function public.get_public_pool_lots()
returns table (
  id text,
  list_id text,
  owner_id text,
  part_num text,
  part_name text,
  color_name text,
  quantity integer,
  total_offered integer,
  remaining_quantity integer,
  offers_count integer,
  my_pending_quantity integer,
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
    li.part_num,
    li.part_name,
    li.color_name,
    li.quantity::integer,
    coalesce(offers_summary.total_offered, 0)::integer as total_offered,
    greatest(li.quantity::integer - coalesce(offers_summary.total_offered, 0)::integer, 0)::integer as remaining_quantity,
    coalesce(offers_summary.offers_count, 0)::integer as offers_count,
    coalesce(my_offer.pending_quantity, 0)::integer as my_pending_quantity,
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
    select
      sum(o.quantity)::integer as total_offered,
      count(distinct o.offered_by)::integer as offers_count
    from public.offers o
    where o.list_item_id::text = li.id::text
      and o.status in ('pending', 'accepted')
  ) as offers_summary on true
  left join lateral (
    select
      sum(o.quantity)::integer as pending_quantity
    from public.offers o
    where o.list_item_id::text = li.id::text
      and o.offered_by = auth.uid()
      and o.status = 'pending'
  ) as my_offer on true
  where l.is_public = true
  order by lower(coalesce(li.part_name, li.part_num)), li.part_num;
$$;

revoke all on function public.get_public_pool_lots() from public;
grant execute on function public.get_public_pool_lots() to authenticated;
