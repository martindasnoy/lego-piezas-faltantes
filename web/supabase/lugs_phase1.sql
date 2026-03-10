-- Fase 1 (LUGs): base de datos inicial sin romper flujo actual
-- Ejecutar una vez en Supabase SQL Editor

begin;

-- 1) Tabla de comunidades (LUG)
create table if not exists public.lugs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lugs_slug_idx on public.lugs (slug);

-- 2) Tabla de membresias por LUG
create table if not exists public.lug_memberships (
  lug_id uuid not null references public.lugs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (lug_id, user_id)
);

create index if not exists lug_memberships_user_id_idx on public.lug_memberships (user_id);
create index if not exists lug_memberships_lug_id_idx on public.lug_memberships (lug_id);

-- 3) Relacionar listas con LUG (nullable por seguridad en esta fase)
alter table public.lists
  add column if not exists lug_id uuid references public.lugs(id) on delete set null;

create index if not exists lists_lug_id_idx on public.lists (lug_id);

-- 4) LUG default para migracion inicial
insert into public.lugs (slug, name)
values ('balug', 'BALUG')
on conflict (slug) do nothing;

-- 5) Backfill de listas existentes hacia LUG default
update public.lists
set lug_id = (select id from public.lugs where slug = 'balug')
where lug_id is null;

-- 6) Membresia admin para duenos de listas existentes
insert into public.lug_memberships (lug_id, user_id, role)
select distinct
  l.lug_id,
  l.owner_id,
  'admin'
from public.lists l
where l.owner_id is not null
  and l.lug_id is not null
on conflict (lug_id, user_id) do nothing;

-- 7) Trigger de updated_at para lugs
create or replace function public.lugs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lugs_touch_updated_at on public.lugs;
create trigger trg_lugs_touch_updated_at
before update on public.lugs
for each row
execute function public.lugs_touch_updated_at();

commit;

-- Verificacion sugerida:
-- select id, slug, name from public.lugs where slug = 'balug';
-- select count(*) as lists_without_lug from public.lists where lug_id is null;
-- select count(*) as memberships_count from public.lug_memberships;
