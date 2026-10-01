// The user's physical context for ONE generation (runtime only).
//
// Three explicit inputs, kept distinct:
//
// A. PERSISTENT, user-authored — `perfiles.condiciones_medicas`, shown in
//    Perfil as "Lesiones, molestias o limitaciones que quieras que GymApp
//    tenga en cuenta". Saved only when the user saves Perfil, verbatim.
// B. PERSISTENT, legacy structured shortcuts — `perfiles.lesiones` chips
//    (Hombro, Rodilla, ...). Kept for backward compatibility (they are
//    also read by generate-routine); not the long-term model.
// C. TEMPORARY session context — the Entrenamiento especial text for this
//    session ("Hoy me duele la rodilla", "entreno en casa"). Lives only
//    with the prepared/active session it was generated with.
//
// What this module does NOT do: it never parses free text (A or C) into
// anatomy, avoid-tags or any rule — there is no deterministic way to do
// that honestly — and it never writes anything anywhere. The objects it
// returns are runtime inputs for Context Engine plus a report for the UI;
// nothing here becomes a permanent profile fact.
import { profileInjuriesToRestrictions } from '../exercise-library/profile-restriction-mapping.mjs';
import { normalizeIntentText } from './today-intent.mjs';

// Same length bound as the other free-text contexts.
function cleanText(text) {
  return normalizeIntentText(text);
}

export function buildRuntimePhysicalContext({ legacyChips = [], profileText = '', sessionText = '' } = {}) {
  const chips = profileInjuriesToRestrictions(legacyChips);
  const userProfileText = cleanText(profileText);
  const temporaryText = cleanText(sessionText);

  const restrictions = [...chips.restrictions];
  if (userProfileText) {
    // Carried into Context Engine verbatim, with NO avoidTags: it is part
    // of the context the session was built with, but Compatibility Engine
    // cannot (and must not) turn it into matching rules.
    restrictions.push({
      description: userProfileText,
      source: 'user_declared',
      avoidTags: [],
    });
  }

  return {
    restrictions,
    // Context Engine's preferences.notes: free-text session context.
    sessionNotes: temporaryText || null,
    report: {
      verifiedChips: chips.applied,
      unverifiableChips: chips.unverifiable,
      profileText: userProfileText || null,
      sessionText: temporaryText || null,
    },
  };
}

// UI wording. Never claims completeness and never calls an exercise safe.
export function buildPhysicalContextMessages(report) {
  if (!report) return [];
  const messages = [];
  const anything = report.verifiedChips.length || report.unverifiableChips.length || report.profileText || report.sessionText;
  if (!anything) return messages;

  messages.push('GymApp aplicó las restricciones que pudo verificar con la información disponible del catálogo.');
  if (report.verifiedChips.length) {
    messages.push(
      `Se evitaron los ejercicios que el catálogo registra en la zona de: ${report.verifiedChips.join(', ')}. El catálogo no registra la zona de todos los ejercicios, así que algunos que la involucran podrían no detectarse.`,
    );
  }
  if (report.unverifiableChips.length) {
    messages.push(`No se pudo verificar con el catálogo: ${report.unverifiableChips.join(', ')}.`);
  }
  if (report.profileText) {
    messages.push(`Lo que describiste en tu Perfil («${report.profileText}») no se puede evaluar automáticamente contra el catálogo.`);
  }
  if (report.sessionText) {
    messages.push(`El contexto de esta sesión («${report.sessionText}») no se puede evaluar automáticamente contra el catálogo.`);
  }
  messages.push('Revisa cada ejercicio con esto en mente y omite o cambia lo que no te convenga.');
  return messages;
}
