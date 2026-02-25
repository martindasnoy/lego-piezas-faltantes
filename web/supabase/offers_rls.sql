-- Tabla y permisos para "Yo tengo" en el pool

create table if not exists public.offers (
  id bigint generated always as identity primary key,
  list_item_id text not null,
  offered_by uuid not null references auth.users(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now()
);

alter table public.offers enable row level security;

grant select, insert, update on public.offers to authenticated;

-- Cualquiera logueado puede crear oferta para un lote publico
drop policy if exists "offers_insert_authenticated" on public.offers;
create policy "offers_insert_authenticated"
on public.offers
for insert
to authenticated
with check (
  offered_by = auth.uid()
  and exists (
    select 1
    from public.list_items li
    join public.lists l on l.id::text = li.list_id::text
    where li.id::text = public.offers.list_item_id
      and l.is_public = true
  )
);

-- El usuario ve sus ofertas
drop policy if exists "offers_select_own" on public.offers;
create policy "offers_select_own"
on public.offers
for select
to authenticated
using (offered_by = auth.uid());

-- El dueno de la lista ve ofertas que le hicieron a sus lotes
drop policy if exists "offers_select_owner_lists" on public.offers;
create policy "offers_select_owner_lists"
on public.offers
for select
to authenticated
using (
  exists (
    select 1
    from public.list_items li
    join public.lists l on l.id::text = li.list_id::text
    where li.id::text = public.offers.list_item_id
      and l.owner_id = auth.uid()
  )
);

-- El dueno de la lista puede cambiar estado de oferta
drop policy if exists "offers_update_owner_lists" on public.offers;
create policy "offers_update_owner_lists"
on public.offers
for update
to authenticated
using (
  exists (
    select 1
    from public.list_items li
    join public.lists l on l.id::text = li.list_id::text
    where li.id::text = public.offers.list_item_id
      and l.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.list_items li
    join public.lists l on l.id::text = li.list_id::text
    where li.id::text = public.offers.list_item_id
      and l.owner_id = auth.uid()
  )
);
