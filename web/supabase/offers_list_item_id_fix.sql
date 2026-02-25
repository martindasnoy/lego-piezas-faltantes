-- Normaliza offers.list_item_id al tipo de list_items.id
-- Ejecutar una vez en Supabase SQL Editor si falla el insert de "Yo tengo"

do $$
declare
  target_udt text;
  current_udt text;
begin
  -- Tipo real de list_items.id (ej: bigint, uuid, text)
  select udt_name
  into target_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'list_items'
    and column_name = 'id';

  if target_udt is null then
    raise exception 'No existe public.list_items.id';
  end if;

  select udt_name
  into current_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'offers'
    and column_name = 'list_item_id';

  if current_udt is null then
    raise exception 'No existe public.offers.list_item_id';
  end if;

  if current_udt <> target_udt then
    -- Drop policies que dependen de la columna antes de alterar tipo
    execute 'drop policy if exists "offers_insert_authenticated" on public.offers';
    execute 'drop policy if exists "offers_select_own" on public.offers';
    execute 'drop policy if exists "offers_select_owner_lists" on public.offers';
    execute 'drop policy if exists "offers_update_owner_lists" on public.offers';

    execute format('alter table public.offers alter column list_item_id type %I using list_item_id::%I', target_udt, target_udt);

    -- Recreate policies robustas (comparan por ::text)
    execute '
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
          where li.id::text = public.offers.list_item_id::text
            and l.is_public = true
        )
      )';

    execute '
      create policy "offers_select_own"
      on public.offers
      for select
      to authenticated
      using (offered_by = auth.uid())';

    execute '
      create policy "offers_select_owner_lists"
      on public.offers
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.list_items li
          join public.lists l on l.id::text = li.list_id::text
          where li.id::text = public.offers.list_item_id::text
            and l.owner_id = auth.uid()
        )
      )';

    execute '
      create policy "offers_update_owner_lists"
      on public.offers
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.list_items li
          join public.lists l on l.id::text = li.list_id::text
          where li.id::text = public.offers.list_item_id::text
            and l.owner_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.list_items li
          join public.lists l on l.id::text = li.list_id::text
          where li.id::text = public.offers.list_item_id::text
            and l.owner_id = auth.uid()
        )
      )';
  end if;
end $$;
