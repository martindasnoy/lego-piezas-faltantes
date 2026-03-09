# Supabase setup (pool + ofertas)

Ejecuta estos scripts en este orden dentro de Supabase SQL Editor para dejar `pool` y `Yo tengo` funcionando entre usuarios.

1. `pool_rls.sql`
   - Activa/ajusta policies para leer listas publicas y sus lotes.
2. `offers_rls.sql`
   - Crea `offers` + policies base para insertar y leer ofertas.
3. `offers_list_item_id_fix.sql`
   - Normaliza `offers.list_item_id` al tipo real de `list_items.id`.
4. `pool_public_rpc.sql`
   - Crea RPC para mostrar lotes publicos mezclados con `owner_name`, `value` y quien marco `Yo tengo`.
5. `offers_owner_rpc.sql`
   - Crea RPC para que el dueno vea ofertas por lote en su lista.
6. `offers_create_rpc.sql`
   - Crea RPC para insertar oferta con usuario real (`auth.uid()`) y evita duplicados por lote.
7. `offers_toggle_rpc.sql`
   - Permite toggle de `Yo tengo` (poner y deshacer si fue tu clic y sigue pending).
8. `offers_mine_rpc.sql`
   - Crea RPC para la lista automatica `Piezas ofertadas` (resumen de tus `Yo tengo`).
9. `list_items_value.sql`
   - Agrega campo `value` en `list_items` para guardar valor por item en listas de venta.
10. `app_feature_flags.sql`
   - Crea flags globales de modulos y permisos para que solo `martindasnoy@gmail.com` pueda editarlos desde MASTER.
11. `matches_owner_rpc.sql`
   - Crea RPC para detectar matches entre listas de deseo y listas de venta de otros usuarios (misma pieza + color).
12. `registered_users_master_rpc.sql`
   - Crea RPC para que el panel MASTER pueda listar usuarios registrados (nombre y email).
13. `balug_members_public_rpc.sql`
    - Crea RPC para mostrar integrantes BALUG (nombre + red social) en dashboard.
14. `part_image_cache.sql`
    - Crea tabla DB-first para cache de imagenes de piezas (`part_num + color`) con RLS y permisos para API.
15. `part_popularity_cache.sql`
    - Crea tabla de ranking por pieza (`set_count`) para ordenar sugerencias del desplegable por popularidad.

## Verificacion rapida

- Usuario A crea lista publica + agrega lote.
- Usuario B entra a `/pool` y ve ese lote.
- Usuario B envia `Yo tengo`.
- Usuario A abre su lista y ve el resumen de oferta en el lote.

Si `/pool` sigue vacio, primero confirmar que existan listas con `is_public = true` y lotes reales en `list_items`.
