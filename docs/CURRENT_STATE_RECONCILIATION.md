# GymApp Current-State Reconciliation

Status: **baseline reconciliation in progress**.

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

The Edge Function source exists in Supabase deployment state but was not present under `supabase/functions/` in the GitHub `main` branch when reconciliation began.

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

1. Version the exact deployed Edge Function source in this branch.
2. Capture the current database schema as reproducible migrations/schema documentation without changing production.
3. Finish frontend/backend behavioral reconciliation.
4. Resolve discrepancies in exercise catalog/media population.
5. Freeze the pre-reengineering baseline.
6. Only then begin product and UX reengineering.
