# Supabase setup (pool + ofertas)

Ejecuta estos scripts en este orden dentro de Supabase SQL Editor para dejar `pool` y `Yo tengo` funcionando entre usuarios.

1. `pool_rls.sql`
   - Activa/ajusta policies para leer listas publicas y sus lotes.
2. `offers_rls.sql`
   - Crea `offers` + policies base para insertar y leer ofertas.
3. `offers_list_item_id_fix.sql`
   - Normaliza `offers.list_item_id` al tipo real de `list_items.id`.
4. `pool_public_rpc.sql`
   - Crea RPC para mostrar lotes publicos mezclados con `owner_name` y quien marco `Yo tengo`.
5. `offers_owner_rpc.sql`
   - Crea RPC para que el dueno vea ofertas por lote en su lista.
6. `offers_create_rpc.sql`
   - Crea RPC para insertar oferta con usuario real (`auth.uid()`) y evita duplicados por lote.
7. `offers_toggle_rpc.sql`
   - Permite toggle de `Yo tengo` (poner y deshacer si fue tu clic y sigue pending).
8. `offers_mine_rpc.sql`
   - Crea RPC para la lista automatica `Piezas ofertadas` (resumen de tus `Yo tengo`).

## Verificacion rapida

- Usuario A crea lista publica + agrega lote.
- Usuario B entra a `/pool` y ve ese lote.
- Usuario B envia `Yo tengo`.
- Usuario A abre su lista y ve el resumen de oferta en el lote.

Si `/pool` sigue vacio, primero confirmar que existan listas con `is_public = true` y lotes reales en `list_items`.
