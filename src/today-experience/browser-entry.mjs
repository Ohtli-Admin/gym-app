// The ONLY bridge between the classic, non-module `app.js` and the
// GymApp 2.0 ES modules. `app.js` cannot `import` anything (it is loaded
// as a classic <script>, not type="module"), so this file is loaded
// separately as a module (see index.html) and exposes a small, explicit
// surface on `window` for app.js to call. No domain, orchestration, or
// aggregation logic lives here — it only re-exports/wraps functions
// already defined and tested elsewhere in this directory.
import { mount } from './today-panel.mjs';
import { adaptFuerzaDay, adaptAbdomenDay, adaptCardioDay } from './legacy-adapter.mjs';
import { buildTodayOverview } from './today-coordinator.mjs';
import { createSessionFromItems, setActiveSession, getActiveSession, getSessionSlots } from './workout-session.mjs';
import { getResumeState } from './session-builder.mjs';
import { readTodayIntent, saveTodayIntent, TODAY_INTENT_MAX_LENGTH } from './today-intent.mjs';
import {
  SPECIAL_TRAINING_MODES,
  productsUsingObjective,
  readAdaptObjective,
  saveAdaptObjective,
  clearAdaptObjective,
  objectiveTextForProduct,
} from './special-training.mjs';

// Builds one combined active-workout session from already-adapted items
// and stores it, so the caller only needs to `irAPantalla('entrenar')`
// afterward.
function startSessionFromItems(items, planId) {
  setActiveSession(createSessionFromItems(items, { planId }));
}

// True while a session is started but not finished (the store only ever
// returns unfinished sessions).
function hasActiveSession() {
  return Boolean(getActiveSession());
}

window.GymAppTodayExperience = {
  mount,
  adaptFuerzaDay,
  adaptAbdomenDay,
  adaptCardioDay,
  buildTodayOverview,
  startSessionFromItems,
  hasActiveSession,
  // { active, activeOrigin, preparedOrigin } for the Entrenamiento hub.
  getResumeState: () => getResumeState(getSessionSlots()),
  // The Entrenamiento especial text stored with a prepared routine (to
  // restore that screen after navigation/refresh), or ''.
  preparedSessionText: (origin) => {
    const prepared = getSessionSlots().getPrepared();
    return prepared?.origin === origin ? prepared.sessionContext?.text ?? '' : '';
  },
  readTodayIntent: () => readTodayIntent(),
  saveTodayIntent: (text) => saveTodayIntent(text),
  TODAY_INTENT_MAX_LENGTH,
  SPECIAL_TRAINING_MODES,
  productsUsingObjective,
  readAdaptObjective: () => readAdaptObjective(),
  saveAdaptObjective: (text) => saveAdaptObjective(text),
  clearAdaptObjective: () => clearAdaptObjective(),
  objectiveTextForProduct,
};
