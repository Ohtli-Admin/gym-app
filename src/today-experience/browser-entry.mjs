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
import { createSessionFromItems, setActiveSession } from './workout-session.mjs';
import { readTodayIntent, saveTodayIntent, TODAY_INTENT_MAX_LENGTH } from './today-intent.mjs';

// Used by app.js's Inicio screen (the Today Coordinator's "Empezar
// entrenamiento completo" action): builds one combined active-workout
// session from already-adapted items and stores it, so the caller only
// needs to `irAPantalla('entrenar')` afterward.
function startSessionFromItems(items, planId) {
  setActiveSession(createSessionFromItems(items, { planId }));
}

window.GymAppTodayExperience = {
  mount,
  adaptFuerzaDay,
  adaptAbdomenDay,
  adaptCardioDay,
  buildTodayOverview,
  startSessionFromItems,
  readTodayIntent: () => readTodayIntent(),
  saveTodayIntent: (text) => saveTodayIntent(text),
  TODAY_INTENT_MAX_LENGTH,
};
