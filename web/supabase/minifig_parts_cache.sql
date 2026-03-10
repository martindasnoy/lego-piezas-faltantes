-- Cache DB de partes por minifigura (set_num)

create table if not exists public.minifig_parts_cache (
  set_num text not null,
  part_num text not null,
  name text not null,
  quantity integer not null default 1,
  color_name text,
  color_name_norm text not null default '',
  part_img_url text,
  is_spare boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint minifig_parts_cache_pk primary key (set_num, part_num, color_name_norm, is_spare)
);

create index if not exists minifig_parts_cache_set_num_idx on public.minifig_parts_cache (set_num);
create index if not exists minifig_parts_cache_part_num_idx on public.minifig_parts_cache (part_num);
create index if not exists minifig_parts_cache_updated_at_idx on public.minifig_parts_cache (updated_at desc);

create or replace function public.minifig_parts_cache_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_minifig_parts_cache_updated_at on public.minifig_parts_cache;
create trigger trg_minifig_parts_cache_updated_at
before update on public.minifig_parts_cache
for each row execute function public.minifig_parts_cache_set_updated_at();

alter table public.minifig_parts_cache enable row level security;

grant select, insert, update on public.minifig_parts_cache to anon;
grant select, insert, update on public.minifig_parts_cache to authenticated;

drop policy if exists minifig_parts_cache_select_all on public.minifig_parts_cache;
create policy minifig_parts_cache_select_all
on public.minifig_parts_cache
for select
to anon, authenticated
using (true);

drop policy if exists minifig_parts_cache_insert_all on public.minifig_parts_cache;
create policy minifig_parts_cache_insert_all
on public.minifig_parts_cache
for insert
to anon, authenticated
with check (true);

drop policy if exists minifig_parts_cache_update_all on public.minifig_parts_cache;
create policy minifig_parts_cache_update_all
on public.minifig_parts_cache
for update
to anon, authenticated
using (true)
with check (true);
