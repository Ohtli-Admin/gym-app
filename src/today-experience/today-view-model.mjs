// Pure translation layer: UI input <-> domain input/output. No DOM code
// lives here — this file is unit-testable with node:test and reusable by
// any future UI (this repo's or otherwise) without change.
import { ENVIRONMENTS, MODALITIES, EXPERIENCE_LEVELS, EQUIPMENT } from '../context-engine/index.mjs';

// --- UI vocabulary (built FROM the real Context Engine enums, never a
// hand-maintained duplicate list) -------------------------------------

export const TIME_OPTIONS_MINUTES = [20, 45, 60, 90];

const ENVIRONMENT_LABELS = {
  gym: 'Gimnasio',
  home: 'Casa',
  outdoor: 'Aire libre',
  travel: 'Viaje',
};
export const ENVIRONMENT_OPTIONS = ENVIRONMENTS.map((value) => ({ value, label: ENVIRONMENT_LABELS[value] ?? value }));

const MODALITY_LABELS = {
  gym: 'Pesas / Gimnasio',
  calisthenics: 'Calistenia',
  cardio: 'Cardio',
  core: 'Core / Abdomen',
};
export const MODALITY_OPTIONS = MODALITIES.map((value) => ({ value, label: MODALITY_LABELS[value] ?? value }));

const LEVEL_LABELS = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};
export const LEVEL_OPTIONS = EXPERIENCE_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value] ?? value }));

const EQUIPMENT_LABELS = {
  bodyweight: 'Peso corporal (sin equipo)',
  dumbbell: 'Mancuernas',
  barbell: 'Barra',
  kettlebell: 'Kettlebell',
  resistance_band: 'Banda de resistencia',
  pull_up_bar: 'Barra de dominadas',
  bench: 'Banco',
  machine: 'Máquina',
  cardio_machine: 'Máquina de cardio',
  bike: 'Bicicleta',
};
export const EQUIPMENT_OPTIONS = EQUIPMENT.map((value) => ({ value, label: EQUIPMENT_LABELS[value] ?? value }));

// `trainingGoal` and `experienceLevel` are required by Context Engine but
// the legacy app has no field that maps onto them cleanly without adding
// scope this slice doesn't need (experienceLevel IS exposed as a UI
// control above; trainingGoal is not, since no current Compatibility/
// Planner rule reads it yet — see README "Deferred: trainingGoal"). This
// constant is the explicit, documented temporary default the task asked
// for instead of silently guessing.
export const TODAY_DEFAULT_TRAINING_GOAL = 'general_fitness';

// A single, hardcoded, developer-authored DEMO restriction — never
// inferred from free text at runtime. Clearly marked DEMO in both the
// description shown to Context Engine and the UI copy that offers it, and
// only ever included when the user explicitly opts in via the UI toggle
// (see today-panel.mjs). This is not read from or written to any real user
// profile data.
export const DEMO_SHOULDER_RESTRICTION = Object.freeze({
  description: 'DEMO: cuidar el hombro al presionar por encima de la cabeza',
  region: 'shoulder',
  avoidTags: ['overhead_press'],
  severity: 'soft',
  source: 'user_declared',
});

export function defaultTodayUiState() {
  return {
    timeAvailableMinutes: 45,
    environment: 'gym',
    modalities: ['gym'],
    experienceLevel: 'intermediate',
    equipment: ['bodyweight'],
    demoShoulderRestriction: false,
    allowConditional: false,
  };
}

// Shapes already-collected UI state into buildTrainingContext()'s raw
// input contract. Does not validate anything itself — Context Engine is
// the single source of truth for validation (see orchestrator.mjs).
export function buildContextInputFromUi(uiState) {
  const restrictions = uiState.demoShoulderRestriction ? [DEMO_SHOULDER_RESTRICTION] : [];
  return {
    trainingGoal: TODAY_DEFAULT_TRAINING_GOAL,
    environment: uiState.environment,
    timeAvailableMinutes: uiState.timeAvailableMinutes,
    experienceLevel: uiState.experienceLevel,
    modalities: uiState.modalities,
    equipment: uiState.equipment,
    restrictions,
  };
}

function formatPrescription(prescription) {
  if (prescription.type === 'sets_reps') {
    return `${prescription.sets} series x ${prescription.reps} repeticiones`;
  }
  if (prescription.type === 'duration') {
    return `${prescription.durationMinutes} minutos`;
  }
  return '';
}

const STATUS_COPY = {
  ready: { headline: 'Tu rutina de hoy está lista', tone: 'success' },
  partial: { headline: 'Encontramos una rutina para hoy (con algunos ajustes)', tone: 'warning' },
  unavailable: { headline: 'No pudimos armar una rutina con lo disponible', tone: 'danger' },
};

