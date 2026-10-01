// Pure active-workout session state machine, plus a small shared,
// local-only session store. No DOM code here — see today-panel.mjs.
//
// PERSISTENCE DECISION (deliberate, not a shortcut): this does NOT write
// to Supabase's `rutinas`/`rutina_ejercicios`/`series_registradas` tables.
// The demo catalog's exercise ids (e.g. `demo-dumbbell-goblet-squat`) are
// not legacy `ejercicios` rows and are not canonical Gym-Exercise-Library
// ids either — writing them into those tables would invent exercise
// identity outside the approved catalog (forbidden by AGENTS.md) and risk
// corrupting real historical data. A local-only session (in-memory +
// best-effort localStorage, under its own namespaced key) is the CORRECT
// choice until a real catalog provider supplies real, storable exercise
// identity — not merely the fastest one. See README "Logging/persistence".

import { createSessionSlots } from './session-slots.mjs';

// A "session item" is the minimal shape a source of exercises must
// provide: { exerciseId, name, modality, status, reasons, prescription,
// estimatedDurationMinutes } — exactly what a Workout Planner plan item
// already looks like. This lets the same active-workout UI run a single
// product's plan (createSessionFromPlan) or a combined, multi-product
// session assembled by the Today Coordinator from several sources at once
// (createSessionFromItems) — see today-coordinator.mjs and
// legacy-adapter.mjs, which adapt legacy Fuerza/Cardio/Abdomen day data
// into this exact shape so it can flow through the same session engine.
// `meta` (optional) carries what is needed to explain/restore where the
// session came from (origin, seed, request, Library snapshot identity);
// see session-builder.mjs.
export function createSessionFromItems(items, { planId = 'session', meta = null } = {}) {
  return {
    planId,
    meta,
    startedAt: Date.now(),
    finishedAt: null,
    currentIndex: 0,
    exercises: items.map((item) => ({
      exerciseId: item.exerciseId,
      name: item.name,
      modality: item.modality,
      status: item.status,
      reasons: item.reasons,
      prescription: item.prescription,
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      sets: [],
      completed: false,
    })),
  };
}

export function createSessionFromPlan(plan, { meta = null } = {}) {
  return createSessionFromItems(plan.exercises, { planId: plan.planId, meta });
}

export function logSet(session, exerciseIndex, { reps = null, weight = null } = {}) {
  const exercise = session.exercises[exerciseIndex];
  exercise.sets.push({ setNumber: exercise.sets.length + 1, reps, weight, completedAt: Date.now() });
  return session;
}

export function completeExercise(session, exerciseIndex) {
  session.exercises[exerciseIndex].completed = true;
  return session;
}

export function goToExercise(session, index) {
  if (index >= 0 && index < session.exercises.length) {
    session.currentIndex = index;
  }
  return session;
}

export function finishSession(session) {
  session.finishedAt = Date.now();
  return session;
}

export function buildSessionSummary(session) {
  const totalExercises = session.exercises.length;
  const completedExercises = session.exercises.filter((exercise) => exercise.completed).length;
  const totalSets = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const durationMinutes = session.finishedAt
    ? Math.max(0, Math.round((session.finishedAt - session.startedAt) / 60000))
    : null;
  return {
    totalExercises,
    completedExercises,
    totalSets,
    durationMinutes,
    isFullyCompleted: totalExercises > 0 && completedExercises === totalExercises,
  };
}

// --- Shared, local-only active-session store -------------------------
// Thin wrappers over the default session-slots instance
// (session-slots.mjs), kept so existing callers (today-panel.mjs, the
// browser bridge for Fuerza/Cardio/Core day sessions) don't change. Every
// call reads/writes storage directly — no module cache — so what survives
// navigation is exactly what survives a refresh.
const defaultSlots = createSessionSlots();

export function getSessionSlots() {
  return defaultSlots;
}

// The resumable (unfinished) session, or null.
export function getActiveSession() {
  return defaultSlots.getActive();
}

// Saving a finished session (finishSession() sets finishedAt) moves it out
// of the resumable slot into "last completed" (summary only).
export function setActiveSession(session) {
  if (session?.finishedAt) defaultSlots.completeActive(session);
  else defaultSlots.saveActive(session);
  return session;
}

export function clearActiveSession() {
  defaultSlots.clearActive();
}
