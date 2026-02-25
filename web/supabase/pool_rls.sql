-- Pool publico entre usuarios
-- Ejecutar este script en Supabase SQL Editor

-- 1) Asegurar RLS encendido
alter table public.lists enable row level security;
alter table public.list_items enable row level security;

-- 2) Grants basicos para usuarios logueados
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.list_items to authenticated;

-- 3) Policies de lists
drop policy if exists "lists_select_public_or_owner" on public.lists;
create policy "lists_select_public_or_owner"
on public.lists
for select
to authenticated
using (is_public = true or owner_id = auth.uid());

drop policy if exists "lists_insert_owner" on public.lists;
create policy "lists_insert_owner"
on public.lists
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "lists_update_owner" on public.lists;
create policy "lists_update_owner"
on public.lists
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "lists_delete_owner" on public.lists;
create policy "lists_delete_owner"
on public.lists
for delete
to authenticated
using (owner_id = auth.uid());

-- 4) Policies de list_items (clave para que pool vea lotes de otros)
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
  )
)
with check (
  exists (
    select 1
    from public.lists l
    where l.id = public.list_items.list_id
      and l.owner_id = auth.uid()
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
  )
);
