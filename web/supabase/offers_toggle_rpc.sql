-- Toggle de "Yo tengo" por lote
-- Si no hay oferta activa: crea una (pending)
-- Si la oferta activa pendiente es del usuario actual: la elimina (undo)
-- Si la oferta activa es de otro usuario o esta accepted: no permite cambios

drop function if exists public.toggle_offer_for_lot(text, integer);

create or replace function public.toggle_offer_for_lot(p_list_item_id text, p_quantity integer)
returns table (
  action text,
  claimed_by_id text,
  claimed_by_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_offer_id bigint;
  v_offer_by uuid;
  v_offer_status text;
  v_user_name text;
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

  select o.id, o.offered_by, o.status
  into v_offer_id, v_offer_by, v_offer_status
  from public.offers o
  where o.list_item_id::text = p_list_item_id
    and o.status in ('pending', 'accepted')
  order by o.created_at desc
  limit 1;

  if v_offer_id is null then
    insert into public.offers (list_item_id, offered_by, quantity, status)
    select li.id, v_user, p_quantity, 'pending'
    from public.list_items li
    where li.id::text = p_list_item_id
    limit 1;

    select
      coalesce(
        nullif(u.raw_user_meta_data ->> 'display_name', ''),
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(u.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(u.email, '@', 1), ''),
        u.email,
        v_user::text
      )
    into v_user_name
    from auth.users u
    where u.id = v_user;

    return query
    select 'created'::text, v_user::text, coalesce(v_user_name, v_user::text);
    return;
  end if;

  if v_offer_by = v_user and v_offer_status = 'pending' then
    delete from public.offers where id = v_offer_id;

    return query
    select 'deleted'::text, null::text, null::text;
    return;
  end if;

  if v_offer_by = v_user and v_offer_status = 'accepted' then
    raise exception 'Tu oferta ya fue aceptada, no se puede quitar desde pool';
  end if;

  raise exception 'Este lote ya fue marcado por otro usuario';
end;
$$;

revoke all on function public.toggle_offer_for_lot(text, integer) from public;
grant execute on function public.toggle_offer_for_lot(text, integer) to authenticated;
