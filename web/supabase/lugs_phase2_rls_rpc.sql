-- Fase 2 (LUGs): aislamiento por comunidad en RLS + RPC
-- Ejecutar una vez en Supabase SQL Editor, despues de lugs_phase1.sql

begin;

-- Helpers de membresia
create or replace function public.get_default_lug_for_user(p_user uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select lm.lug_id
  from public.lug_memberships lm
  where lm.user_id = p_user
  order by
    case when lm.role = 'admin' then 0 else 1 end,
    lm.joined_at asc
  limit 1
$$;

create or replace function public.current_user_default_lug_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select public.get_default_lug_for_user(auth.uid())
$$;

create or replace function public.user_is_member_of_lug(p_lug_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.lug_memberships lm
    where lm.user_id = auth.uid()
      and lm.lug_id = p_lug_id
  )
$$;

create or replace function public.user_is_admin_of_lug(p_lug_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.lug_memberships lm
    where lm.user_id = auth.uid()
      and lm.lug_id = p_lug_id
      and lm.role = 'admin'
  )
$$;

grant execute on function public.get_default_lug_for_user(uuid) to authenticated;
grant execute on function public.current_user_default_lug_id() to authenticated;
grant execute on function public.user_is_member_of_lug(uuid) to authenticated;
grant execute on function public.user_is_admin_of_lug(uuid) to authenticated;

-- Trigger para autocompletar lug_id en nuevas listas
create or replace function public.lists_assign_default_lug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_default_lug uuid;
begin
  v_owner := coalesce(new.owner_id, auth.uid());

  if new.lug_id is null then
    v_default_lug := public.get_default_lug_for_user(v_owner);

    if v_default_lug is null then
      select id into v_default_lug
      from public.lugs
      where slug = 'balug'
      limit 1;
    end if;

    new.lug_id := v_default_lug;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lists_assign_default_lug on public.lists;
create trigger trg_lists_assign_default_lug
before insert on public.lists
for each row
execute function public.lists_assign_default_lug();

-- RLS para lugs y memberships
alter table public.lugs enable row level security;
alter table public.lug_memberships enable row level security;

grant select, insert, update on public.lugs to authenticated;
grant select, insert, update, delete on public.lug_memberships to authenticated;

drop policy if exists lugs_select_member on public.lugs;
create policy lugs_select_member
on public.lugs
for select
to authenticated
using (public.user_is_member_of_lug(id));

drop policy if exists lugs_insert_authenticated on public.lugs;
create policy lugs_insert_authenticated
on public.lugs
for insert
to authenticated
with check (created_by = auth.uid() or created_by is null);

drop policy if exists lugs_update_admin on public.lugs;
create policy lugs_update_admin
on public.lugs
for update
to authenticated
using (public.user_is_admin_of_lug(id))
with check (public.user_is_admin_of_lug(id));

drop policy if exists lug_memberships_select_member on public.lug_memberships;
create policy lug_memberships_select_member
on public.lug_memberships
for select
to authenticated
using (user_id = auth.uid() or public.user_is_admin_of_lug(lug_id));

drop policy if exists lug_memberships_insert_self_or_admin on public.lug_memberships;
create policy lug_memberships_insert_self_or_admin
on public.lug_memberships
for insert
to authenticated
with check (user_id = auth.uid() or public.user_is_admin_of_lug(lug_id));

drop policy if exists lug_memberships_update_admin on public.lug_memberships;
create policy lug_memberships_update_admin
on public.lug_memberships
for update
to authenticated
using (public.user_is_admin_of_lug(lug_id))
with check (public.user_is_admin_of_lug(lug_id));

drop policy if exists lug_memberships_delete_self_or_admin on public.lug_memberships;
create policy lug_memberships_delete_self_or_admin
on public.lug_memberships
for delete
to authenticated
using (user_id = auth.uid() or public.user_is_admin_of_lug(lug_id));

-- Reforzar policies de lists/list_items por LUG
alter table public.lists enable row level security;
alter table public.list_items enable row level security;

drop policy if exists "lists_select_public_or_owner" on public.lists;
create policy "lists_select_public_or_owner"
on public.lists
for select
to authenticated
using (
  public.user_is_member_of_lug(lug_id)
  and (is_public = true or owner_id = auth.uid())
);

drop policy if exists "lists_insert_owner" on public.lists;
create policy "lists_insert_owner"
on public.lists
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.user_is_member_of_lug(lug_id)
);

drop policy if exists "lists_update_owner" on public.lists;
create policy "lists_update_owner"
on public.lists
for update
to authenticated
using (
  owner_id = auth.uid()
  and public.user_is_member_of_lug(lug_id)
)
with check (
  owner_id = auth.uid()
  and public.user_is_member_of_lug(lug_id)
);

