# GymApp Current-State Reconciliation

Status: **backend deployment captured; reconciliation in progress**.

This document records evidence from the GitHub repository and deployed Supabase project before product reengineering. No functional application changes are part of this baseline.

## Verified backend

The deployed Supabase project contains these public application tables:

- `perfiles`
- `ejercicios`
- `ejercicio_imagenes`
- `rutinas`
- `rutina_ejercicios`
- `sesiones_entrenamiento`
- `series_registradas`
- `actividades_extra`
- `mediciones_corporales`
- `cardio_plan`

The deployed project also contains four active Edge Functions:

- `generate-routine` (deployed version 14 at reconciliation)
- `regenerate-day` (version 7)
- `generate-cardio-plan` (version 3)
- `regenerate-cardio-day` (version 3)

The Edge Function source was absent from `main` when reconciliation began. Exact copies of the four deployed functions have now been captured in this baseline branch under `supabase/functions/<slug>/index.ts`. Production Supabase was not modified.

## Verified deployed data population

Direct SQL counts during reconciliation confirmed:

- `ejercicios`: 1,464 rows
- `ejercicio_imagenes`: 1,793 rows
- `rutinas`: 7 rows
- `rutina_ejercicios`: 116 rows
- `series_registradas`: 36 rows
- `cardio_plan`: 24 rows

An earlier compact table-inspection response reported zero rows for `ejercicios` and `ejercicio_imagenes`; direct SQL disproved that result. The direct counts are the baseline evidence.

## Verified frontend

The GitHub repository contains a vanilla JavaScript PWA including `index.html`, `app.js`, `styles.css`, `sw.js` and `manifest.json`.

The frontend invokes the Supabase Edge Functions and implements the historically described profile/generator/routine/cardio/history flows.

## Reproducibility gap

Supabase currently reports no database migrations in its migration history. The production backend therefore cannot currently be reconstructed solely from this Git repository.

This is a baseline risk to correct before substantial reengineering.

## Security findings requiring a deliberate migration

At reconciliation time, Supabase reports Row Level Security disabled on:

- `public.ejercicios`
- `public.ejercicio_imagenes`

Do **not** simply enable RLS without first defining and testing the read/write policies required by GymApp; doing so could break the application.

Supabase also reports leaked-password protection disabled in Auth.

## Performance findings

Supabase reports missing covering indexes for foreign keys on:

- `rutina_ejercicios.ejercicio_id`
- `sesiones_entrenamiento.rutina_id`

Existing RLS policies also use per-row auth function evaluation patterns that can be optimized later.

## Architecture boundary

`Gym-Exercise-Library` is a separate repository and is not currently an approved runtime dependency of GymApp.

Future architecture should define a stable versioned contract between the exercise library and GymApp rather than coupling GymApp to the library's repository internals.

## Next baseline work

1. Capture the current database schema as reproducible migrations/schema documentation without changing production.
2. Finish frontend/backend behavioral reconciliation.
3. Reconcile the current GymApp exercise catalog with the independent `Gym-Exercise-Library` contract.
4. Freeze the pre-reengineering baseline.
5. Only then begin product and UX reengineering.


## Database structure captured

A read-only structural snapshot of the deployed public schema was captured under `supabase/baseline/schema_snapshot.sql`. It is intentionally labeled as a baseline artifact, not an executable migration. Production was not changed.

The deployed schema confirms several domain constraints that were only partially visible in the historical handoff:

- `rutinas.tipo` is constrained to `fuerza`, `cardio`, or `abdominales`.
- `actividades_extra.tipo` supports `cardio`, `abdominales`, `calistenia`, `escalada`, and `otro`.
- `rutina_ejercicios.series` is constrained to 1–6.
- `series_registradas.rir` is constrained to 0–5.
- `perfiles.dias_disponibles` is constrained to 1–7 and `metas` to 1–3 entries.
- Exercise images are constrained to the existing image/reference categories.

Foreign keys confirm the current persistence chain:
`auth.users -> perfiles/rutinas/sesiones/actividades/mediciones -> rutina_ejercicios/cardio_plan/series_registradas`, with exercise references pointing to `ejercicios`.

## Frontend/backend reconciliation findings

The current frontend and deployed functions agree on the main routine-generation contract: force/abdomen use `generate-routine`; individual force/abdomen days use `regenerate-day`; cardio has its own generate/regenerate functions.

The current product has two overlapping representations of some training domains. Abdomen and cardio have dedicated generated-routine experiences, while `actividades_extra` also accepts manual abdomen/cardio entries. Calisthenics and climbing currently exist only as manually recorded extra activities, not generated routine domains.

The profile UI hard-codes `nivel = 'intermedio'` when saving identity/profile basics. This is a real implementation constraint, not merely historical documentation.

The generation modal asks the user to manually remove a recovered injury (for example, after recovery). There is no persisted restriction lifecycle, review date, recovery state, or rehabilitation plan model in the current database.

Safety remains split between structured `lesiones[]`/exercise contraindications and free-text `condiciones_medicas`. The deployed generation prompt contains condition-specific reasoning examples, while deterministic validation only verifies catalog membership, equipment, series ranges and matches against the structured contraindication array. Therefore free-text medical restrictions are not fully enforced deterministically.

The frontend directly writes user-owned records such as profile changes, routine exercise substitutions, activities, measurements and training logs through Supabase RLS. Edge Functions use the service role for generated routine persistence after authenticating the caller.

## Reengineering implications (facts, not design decisions)

The current schema has no first-class entities for:

- time-bounded physical restrictions;
- restriction review/recovery lifecycle;
- rehabilitation prescriptions/exercises;
- environment/context for today's workout;
- equipment availability by environment/session;
- generated calisthenics or specialized performance programs.

Those capabilities therefore require explicit model changes rather than only a visual redesign.
