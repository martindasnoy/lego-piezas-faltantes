-- Ejecutar una vez en Supabase SQL Editor
-- Flags globales de modulos (controlados por usuario master)

create table if not exists public.app_feature_flags (
  module_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

insert into public.app_feature_flags (module_key, enabled)
values
  ('pool_wanted', true),
  ('pool_sale', true),
  ('minifiguras', true)
on conflict (module_key) do nothing;

alter table public.app_feature_flags enable row level security;

drop policy if exists app_feature_flags_select_authenticated on public.app_feature_flags;
create policy app_feature_flags_select_authenticated
on public.app_feature_flags
for select
to authenticated
using (true);

drop policy if exists app_feature_flags_master_insert on public.app_feature_flags;
create policy app_feature_flags_master_insert
on public.app_feature_flags
for insert
to authenticated
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'martindasnoy@gmail.com');

drop policy if exists app_feature_flags_master_update on public.app_feature_flags;
create policy app_feature_flags_master_update
on public.app_feature_flags
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'martindasnoy@gmail.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'martindasnoy@gmail.com');

drop policy if exists app_feature_flags_no_delete on public.app_feature_flags;
create policy app_feature_flags_no_delete
on public.app_feature_flags
for delete
to authenticated
using (false);

create or replace function public.app_feature_flags_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_app_feature_flags_touch_updated_at on public.app_feature_flags;
create trigger trg_app_feature_flags_touch_updated_at
before update on public.app_feature_flags
for each row
execute function public.app_feature_flags_touch_updated_at();
