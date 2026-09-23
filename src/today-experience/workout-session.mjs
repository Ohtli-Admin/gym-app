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

// A "session item" is the minimal shape a source of exercises must
// provide: { exerciseId, name, modality, status, reasons, prescription,
// estimatedDurationMinutes } — exactly what a Workout Planner plan item
// already looks like. This lets the same active-workout UI run a single
// product's plan (createSessionFromPlan) or a combined, multi-product
// session assembled by the Today Coordinator from several sources at once
// (createSessionFromItems) — see today-coordinator.mjs and
// legacy-adapter.mjs, which adapt legacy Fuerza/Cardio/Abdomen day data
// into this exact shape so it can flow through the same session engine.
export function createSessionFromItems(items, { planId = 'session' } = {}) {
  return {
    planId,
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

export function createSessionFromPlan(plan) {
  return createSessionFromItems(plan.exercises, { planId: plan.planId });
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
// A module-level cache backed by best-effort localStorage, so the active
// workout survives both in-app navigation (Hoy <-> Entrenar <-> Progreso)
// and a page reload. Every localStorage access is wrapped in try/catch —
// it can throw or be unavailable (private browsing, blocked storage,
// non-browser test environment) and this must never crash the app; it
// degrades to in-memory-only for that session in that case.
const STORAGE_KEY = 'gymapp2.activeSession.v1';
let cachedSession; // undefined = not loaded from storage yet this session

function readStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(session) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only
  }
}

export function getActiveSession() {
  if (cachedSession === undefined) {
    cachedSession = readStorage();
  }
  return cachedSession;
}

export function setActiveSession(session) {
  cachedSession = session;
  writeStorage(session);
  return session;
}

export function clearActiveSession() {
  cachedSession = null;
  writeStorage(null);
}
