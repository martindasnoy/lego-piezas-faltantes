-- Inserta oferta de forma segura usando auth.uid()
-- Ejecutar en Supabase SQL Editor

drop function if exists public.create_offer_for_lot(text, integer);

create or replace function public.create_offer_for_lot(p_list_item_id text, p_quantity integer)
returns table (
  id bigint,
  list_item_id text,
  offered_by uuid,
  quantity integer,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := auth.uid();

  if v_user is null then
    raise exception 'No autenticado';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Cantidad invalida';
  end if;

  if not exists (
    select 1
    from public.list_items li
    join public.lists l on l.id::text = li.list_id::text
    where li.id::text = p_list_item_id
      and l.is_public = true
      and l.owner_id <> v_user
  ) then
    raise exception 'Lote no publico o propio';
  end if;

  if exists (
    select 1
    from public.offers o
    where o.list_item_id::text = p_list_item_id
      and o.status in ('pending', 'accepted')
  ) then
    raise exception 'Este lote ya fue marcado como disponible';
  end if;

  return query
  insert into public.offers (list_item_id, offered_by, quantity, status)
  select li.id, v_user, p_quantity, 'pending'
  from public.list_items li
  join public.lists l on l.id::text = li.list_id::text
  where li.id::text = p_list_item_id
    and l.is_public = true
    and l.owner_id <> v_user
  limit 1
  returning offers.id, offers.list_item_id::text, offers.offered_by, offers.quantity, offers.status, offers.created_at;
end;
$$;

revoke all on function public.create_offer_for_lot(text, integer) from public;
grant execute on function public.create_offer_for_lot(text, integer) to authenticated;
