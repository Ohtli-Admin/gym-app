// Adapts a legacy Fuerza/Abdomen/Cardio "today's day" (as already loaded
// by app.js from Supabase — see cargarRutina/cargarRutinaAbdomen/
// cargarRutinaCardio) into the same session-item shape
// workout-session.mjs's createSessionFromItems() expects. This is the
// bridge that lets the Today Coordinator combine legacy, Supabase-backed
// plans with the new engine's plans into ONE active-workout session,
// without app.js or this module reimplementing any generation/
// compatibility logic — it only reshapes already-generated data.
//
// Pure, no DOM, no Supabase calls of its own — every function here takes
// the day object app.js already has in memory and returns plain data.
import { resolveModalityPlanningDefaults } from '../workout-planner/prescription-policy.mjs';

function exerciseName(ej) {
  return ej.ejercicios?.nombre || ej.ejercicio_id;
}

// Fuerza and Abdomen days share the same shape:
// { ejercicios: [{ ejercicio_id, ejercicios: { nombre }, series, reps_objetivo }] }
function adaptSetsRepsDay(dia, modality, idPrefix) {
  if (!dia || !Array.isArray(dia.ejercicios)) return [];
  const { estimatedDurationMinutes } = resolveModalityPlanningDefaults(modality);
  return dia.ejercicios.map((ej) => ({
    exerciseId: `${idPrefix}-${ej.ejercicio_id}`,
    name: exerciseName(ej),
    modality,
    status: 'compatible',
    reasons: [],
    prescription: { type: 'sets_reps', sets: ej.series, reps: ej.reps_objetivo },
    estimatedDurationMinutes,
  }));
}

export function adaptFuerzaDay(dia) {
  return adaptSetsRepsDay(dia, 'gym', 'legacy-fuerza');
}

export function adaptAbdomenDay(dia) {
  return adaptSetsRepsDay(dia, 'core', 'legacy-abdomen');
}

// Cardio days use a different shape entirely: phases, not exercises —
// { fases: [{ id, fase, actividad, duracion_min, intensidad }] }. Each
// phase's own planned duration is real product data (unlike the flat
// per-modality estimate used above, where no per-exercise duration
// exists), so it is used directly instead of a flat default.
export function adaptCardioDay(dia) {
  if (!dia || !Array.isArray(dia.fases)) return [];
  return dia.fases.map((fase) => ({
    exerciseId: `legacy-cardio-${fase.id}`,
    name: fase.actividad,
    modality: 'cardio',
    status: 'compatible',
    reasons: [],
    prescription: { type: 'duration', durationMinutes: fase.duracion_min },
    estimatedDurationMinutes: fase.duracion_min,
  }));
}
