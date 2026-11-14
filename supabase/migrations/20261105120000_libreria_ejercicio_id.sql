-- ============================================================================
-- PROPUESTA — NO APLICADA. Requiere el "sí" explícito del dueño antes de
-- correrla en el proyecto de Supabase (AGENTS.md: ningún agente cambia la
-- base de producción sin aprobación).
--
-- Rediseño 003 · US4: poder cambiar un ejercicio de la rutina por uno de la
-- librería (Gym-Exercise-Library) sin tocar los IDs viejos.
--
-- Qué hace:
--   * Agrega `libreria_ejercicio_id` (texto, opcional) a rutina_ejercicios y
--     a series_registradas. Es el `exercise_id` canónico de la librería
--     (formato src-NNN-<16 hex>).
--   * `ejercicio_id` (legacy, con FK a `ejercicios`) NO cambia: sigue igual y
--     sigue siendo obligatorio. El historial existente no se toca.
--   * Una fila con `libreria_ejercicio_id` NULL se comporta exactamente como
--     hoy.
--
-- Qué NO hace:
--   * No crea el cruce legacy↔librería (docs/LEGACY_EXERCISE_CROSSWALK.md).
--   * No cambia generate-routine / regenerate-day.
--   * No borra ni reescribe datos.
--
-- RLS: columnas nuevas en tablas que ya tienen RLS; heredan sus políticas.
-- Reversible con:
--   alter table public.series_registradas drop column libreria_ejercicio_id;
--   alter table public.rutina_ejercicios drop column libreria_ejercicio_id;
-- (al revertir se pierde qué series se hicieron con un ejercicio de la
-- librería; el resto del historial queda igual).
-- ============================================================================

alter table public.rutina_ejercicios
  add column if not exists libreria_ejercicio_id text
  constraint rutina_ejercicios_libreria_ejercicio_id_formato
    check (libreria_ejercicio_id is null or libreria_ejercicio_id ~ '^src-[0-9]{3}-[0-9a-f]{16}$');

alter table public.series_registradas
  add column if not exists libreria_ejercicio_id text
  constraint series_registradas_libreria_ejercicio_id_formato
    check (libreria_ejercicio_id is null or libreria_ejercicio_id ~ '^src-[0-9]{3}-[0-9a-f]{16}$');

comment on column public.rutina_ejercicios.libreria_ejercicio_id is
  'exercise_id canónico de Gym-Exercise-Library elegido por el usuario. Si no es NULL, la app muestra este ejercicio en lugar de ejercicio_id (legacy, que se conserva).';
comment on column public.series_registradas.libreria_ejercicio_id is
  'exercise_id canónico de Gym-Exercise-Library con el que se hizo la serie. NULL = la serie es del ejercicio legacy en ejercicio_id.';

-- El progreso de un ejercicio de la librería se consulta por esta columna.
create index if not exists series_registradas_libreria_ejercicio_id_idx
  on public.series_registradas (libreria_ejercicio_id)
  where libreria_ejercicio_id is not null;
