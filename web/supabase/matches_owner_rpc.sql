-- Matches entre lista del dueno y listas publicas de otros usuarios
-- Ejecutar en Supabase SQL Editor

drop function if exists public.get_matches_for_owner_list(text);

create or replace function public.get_matches_for_owner_list(p_list_id text)
returns table (
  list_item_id text,
  matched_list_item_id text,
  matched_owner_name text,
  matched_quantity integer,
  matched_value numeric,
  my_reserved_quantity integer,
  total_reserved_quantity integer,
  reservable_quantity integer
)
language sql
security definer
stable
set search_path = public
as $$
  with my_list as (
    select l.id, l.owner_id, l.name
    from public.lists l
    where l.id::text = p_list_id
      and l.owner_id = auth.uid()
    limit 1
  ),
  my_lots as (
    select
      li.id,
      upper(trim(li.part_num)) as part_num_norm,
      lower(regexp_replace(trim(regexp_replace(coalesce(li.color_name, ''), '\\(chino\\)', '', 'gi')), '[^a-z0-9]', '', 'gi')) as color_norm
    from public.list_items li
    join my_list ml on ml.id::text = li.list_id::text
  )
  select
    my_li.id::text as list_item_id,
    other_li.id::text as matched_list_item_id,
    coalesce(
      nullif(mu.raw_user_meta_data ->> 'display_name', ''),
      nullif(mu.raw_user_meta_data ->> 'full_name', ''),
      nullif(mu.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(mu.email, '@', 1), ''),
      mu.email,
      other_l.owner_id::text
    ) as matched_owner_name,
    other_li.quantity::integer as matched_quantity,
    other_li.value as matched_value,
    coalesce(my_reserved.pending_quantity, 0)::integer as my_reserved_quantity,
    coalesce(total_reserved.total_quantity, 0)::integer as total_reserved_quantity,
    greatest(
      other_li.quantity::integer
      - greatest(coalesce(total_reserved.total_quantity, 0)::integer - coalesce(my_reserved.pending_quantity, 0)::integer, 0),
      0
    )::integer as reservable_quantity
  from my_lots my_li
  join my_list ml on true
  join public.list_items other_li
    on upper(trim(other_li.part_num)) = my_li.part_num_norm
   and lower(regexp_replace(trim(regexp_replace(coalesce(other_li.color_name, ''), '\\(chino\\)', '', 'gi')), '[^a-z0-9]', '', 'gi')) = my_li.color_norm
  join public.lists other_l on other_l.id::text = other_li.list_id::text
  left join auth.users mu on mu.id = other_l.owner_id
  left join lateral (
    select sum(o.quantity)::integer as total_quantity
    from public.offers o
    where o.list_item_id::text = other_li.id::text
      and o.status in ('pending', 'accepted')
  ) as total_reserved on true
  left join lateral (
    select sum(o.quantity)::integer as pending_quantity
    from public.offers o
    where o.list_item_id::text = other_li.id::text
      and o.offered_by = auth.uid()
      and o.status = 'pending'
  ) as my_reserved on true
  where other_l.owner_id <> ml.owner_id
    and (
      (
        lower(trim(ml.name)) ~ '^venta\s*:'
        and lower(trim(other_l.name)) !~ '^venta\s*:'
      )
      or
      (
        lower(trim(ml.name)) !~ '^venta\s*:'
        and lower(trim(other_l.name)) ~ '^venta\s*:'
        and other_l.is_public = true
      )
    )
  order by my_li.id::text, matched_owner_name;
$$;

revoke all on function public.get_matches_for_owner_list(text) from public;
grant execute on function public.get_matches_for_owner_list(text) to authenticated;