drop policy if exists "lists_delete_owner" on public.lists;
create policy "lists_delete_owner"
on public.lists
for delete
to authenticated
using (
  owner_id = auth.uid()
  and public.user_is_member_of_lug(lug_id)
);

drop policy if exists "items_select_public_or_owner" on public.list_items;
create policy "items_select_public_or_owner"
on public.list_items
for select
to authenticated
using (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and public.user_is_member_of_lug(l.lug_id)
      and (l.owner_id = auth.uid() or l.is_public = true)
  )
);

drop policy if exists "items_insert_owner" on public.list_items;
create policy "items_insert_owner"
on public.list_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and l.owner_id = auth.uid()
      and public.user_is_member_of_lug(l.lug_id)
  )
);

drop policy if exists "items_update_owner" on public.list_items;
create policy "items_update_owner"
on public.list_items
for update
to authenticated
using (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and l.owner_id = auth.uid()
      and public.user_is_member_of_lug(l.lug_id)
  )
)
with check (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and l.owner_id = auth.uid()
      and public.user_is_member_of_lug(l.lug_id)
  )
);

drop policy if exists "items_delete_owner" on public.list_items;
create policy "items_delete_owner"
on public.list_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and l.owner_id = auth.uid()
      and public.user_is_member_of_lug(l.lug_id)
  )
);

-- RPC: pool publico acotado al LUG del usuario
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
  value numeric,
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
    li.value,
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
    and public.user_is_member_of_lug(l.lug_id)
  order by lower(coalesce(li.part_name, li.part_num)), li.part_num;
$$;

revoke all on function public.get_public_pool_lots() from public;
grant execute on function public.get_public_pool_lots() to authenticated;

-- RPC: crear oferta dentro del mismo LUG
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
      and public.user_is_member_of_lug(l.lug_id)
  ) then
    raise exception 'Lote no publico, propio o fuera de tu LUG';
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
    and public.user_is_member_of_lug(l.lug_id)
  limit 1
  returning offers.id, offers.list_item_id::text, offers.offered_by, offers.quantity, offers.status, offers.created_at;
end;
$$;

revoke all on function public.create_offer_for_lot(text, integer) from public;
grant execute on function public.create_offer_for_lot(text, integer) to authenticated;

-- RPC: toggle oferta dentro del mismo LUG
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
    and public.user_is_member_of_lug(l.lug_id)
  limit 1;

  if v_lot_qty is null then
    raise exception 'Lote no publico, propio o fuera de tu LUG';
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

-- RPC: ofertas para dueno (solo dentro de su LUG)
drop function if exists public.get_offers_for_owner_list(text);
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
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      nullif(u.raw_user_meta_data ->> 'user_name', ''),
      nullif(split_part(u.email, '@', 1), ''),
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
    and public.user_is_member_of_lug(l.lug_id)
  order by o.created_at desc;
$$;

revoke all on function public.get_offers_for_owner_list(text) from public;
grant execute on function public.get_offers_for_owner_list(text) to authenticated;

-- RPC: mis ofertas (solo en mis LUGs)
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
    and public.user_is_member_of_lug(l.lug_id)
  group by li.id, li.part_num, li.part_name, li.color_name, l.owner_id, u.raw_user_meta_data, u.email
  order by lower(coalesce(li.part_name, li.part_num)), li.part_num;
$$;

revoke all on function public.get_my_offered_pieces() from public;
grant execute on function public.get_my_offered_pieces() to authenticated;

-- RPC: matches dentro del mismo LUG
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
    select l.id, l.owner_id, l.name, l.lug_id
    from public.lists l
    where l.id::text = p_list_id
      and l.owner_id = auth.uid()
      and public.user_is_member_of_lug(l.lug_id)
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
    and other_l.lug_id = ml.lug_id
    and (
      (
        lower(trim(ml.name)) ~ '^venta\\s*:'
        and lower(trim(other_l.name)) !~ '^venta\\s*:'
      )
      or
      (
        lower(trim(ml.name)) !~ '^venta\\s*:'
        and lower(trim(other_l.name)) ~ '^venta\\s*:'
        and other_l.is_public = true
      )
    )
  order by my_li.id::text, matched_owner_name;
$$;

revoke all on function public.get_matches_for_owner_list(text) from public;
grant execute on function public.get_matches_for_owner_list(text) to authenticated;

commit;

-- Verificacion sugerida:
-- select public.current_user_default_lug_id();
-- select count(*) from public.lists where lug_id is null;
-- select * from public.get_public_pool_lots() limit 5;
