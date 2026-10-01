// Local, resumable session slots (GA-006). The single source of truth for
// "what workout is prepared / in progress / just finished" in this
// browser. Local-only by design: canonical Library ids must not be written
// into the legacy Supabase history tables (see workout-session.mjs).
//
// Lifecycle:
//   GENERATED  -> PREPARED slot, written immediately after generation.
//   ACTIVE     -> ACTIVE slot, written on "Empezar entrenamiento" and after
//                 every change (set logged, exercise completed, navigation
//                 between exercises). The prepared slot is cleared then.
//   COMPLETED  -> on "Finalizar": removed from the ACTIVE slot (no longer
//                 resumable) and kept in LAST_COMPLETED only so the
//                 summary screen can be shown until the user dismisses it.
//
// Every read goes to storage (no module cache), so a new instance over the
// same storage behaves exactly like a page refresh. When storage is
// unavailable (private mode, blocked, Node) a per-instance in-memory map is
// used instead, so the app still works for that page's lifetime.
import { localDateKey } from './today-intent.mjs';

export const SESSION_KEYS = Object.freeze({
  PREPARED: 'gymapp2.preparedSession.v1',
  // Unchanged from GA-005 so an in-progress session survives this update.
  ACTIVE: 'gymapp2.activeSession.v1',
  LAST_COMPLETED: 'gymapp2.lastCompletedSession.v1',
  SEED: 'gymapp2.sessionSeed.v1',
});

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

export function createSessionSlots(storage = defaultStorage()) {
  const fallback = memoryStorage();
  const store = storage ?? fallback;

  const read = (key) => {
    try {
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value === null || value === undefined) store.removeItem(key);
      else store.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full/blocked: keep the page working in memory.
      if (value === null || value === undefined) fallback.removeItem(key);
      else fallback.setItem(key, JSON.stringify(value));
    }
  };

  const slots = {
    getPrepared: () => read(SESSION_KEYS.PREPARED),
    savePrepared: (prepared) => {
      write(SESSION_KEYS.PREPARED, prepared);
      return prepared;
    },
    clearPrepared: () => write(SESSION_KEYS.PREPARED, null),

    // Returns the resumable (unfinished) session or null. A session stored
    // by the GA-005 build with `finishedAt` set is migrated to
    // LAST_COMPLETED on first read.
    getActive: () => {
      const session = read(SESSION_KEYS.ACTIVE);
      if (session?.finishedAt) {
        write(SESSION_KEYS.LAST_COMPLETED, session);
        write(SESSION_KEYS.ACTIVE, null);
        return null;
      }
      return session;
    },
    saveActive: (session) => {
      write(SESSION_KEYS.ACTIVE, session);
      return session;
    },
    clearActive: () => write(SESSION_KEYS.ACTIVE, null),

    // Moves a finished session out of the resumable slot.
    completeActive: (finishedSession) => {
      write(SESSION_KEYS.LAST_COMPLETED, finishedSession);
      write(SESSION_KEYS.ACTIVE, null);
      return finishedSession;
    },
    getLastCompleted: () => read(SESSION_KEYS.LAST_COMPLETED),
    dismissLastCompleted: () => write(SESSION_KEYS.LAST_COMPLETED, null),

    // The ONLY way a generation seed advances. Called once per explicit
    // generate/regenerate, never on render, navigation or refresh. The
    // first generation of a local day is `#0`, so it is reproducible.
    takeNextSeed: (now = new Date()) => {
      const date = localDateKey(now);
      const stored = read(SESSION_KEYS.SEED);
      const attempt = stored?.date === date && Number.isInteger(stored.next) ? stored.next : 0;
      write(SESSION_KEYS.SEED, { date, next: attempt + 1 });
      return { date, attempt, value: `${date}#${attempt}` };
    },
  };
  return slots;
}
