-- Cache de imagenes por pieza+color (DB-first)
-- Ejecutar en Supabase SQL Editor

create table if not exists public.part_image_cache (
  cache_key text primary key,
  part_num text not null,
  color_name text not null default '',
  color_name_norm text not null default '',
  part_img_url text null,
  status text not null default 'missing' check (status in ('found','missing','error')),
  source text not null default 'rebrickable' check (source in ('rebrickable','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists part_image_cache_part_num_idx on public.part_image_cache (part_num);
create index if not exists part_image_cache_updated_at_idx on public.part_image_cache (updated_at desc);

create or replace function public.part_image_cache_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_part_image_cache_updated_at on public.part_image_cache;
create trigger trg_part_image_cache_updated_at
before update on public.part_image_cache
for each row execute function public.part_image_cache_set_updated_at();

alter table public.part_image_cache enable row level security;

grant select, insert, update on public.part_image_cache to anon;
grant select, insert, update on public.part_image_cache to authenticated;

drop policy if exists part_image_cache_select_all on public.part_image_cache;
create policy part_image_cache_select_all
on public.part_image_cache
for select
to anon, authenticated
using (true);

drop policy if exists part_image_cache_insert_all on public.part_image_cache;
create policy part_image_cache_insert_all
on public.part_image_cache
for insert
to anon, authenticated
with check (true);

drop policy if exists part_image_cache_update_all on public.part_image_cache;
create policy part_image_cache_update_all
on public.part_image_cache
for update
to anon, authenticated
using (true)
with check (true);
