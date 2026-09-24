// "Entrenamiento especial" — an unusual or temporary need the user
// describes in their own words ("En 30 días voy a un concierto…", "Hoy no
// fui al gym y quiero entrenar en casa"). Pure helpers; app.js reaches
// them via the bridge in browser-entry.mjs.
//
// Two explicit, separate intents (never inferred from the text):
//
// - INDEPENDENT: a one-off workout. Nothing is persisted here; app.js opens
//   the on-demand session builder for it.
// - ADAPT_PLANS: a temporary objective that should influence the user's
//   existing plans. Persisted (this browser only, best-effort) until the
//   user removes it — it is not a restriction, so it has no automatic
//   expiry and no automatic effect beyond what `productsUsingObjective`
//   declares.
//
// What this is NOT: a diagnosis, a rehabilitation protocol, or a safety
// input. The text is never parsed into filters or contraindications. It
// is only forwarded, length-bounded, to the LLM plan generator as labeled
// user intent, and only for the products listed below — the ones whose
// backend actually accepts it today.

import { normalizeIntentText } from './today-intent.mjs';

export const SPECIAL_TRAINING_MODES = Object.freeze({
  INDEPENDENT: 'independent',
  ADAPT_PLANS: 'adapt_plans',
});

// Products whose generator currently receives the objective (both go
// through generate-routine, which accepts `intencion_hoy`). Cardio's
// generator does not read a request body yet; Calisthenics has no
// persisted plan. Keep this list honest — the UI reads it to tell the
// user exactly where the objective is and is not applied.
const PRODUCTS_USING_OBJECTIVE = Object.freeze(['fuerza', 'abdomen']);

const STORAGE_KEY = 'gymapp.specialObjective.v1';

export function productsUsingObjective() {
  return [...PRODUCTS_USING_OBJECTIVE];
}

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// Returns the active "adapt my plans" objective, or null.
export function readAdaptObjective({ storage = defaultStorage() } = {}) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    const text = normalizeIntentText(parsed?.text);
    if (!text || parsed.mode !== SPECIAL_TRAINING_MODES.ADAPT_PLANS) return null;
    return { text, mode: parsed.mode, createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null };
  } catch {
    return null;
  }
}

// Saves (or, for empty text, clears) the objective. Returns what was
// stored, or null when cleared.
export function saveAdaptObjective(text, { storage = defaultStorage(), now = new Date() } = {}) {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    clearAdaptObjective({ storage });
    return null;
  }
  const objective = { text: normalized, mode: SPECIAL_TRAINING_MODES.ADAPT_PLANS, createdAt: now.toISOString() };
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(objective));
    } catch {
      // best-effort only
    }
  }
  return objective;
}

export function clearAdaptObjective({ storage = defaultStorage() } = {}) {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only
  }
}

// The text to send with a plan generation for `product`, or '' when that
// product does not use the objective (or there is none).
export function objectiveTextForProduct(product, objective) {
  if (!objective?.text) return '';
  return PRODUCTS_USING_OBJECTIVE.includes(product) ? objective.text : '';
}
