-- Ofertas visibles para el dueno de una lista
-- Ejecutar en Supabase SQL Editor

drop function if exists public.get_offers_for_owner_list(text);
drop function if exists public.get_offers_for_owner_list(uuid);

create or replace function public.get_offers_for_owner_list(p_list_id text)
returns table (
  list_item_id text,
  offered_by_name text,
  quantity integer,
  status text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    o.list_item_id::text,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      u.email,
      o.offered_by::text
    ) as offered_by_name,
    o.quantity::integer,
    o.status
  from public.offers o
  join public.list_items li on li.id::text = o.list_item_id::text
  join public.lists l on l.id::text = li.list_id::text
  left join auth.users u on u.id = o.offered_by
  where l.id::text = p_list_id
    and l.owner_id = auth.uid()
  order by o.created_at desc;
$$;

revoke all on function public.get_offers_for_owner_list(text) from public;
grant execute on function public.get_offers_for_owner_list(text) to authenticated;
