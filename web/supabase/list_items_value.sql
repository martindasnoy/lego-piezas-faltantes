-- Ejecutar una vez en Supabase SQL Editor
-- Agrega campo de valor para listas de venta

alter table if exists public.list_items
add column if not exists value numeric(12,2);

alter table if exists public.list_items
drop constraint if exists list_items_value_non_negative;

alter table if exists public.list_items
add constraint list_items_value_non_negative
check (value is null or value >= 0);
