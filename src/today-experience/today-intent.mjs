// "¿Qué necesitas hoy?" — the user's free-text intent/context for TODAY
// (e.g. "Tengo solo 25 minutos", "Me duele el hombro y quiero evitar
// cargarlo"). Pure storage helpers; app.js reaches them via the bridge in
// browser-entry.mjs.
//
// What this is NOT: a restriction, a diagnosis, or a safety input. It is
// never parsed into contraindications or filters anywhere in code.
// Structured restrictions (perfiles.lesiones / condiciones_medicas) stay
// separate and are edited explicitly by the user. This note is only
// forwarded, verbatim and length-bounded, to the LLM routine generator as
// labeled user intent (see supabase/functions/generate-routine).
//
// Scope: one note per calendar day, in this browser only (best-effort
// localStorage, own namespaced key). A note from a previous day is
// ignored — it described "today" when it was written. That is safe
// precisely because this note is not a restriction: physical restrictions
// live in the profile and never expire on their own (AGENTS.md).

export const TODAY_INTENT_MAX_LENGTH = 500;
const STORAGE_KEY = 'gymapp.todayIntent.v1';

export function localDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeIntentText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, TODAY_INTENT_MAX_LENGTH);
}

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// Returns today's note, or '' when there is none, it is from another day,
// or storage is unavailable/corrupt.
export function readTodayIntent({ storage = defaultStorage(), now = new Date() } = {}) {
  if (!storage) return '';
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.date !== localDateKey(now)) return '';
    return normalizeIntentText(parsed.text);
  } catch {
    return '';
  }
}

// Saves (or clears, for empty text) today's note. Returns the normalized
// text actually stored, so callers can show exactly what will be sent.
export function saveTodayIntent(text, { storage = defaultStorage(), now = new Date() } = {}) {
  const normalized = normalizeIntentText(text);
  if (!storage) return normalized;
  try {
    if (normalized) storage.setItem(STORAGE_KEY, JSON.stringify({ date: localDateKey(now), text: normalized }));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only
  }
  return normalized;
}
