-- GymApp baseline schema snapshot
-- Captured read-only from deployed Supabase GYM-APP on 2026-09-20.
-- Documentation/reproducibility artifact only. NOT yet approved as a migration to run.

create extension if not exists pgcrypto;

create table if not exists public.actividades_extra (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  tipo text NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  duracion_min integer,
  nombre_actividad text,
  created_at timestamp with time zone DEFAULT now(),
  series integer,
  repeticiones text,
  notas text
);

create table if not exists public.cardio_plan (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rutina_id uuid NOT NULL,
  dia integer NOT NULL,
  nombre_dia text,
  fase text NOT NULL,
  actividad text NOT NULL,
  duracion_min integer NOT NULL,
  intensidad text,
  orden integer NOT NULL DEFAULT 0
);

create table if not exists public.ejercicio_imagenes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ejercicio_id text NOT NULL,
  tipo text NOT NULL,
  url text NOT NULL,
  orden integer DEFAULT 0
);

create table if not exists public.ejercicios (
  id text NOT NULL,
  nombre text NOT NULL,
  grupo_muscular text NOT NULL,
  equipo text NOT NULL,
  nivel text,
  contraindicaciones text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now()
);

create table if not exists public.mediciones_corporales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  peso_kg numeric(5,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

create table if not exists public.perfiles (
  id uuid NOT NULL,
  peso_kg numeric(5,2),
  edad integer,
  nivel text,
  lesiones text[] DEFAULT '{}'::text[],
  dias_disponibles integer,
  equipo_disponible text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  metas text[],
  evitar_maquinas boolean DEFAULT false,
  nombre text,
  condiciones_medicas text,
  dias_disponibles_cardio integer
);

create table if not exists public.rutina_ejercicios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rutina_id uuid NOT NULL,
  ejercicio_id text NOT NULL,
  dia integer NOT NULL,
  nombre_dia text,
  series integer NOT NULL,
  reps_objetivo text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  alternativas jsonb DEFAULT '[]'::jsonb,
  peso_asistido boolean DEFAULT false
);

create table if not exists public.rutinas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  nombre text,
  resumen text,
  activa boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  tipo text NOT NULL DEFAULT 'fuerza'::text
);

create table if not exists public.series_registradas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL,
  ejercicio_id text NOT NULL,
  numero_serie integer NOT NULL,
  peso_kg numeric(6,2),
  repeticiones integer,
  rir integer,
  created_at timestamp with time zone DEFAULT now()
);

create table if not exists public.sesiones_entrenamiento (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  rutina_id uuid,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  dia integer
);

-- Constraints, foreign keys, RLS policies and indexes are documented in
-- docs/CURRENT_STATE_RECONCILIATION.md and must be converted into an ordered
-- migration only after dependency/order review. This snapshot intentionally
-- must not be applied blindly to production.
