-- Upsert de "Yo tengo" por lote
-- Si no hay oferta pendiente del usuario: crea una (pending)
-- Si ya existe oferta pendiente del usuario: actualiza su cantidad
-- Si p_quantity = 0 y ya existe oferta pendiente del usuario: la elimina
-- Permite acumulacion entre varios usuarios hasta cubrir la cantidad requerida

drop function if exists public.toggle_offer_for_lot(text, integer);

create or replace function public.toggle_offer_for_lot(p_list_item_id text, p_quantity integer)
returns table (
  action text,
  applied_quantity integer,
  total_offered integer,
  remaining_quantity integer,
  offers_count integer,
  my_pending_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_lot_qty integer;
  v_total_offered integer;
  v_my_offer_id bigint;
  v_my_offer_qty integer;
  v_other_offered integer;
  v_allowed_for_user integer;
  v_new_total integer;
  v_new_remaining integer;
  v_new_offer_count integer;
  v_new_my_pending integer;
begin
  v_user := auth.uid();

  if v_user is null then
    raise exception 'No autenticado';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'Cantidad invalida';
  end if;

  select li.quantity::integer
  into v_lot_qty
  from public.list_items li
  join public.lists l on l.id::text = li.list_id::text
  where li.id::text = p_list_item_id
    and l.is_public = true
    and l.owner_id <> v_user
  limit 1;

  if v_lot_qty is null then
    raise exception 'Lote no publico o propio';
  end if;

  select coalesce(sum(o.quantity), 0)::integer
  into v_total_offered
  from public.offers o
  where o.list_item_id::text = p_list_item_id
    and o.status in ('pending', 'accepted');

  select o.id, o.quantity::integer
  into v_my_offer_id, v_my_offer_qty
  from public.offers o
  where o.list_item_id::text = p_list_item_id
    and o.offered_by = v_user
    and o.status = 'pending'
  order by o.created_at desc
  limit 1;

  if p_quantity = 0 then
    if v_my_offer_id is null then
      raise exception 'No tienes oferta pendiente para quitar';
    end if;

    delete from public.offers where id = v_my_offer_id;

    select coalesce(sum(o.quantity), 0)::integer,
           count(distinct o.offered_by)::integer
    into v_new_total, v_new_offer_count
    from public.offers o
    where o.list_item_id::text = p_list_item_id
      and o.status in ('pending', 'accepted');

    v_new_remaining := greatest(v_lot_qty - v_new_total, 0);

    return query
    select
      'deleted'::text,
      0::integer,
      v_new_total,
      v_new_remaining,
      coalesce(v_new_offer_count, 0),
      0::integer;
    return;
  end if;

  v_other_offered := greatest(v_total_offered - coalesce(v_my_offer_qty, 0), 0);
  v_allowed_for_user := greatest(v_lot_qty - v_other_offered, 0);

  if v_allowed_for_user < 1 then
    raise exception 'Este lote ya esta completo';
  end if;

  if p_quantity > v_allowed_for_user then
    raise exception 'Solo quedan % piezas disponibles en este lote', v_allowed_for_user;
  end if;

  if v_my_offer_id is null then
    insert into public.offers (list_item_id, offered_by, quantity, status)
    select li.id, v_user, p_quantity, 'pending'
    from public.list_items li
    where li.id::text = p_list_item_id
    limit 1;
  else
    update public.offers
    set quantity = p_quantity,
        created_at = now()
    where id = v_my_offer_id;
  end if;

  select coalesce(sum(o.quantity), 0)::integer,
         count(distinct o.offered_by)::integer
  into v_new_total, v_new_offer_count
  from public.offers o
  where o.list_item_id::text = p_list_item_id
    and o.status in ('pending', 'accepted');

  select coalesce(sum(o.quantity), 0)::integer
  into v_new_my_pending
  from public.offers o
  where o.list_item_id::text = p_list_item_id
    and o.offered_by = v_user
    and o.status = 'pending';

  v_new_remaining := greatest(v_lot_qty - v_new_total, 0);

  return query
  select
    case when v_my_offer_id is null then 'created'::text else 'updated'::text end,
    p_quantity::integer,
    v_new_total,
    v_new_remaining,
    coalesce(v_new_offer_count, 0),
    coalesce(v_new_my_pending, 0);
end;
$$;

revoke all on function public.toggle_offer_for_lot(text, integer) from public;
grant execute on function public.toggle_offer_for_lot(text, integer) to authenticated;
