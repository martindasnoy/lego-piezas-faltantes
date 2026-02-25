# Log para manana

Fecha: 2026-02-25

## Pendientes

- [ ] No se ven piezas entre usuarios en `/pool`.
  - Revisar policies RLS de `list_items` para lectura de listas publicas.
  - Verificar que existan listas con `is_public = true` y lotes asociados.

- [ ] Desde la app no se ven desplegables con nombres y colores.
  - Revisar carga de `gobrick_colors` desde Supabase.
  - Verificar que el input de color abra/cierre dropdown correctamente.
  - Confirmar datos de `name`, `bl_name`, `lego_available`, `hex`.

- [ ] Ajustar ubicaciones/posiciones de algunos elementos de UI.
  - Revisar alineacion en dashboard y detalle de lista.
  - Validar en desktop y mobile.

## Nota tecnica

- Si la version online no refleja cambios, forzar deploy en Cloudflare con:
  - branch `main`
  - root/path `web`
  - limpiar cache de build y redeploy.
