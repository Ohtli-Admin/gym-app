// Structured profile restrictions -> Context Engine restrictions for
// Library-backed sessions. GA-006 hardening.
//
// Input is ONLY `perfiles.lesiones`: a controlled list the Perfil screen
// offers as chips (LESIONES_COMUNES in app.js). `condiciones_medicas` is
// free text and is never read here, and nothing is parsed out of any text.
//
// Each chip maps to the Library body region (taxonomy/body-regions.json)
// that literally names that area. The resulting restriction avoids
// exercises whose Library `body_regions` contain that region. This is a
// region-to-region match, not an inference about which movements are
// risky, and it is not a diagnosis. Severity is left to Context Engine's
// default (`hard`, user_declared): a declared injury area is excluded, not
// merely flagged.
//
// A chip with no matching Library region (`Rodilla`: the taxonomy has
// thigh and lower_leg_foot, but no knee) is NOT approximated. It is
// returned as `unverifiable` so the UI can say so.

export const PROFILE_RESTRICTION_MAPPING_VERSION = 'ga006-profile-restrictions-v1';

export const PROFILE_INJURY_TO_LIBRARY_REGION = Object.freeze({
  Hombro: 'shoulder_girdle', // "Hombros y cintura escapular"
  Muñeca: 'forearm_hand', // "Antebrazo, muñeca y mano" (broader: also forearm/hand)
  'Espalda baja': 'posterior_core', // "Core posterior y lumbar"
  Cadera: 'hip_pelvis', // "Cadera y pelvis"
  Tobillo: 'lower_leg_foot', // "Pierna inferior, tobillo y pie" (broader)
});

// Returns { restrictions, applied, unverifiable } where `restrictions` is
// ready for buildTrainingContext() and `applied`/`unverifiable` are the
// original profile values, for display.
export function profileInjuriesToRestrictions(lesiones) {
  const restrictions = [];
  const applied = [];
  const unverifiable = [];
  for (const value of Array.isArray(lesiones) ? lesiones : []) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const label = value.trim();
    const region = PROFILE_INJURY_TO_LIBRARY_REGION[label];
    if (!region) {
      if (!unverifiable.includes(label)) unverifiable.push(label);
      continue;
    }
    if (applied.includes(label)) continue;
    applied.push(label);
    restrictions.push({
      description: `Perfil: lesión declarada (${label})`,
      region,
      avoidTags: [region],
      source: 'user_declared',
    });
  }
  return { restrictions, applied, unverifiable };
}
