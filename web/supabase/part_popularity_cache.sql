-- Ranking de popularidad por pieza (cuantos sets contienen la pieza)
-- Ejecutar en Supabase SQL Editor

create table if not exists public.part_popularity_cache (
  part_num text primary key,
  set_count integer not null default 0 check (set_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists part_popularity_cache_set_count_idx on public.part_popularity_cache (set_count desc);

create or replace function public.part_popularity_cache_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_part_popularity_cache_updated_at on public.part_popularity_cache;
create trigger trg_part_popularity_cache_updated_at
before update on public.part_popularity_cache
for each row execute function public.part_popularity_cache_set_updated_at();

alter table public.part_popularity_cache enable row level security;

grant select, insert, update on public.part_popularity_cache to anon;
grant select, insert, update on public.part_popularity_cache to authenticated;

drop policy if exists part_popularity_cache_select_all on public.part_popularity_cache;
create policy part_popularity_cache_select_all
on public.part_popularity_cache
for select
to anon, authenticated
using (true);

drop policy if exists part_popularity_cache_insert_all on public.part_popularity_cache;
create policy part_popularity_cache_insert_all
on public.part_popularity_cache
for insert
to anon, authenticated
with check (true);

drop policy if exists part_popularity_cache_update_all on public.part_popularity_cache;
create policy part_popularity_cache_update_all
on public.part_popularity_cache
for update
to anon, authenticated
using (true)
with check (true);