// Maps a Compatibility Engine reason code to a short, non-technical
// sentence. Never shows a raw reason code as the only explanation — codes
// stay available on the underlying plan object for developers/logs, but
// the view model always carries human text.
const REASON_MESSAGES = {
  RESTRICTION_SOFT_MATCH: (reason) =>
    `Con precaución por una restricción activa (${reason.detail.matchedTags.join(', ')}).`,
  RESTRICTION_HARD_MATCH: (reason) =>
    `Se evitó por una restricción activa (${reason.detail.matchedTags.join(', ')}).`,
};

const WARNING_MESSAGES = {
  CONDITIONAL_EXERCISES_INCLUDED: (warning) =>
    `Se incluyeron ${warning.detail.exerciseIds.length} ejercicio(s) "con precaución" para completar la rutina.`,
  MODALITY_NOT_COVERED: (warning) =>
    `No encontramos ejercicios disponibles para: ${warning.detail.modalities
      .map((modality) => MODALITY_LABELS[modality] ?? modality)
      .join(', ')}.`,
};

function translateReason(reason) {
  const translate = REASON_MESSAGES[reason.code];
  return translate ? translate(reason) : 'Requiere precaución adicional.';
}

function translateWarning(warning) {
  const translate = WARNING_MESSAGES[warning.code];
  return translate ? translate(warning) : warning.message;
}

// Translates a successful plan into a rendering-friendly view model. Never
// invented/duplicated compatibility or planning logic — every field here
// is read straight off the plan Workout Planner already computed.
export function buildPlanViewModel(plan) {
  const copy = STATUS_COPY[plan.status];
  return {
    kind: 'plan',
    status: plan.status,
    headline: copy.headline,
    tone: copy.tone,
    requestedDurationMinutes: plan.requestedDurationMinutes,
    estimatedDurationMinutes: plan.estimatedDurationMinutes,
    modalitiesCovered: plan.modalitiesCovered.map((modality) => MODALITY_LABELS[modality] ?? modality),
    exercises: plan.exercises.map((item) => ({
      order: item.order,
      exerciseId: item.exerciseId,
      name: item.name ?? item.exerciseId,
      modality: item.modality,
      modalityLabel: MODALITY_LABELS[item.modality] ?? item.modality,
      isConditional: item.status === 'conditional',
      prescriptionText: formatPrescription(item.prescription),
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      cautionMessages: item.reasons.map(translateReason),
    })),
    warnings: plan.warnings.map(translateWarning),
    planId: plan.planId,
  };
}

// Translates an orchestration failure into a user-facing, non-technical
// error view model. `debug` is retained separately for developer
// console/log use — never shown to the user as the primary explanation.
export function buildErrorViewModel(orchestrationResult) {
  if (orchestrationResult.errorKind === 'validation') {
    return {
      kind: 'error',
      tone: 'danger',
      headline: 'Revisa los datos de hoy',
      message: 'Alguno de los datos seleccionados no es válido. Ajusta tus opciones e intenta de nuevo.',
      debug: orchestrationResult.error?.message ?? String(orchestrationResult.error),
    };
  }
  return {
    kind: 'error',
    tone: 'danger',
    headline: 'Algo salió mal generando tu rutina',
    message: 'Hubo un problema interno generando la rutina de hoy. Intenta de nuevo en un momento.',
    debug: orchestrationResult.error?.message ?? String(orchestrationResult.error),
  };
}

export function buildTodayViewModel(orchestrationResult) {
  return orchestrationResult.ok ? buildPlanViewModel(orchestrationResult.plan) : buildErrorViewModel(orchestrationResult);
}

// --- Active workout session view models --------------------------------
// Translate a workout-session.mjs session (raw, functional data) into
// display-friendly text, the same way buildPlanViewModel translates a raw
// plan — no new domain rules, only presentation.

export function buildActiveSessionViewModel(session) {
  const current = session.exercises[session.currentIndex];
  return {
    currentIndex: session.currentIndex,
    totalExercises: session.exercises.length,
    isFirst: session.currentIndex === 0,
    isLast: session.currentIndex === session.exercises.length - 1,
    current: {
      exerciseId: current.exerciseId,
      name: current.name,
      modalityLabel: MODALITY_LABELS[current.modality] ?? current.modality,
      isConditional: current.status === 'conditional',
      cautionMessages: current.reasons.map(translateReason),
      prescriptionText: formatPrescription(current.prescription),
      prescriptionType: current.prescription.type,
      targetSets: current.prescription.type === 'sets_reps' ? current.prescription.sets : null,
      loggedSets: current.sets,
      completed: current.completed,
    },
    exerciseList: session.exercises.map((exercise, index) => ({
      index,
      name: exercise.name,
      completed: exercise.completed,
      isCurrent: index === session.currentIndex,
    })),
  };
}

export function buildSessionSummaryViewModel(summary) {
  return {
    headline: summary.isFullyCompleted ? '¡Entrenamiento completado!' : 'Entrenamiento terminado',
    completedExercises: summary.completedExercises,
    totalExercises: summary.totalExercises,
    totalSets: summary.totalSets,
    durationMinutes: summary.durationMinutes,
  };
}
