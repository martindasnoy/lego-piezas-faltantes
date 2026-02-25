create table if not exists public.gobrick_colors (
  id integer primary key,
  name text not null,
  bl_name text,
  lego_available boolean,
  hex text,
  created_at timestamptz not null default now()
);

alter table public.gobrick_colors
  add column if not exists id integer,
  add column if not exists bl_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists gb_id integer,
  add column if not exists lego_no text,
  add column if not exists ldraw_no text,
  add column if not exists bricklink_no text,
  add column if not exists brickowl_no text,
  add column if not exists lego_available boolean,
  add column if not exists bricklink_available boolean,
  add column if not exists unique_flag boolean not null default false,
  add column if not exists note text;

update public.gobrick_colors
set id = gb_id
where id is null and gb_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gobrick_colors_pkey'
  ) then
    alter table public.gobrick_colors add primary key (id);
  end if;
exception when others then
  null;
end $$;

alter table public.gobrick_colors enable row level security;

drop policy if exists "gobrick_colors_read" on public.gobrick_colors;
create policy "gobrick_colors_read"
on public.gobrick_colors
for select
to authenticated
using (true);
