-- Resumen de piezas que yo marque con "Yo tengo"
-- Ejecutar en Supabase SQL Editor

drop function if exists public.get_my_offered_pieces();

create or replace function public.get_my_offered_pieces()
returns table (
  list_item_id text,
  part_num text,
  part_name text,
  color_name text,
  owner_name text,
  total_quantity integer,
  offers_count integer,
  last_status text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    li.id::text as list_item_id,
    li.part_num,
    coalesce(li.part_name, li.part_num) as part_name,
    li.color_name,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(u.email, '@', 1), ''),
      u.email,
      l.owner_id::text
    ) as owner_name,
    sum(o.quantity)::integer as total_quantity,
    count(*)::integer as offers_count,
    (array_agg(o.status order by o.created_at desc))[1]::text as last_status
  from public.offers o
  join public.list_items li on li.id::text = o.list_item_id::text
  join public.lists l on l.id::text = li.list_id::text
  left join auth.users u on u.id = l.owner_id
  where o.offered_by = auth.uid()
  group by li.id, li.part_num, li.part_name, li.color_name, l.owner_id, u.raw_user_meta_data, u.email
  order by lower(coalesce(li.part_name, li.part_num)), li.part_num;
$$;

revoke all on function public.get_my_offered_pieces() from public;
grant execute on function public.get_my_offered_pieces() to authenticated;
