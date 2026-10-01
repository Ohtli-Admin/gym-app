// Lifecycle controller for the on-demand, Library-backed session builder
// (Calistenia and Entrenamiento especial → independiente). No DOM: the
// panel (today-panel.mjs) only renders what these functions return, and the
// tests drive them directly, with a fresh session-slots instance over the
// same storage standing in for navigation/refresh.
//
//   generatePreparedSession  explicit Generar/Regenerar: advances the seed
//                            once, runs the real pipeline, persists the
//                            EXACT result as the prepared session.
//   getBuilderState          what to show on (re)mount — reads storage,
//                            never generates, never touches the seed.
//   startPreparedSession     "Empezar": prepared -> active.
import { runLibraryOrchestration } from './orchestrator.mjs';
import { buildTodayViewModel } from './today-view-model.mjs';
import { createSessionFromPlan } from './workout-session.mjs';
import { buildRuntimePhysicalContext } from './physical-context.mjs';

export const BUILDER_ORIGINS = Object.freeze({ CALISTENIA: 'calistenia', ESPECIAL: 'especial' });

const ORIGIN_LABELS = { calistenia: 'Calistenia', especial: 'Entrenamiento especial' };

const REQUEST_FIELDS = ['timeAvailableMinutes', 'environment', 'modalities', 'experienceLevel', 'equipment', 'allowConditional'];

function pickRequest(uiState) {
  return Object.fromEntries(REQUEST_FIELDS.map((field) => [field, structuredClone(uiState[field])]));
}

function libraryIdentity(manifest) {
  return {
    repository: manifest?.source?.repository ?? null,
    commit: manifest?.source?.commit ?? null,
    snapshotGeneratedAt: manifest?.generatedAt ?? null,
    filteringPolicyVersion: manifest?.filteringPolicy?.version ?? null,
    importedRecordCount: manifest?.importedRecordCount ?? null,
  };
}

// Explicit generation. `physicalInputs` = { legacyChips, profileText,
// sessionText } — read by the caller at click time, never stored back
// anywhere except inside this session's own record.
export function generatePreparedSession({ slots, origin, uiState, provider, physicalInputs = {}, now = new Date() }) {
  const seed = slots.takeNextSeed(now);
  const physical = buildRuntimePhysicalContext(physicalInputs);
  const result = runLibraryOrchestration(
    {
      ...uiState,
      sessionSeed: seed.value,
      profileRestrictions: physical.restrictions,
      sessionNotes: physical.sessionNotes,
    },
    provider,
  );
  if (!result.ok) return { result, prepared: null };

  const prepared = {
    version: 1,
    state: 'generated',
    origin,
    createdAt: now.toISOString(),
    seed,
    request: pickRequest(uiState),
    context: {
      libraryEquipment: [...result.context.equipment],
      unmappedEquipment: [...(result.unmappedEquipment ?? [])],
    },
    library: libraryIdentity(provider.manifest),
    physicalContext: physical.report,
    sessionContext: { text: physical.sessionNotes },
    // Exact ids, order and prescriptions as generated (JSON-safe copy).
    plan: structuredClone(result.plan),
  };
  slots.savePrepared(prepared);
  return { result, prepared };
}

// Pure read for (re)mount. Never regenerates and never advances the seed.
export function getBuilderState(slots, origin) {
  const prepared = slots.getPrepared();
  return {
    prepared: prepared?.origin === origin ? prepared : null,
    otherPrepared: prepared && prepared.origin !== origin ? prepared : null,
    active: slots.getActive(),
  };
}

export function preparedViewModel(prepared) {
  return buildTodayViewModel({ ok: true, plan: prepared.plan, catalogSource: 'exercise_library' });
}

// Text for a confirm() before an explicit Generar/Regenerar would replace
// an unfinished prepared routine; null when nothing would be lost.
export function regenerateWarning(slots) {
  const prepared = slots.getPrepared();
  if (!prepared) return null;
  return `Ya tienes una rutina preparada (${ORIGIN_LABELS[prepared.origin] ?? prepared.origin}). Generar otra la reemplaza. ¿Continuar?`;
}

// Text for a confirm() before "Empezar" would replace an unfinished
// session in progress; null when there is none.
export function startWarning(slots) {
  const active = slots.getActive();
  if (!active) return null;
  return 'Tienes una sesión en curso sin terminar. Empezar esta rutina la reemplaza. ¿Continuar?';
}

// Prepared -> active. The prepared record's identity travels with the
// session in `meta`; the prepared slot is cleared.
export function startPreparedSession(slots, { now = Date.now() } = {}) {
  const prepared = slots.getPrepared();
  if (!prepared) return null;
  const session = createSessionFromPlan(prepared.plan, {
    meta: {
      origin: prepared.origin,
      seed: prepared.seed,
      request: prepared.request,
      context: prepared.context,
      library: prepared.library,
      physicalContext: prepared.physicalContext,
      sessionContext: prepared.sessionContext,
      preparedAt: prepared.createdAt,
    },
  });
  session.startedAt = now;
  slots.saveActive(session);
  slots.clearPrepared();
  return session;
}

// For the Entrenamiento hub.
export function getResumeState(slots) {
  const active = slots.getActive();
  const prepared = slots.getPrepared();
  return {
    active: Boolean(active),
    activeOrigin: active?.meta?.origin ?? null,
    preparedOrigin: prepared?.origin ?? null,
  };
}
