// THE single equipment-vocabulary boundary between GymApp and
// Gym-Exercise-Library. Nothing else in GymApp translates equipment ids.
//
// Library-backed exercises keep the Library's canonical equipment ids
// (`pullup_bar`, `ez_bar`, `cable_machine`, ...) untouched. What gets
// translated is the other side: the user's session equipment, expressed in
// Context Engine's EQUIPMENT vocabulary (src/context-engine/context-schema.mjs),
// is mapped to Library ids right before Compatibility Engine compares the
// two.
//
// Only exact, one-to-one semantic equivalents are mapped. Generic GymApp
// values that correspond to a whole Library family (`machine`,
// `cardio_machine`) or to an unknown specific item (`bench` — flat?
// adjustable? — and `bike` — stationary or not?) are left UNMAPPED on
// purpose: mapping them would claim the user owns equipment they never
// declared. Unmapped values are reported, never silently expanded.

export const EQUIPMENT_MAPPING_VERSION = 'ga006-equipment-v1';

export const GYMAPP_TO_LIBRARY_EQUIPMENT = Object.freeze({
  bodyweight: 'bodyweight',
  dumbbell: 'dumbbell',
  barbell: 'barbell',
  kettlebell: 'kettlebell',
  resistance_band: 'resistance_band',
  pull_up_bar: 'pullup_bar',
});

export const GYMAPP_EQUIPMENT_UNMAPPED = Object.freeze(['bench', 'machine', 'cardio_machine', 'bike']);

// Maps a list of Context Engine equipment values to Library equipment ids.
// Returns { equipment, unmapped } — `equipment` is deduplicated, in input
// order.
export function mapGymAppEquipmentToLibrary(gymAppEquipment) {
  const equipment = [];
  const unmapped = [];
  for (const value of gymAppEquipment ?? []) {
    const libraryId = GYMAPP_TO_LIBRARY_EQUIPMENT[value];
    if (libraryId) {
      if (!equipment.includes(libraryId)) equipment.push(libraryId);
    } else if (!unmapped.includes(value)) {
      unmapped.push(value);
    }
  }
  return { equipment, unmapped };
}

// Returns a copy of a normalized TrainingContext whose `equipment` is
// expressed in Library ids, for use with Library-backed exercises only.
// The original context is not mutated.
export function toLibraryEquipmentContext(context) {
  const { equipment, unmapped } = mapGymAppEquipmentToLibrary(context.equipment);
  return {
    context: Object.freeze({ ...context, equipment: Object.freeze(equipment) }),
    unmappedEquipment: unmapped,
  };
}
