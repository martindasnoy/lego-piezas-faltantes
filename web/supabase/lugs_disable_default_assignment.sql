-- Desactivar autoasignacion de LUG default al registrarse
-- Ejecutar una vez en Supabase SQL Editor

begin;

drop trigger if exists trg_assign_default_lug_membership on auth.users;
drop function if exists public.assign_default_lug_membership();

commit;

-- Verificacion sugerida:
-- select tgname from pg_trigger where tgname = 'trg_assign_default_lug_membership';
