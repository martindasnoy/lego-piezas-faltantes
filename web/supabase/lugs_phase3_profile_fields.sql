-- Fase 3 (LUGs): campos de perfil para panel LUG admin
-- Ejecutar una vez en Supabase SQL Editor

alter table if exists public.lugs
  add column if not exists country text;

alter table if exists public.lugs
  add column if not exists description text;

alter table if exists public.lugs
  add column if not exists color_4 text;
