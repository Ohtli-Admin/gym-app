// GymApp-side PILOT trust policy for Gym-Exercise-Library records (GA-006).
//
// The Library's catalog is still evolving: at the time of GA-006 every
// record is `status: draft` / `review.status: review_required`. This policy
// does NOT promote any record to "approved". It only decides whether a
// record is structurally complete enough for GymApp's adapter to consume
// without fabricating anything. Every record that passes is tagged
// `trust: 'pilot'` by the adapter (see library-adapter.mjs), never treated
// as final catalog maturity.
//
// Pure and deterministic. Used both by tools/sync-exercise-library.mjs
// (build time, with the Library's taxonomy ids available) and by the
// runtime provider (defense in depth, without taxonomy ids).

export const PILOT_POLICY_VERSION = 'ga006-pilot-v1';

// Only the Library schema version this adapter was written against.
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['0.2']);

// `exercise_id` / taxonomy id pattern, as declared by the Library's
// schemas/exercise.schema.json (`^[a-z0-9][a-z0-9_-]*$`).
export const LIBRARY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

// Statuses accepted for the pilot. `deprecated` is excluded: a record the
// Library itself retired must not enter new sessions.
export const PILOT_ACCEPTED_STATUSES = Object.freeze(['draft', 'review_required', 'approved']);

export const REJECTION_REASONS = Object.freeze({
  RECORD_NOT_OBJECT: 'RECORD_NOT_OBJECT',
  SCHEMA_VERSION_UNSUPPORTED: 'SCHEMA_VERSION_UNSUPPORTED',
  EXERCISE_ID_INVALID: 'EXERCISE_ID_INVALID',
  EXERCISE_ID_DUPLICATE: 'EXERCISE_ID_DUPLICATE',
  STATUS_NOT_ACCEPTED: 'STATUS_NOT_ACCEPTED',
  NAME_MISSING: 'NAME_MISSING',
  EQUIPMENT_REQUIRED_INVALID: 'EQUIPMENT_REQUIRED_INVALID',
  // An empty `equipment_required` means "unknown" upstream (the Library
  // records unresolved equipment as empty/null), NOT "no equipment".
  // Accepting it would make Compatibility Engine treat it as bodyweight —
  // a fabricated fact — so it is rejected.
  EQUIPMENT_REQUIRED_EMPTY: 'EQUIPMENT_REQUIRED_EMPTY',
  EQUIPMENT_ID_UNKNOWN: 'EQUIPMENT_ID_UNKNOWN',
  TRAINING_TYPES_INVALID: 'TRAINING_TYPES_INVALID',
  TRAINING_TYPES_EMPTY: 'TRAINING_TYPES_EMPTY',
  TRAINING_TYPE_ID_UNKNOWN: 'TRAINING_TYPE_ID_UNKNOWN',
  OBJECTIVE_METADATA_INVALID: 'OBJECTIVE_METADATA_INVALID',
});

// Objective arrays the adapter maps (besides equipment_required and
// training_types, which have their own reasons). They may be empty — the
// Library leaves unknown anatomy empty on purpose — but must be well-formed.
const OBJECTIVE_ARRAY_PATHS = Object.freeze([
  ['setup', 'equipment_optional'],
  ['classification', 'body_regions'],
  ['classification', 'primary_muscles'],
  ['classification', 'joint_actions'],
  ['classification', 'movement_patterns'],
  ['biomechanics', 'constraints'],
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && LIBRARY_ID_PATTERN.test(item));
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Display name policy: names.es when present, otherwise names.en. Never
// translated or invented.
export function resolveDisplayName(record) {
  const names = isPlainObject(record?.names) ? record.names : {};
  const es = nonBlank(names.es);
  if (es) return { name: es, language: 'es' };
  const en = nonBlank(names.en);
  if (en) return { name: en, language: 'en' };
  return null;
}

// Returns { accepted, reasons: [{ code, detail }] }. `taxonomy` is
// optional: when the sync tool passes the Library's equipment / training
// type ids, unknown ids are rejected too.
export function evaluatePilotRecord(record, { equipmentIds = null, trainingTypeIds = null } = {}) {
  const reasons = [];
  const reject = (code, detail = null) => reasons.push({ code, detail });

  if (!isPlainObject(record)) {
    reject(REJECTION_REASONS.RECORD_NOT_OBJECT);
    return { accepted: false, reasons };
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(record.schema_version)) {
    reject(REJECTION_REASONS.SCHEMA_VERSION_UNSUPPORTED, { schemaVersion: record.schema_version ?? null });
  }
  if (typeof record.exercise_id !== 'string' || !LIBRARY_ID_PATTERN.test(record.exercise_id)) {
    reject(REJECTION_REASONS.EXERCISE_ID_INVALID);
  }
  if (!PILOT_ACCEPTED_STATUSES.includes(record.status)) {
    reject(REJECTION_REASONS.STATUS_NOT_ACCEPTED, { status: record.status ?? null });
  }
  if (!resolveDisplayName(record)) {
    reject(REJECTION_REASONS.NAME_MISSING);
  }

  const equipmentRequired = record.setup?.equipment_required;
  if (!isIdArray(equipmentRequired)) {
    reject(REJECTION_REASONS.EQUIPMENT_REQUIRED_INVALID);
  } else if (equipmentRequired.length === 0) {
    reject(REJECTION_REASONS.EQUIPMENT_REQUIRED_EMPTY);
  }

  const trainingTypes = record.classification?.training_types;
  if (!isIdArray(trainingTypes)) {
    reject(REJECTION_REASONS.TRAINING_TYPES_INVALID);
  } else if (trainingTypes.length === 0) {
    reject(REJECTION_REASONS.TRAINING_TYPES_EMPTY);
  }

  const invalidPaths = OBJECTIVE_ARRAY_PATHS.filter(([group, field]) => !isIdArray(record[group]?.[field])).map(
    ([group, field]) => `${group}.${field}`,
  );
  if (invalidPaths.length > 0) {
    reject(REJECTION_REASONS.OBJECTIVE_METADATA_INVALID, { fields: invalidPaths });
  }

  if (equipmentIds) {
    const known = new Set(equipmentIds);
    const unknown = [
      ...(isIdArray(equipmentRequired) ? equipmentRequired : []),
      ...(isIdArray(record.setup?.equipment_optional) ? record.setup.equipment_optional : []),
    ].filter((id) => !known.has(id));
    if (unknown.length > 0) reject(REJECTION_REASONS.EQUIPMENT_ID_UNKNOWN, { ids: unknown });
  }
  if (trainingTypeIds && isIdArray(trainingTypes)) {
    const known = new Set(trainingTypeIds);
    const unknown = trainingTypes.filter((id) => !known.has(id));
    if (unknown.length > 0) reject(REJECTION_REASONS.TRAINING_TYPE_ID_UNKNOWN, { ids: unknown });
  }

  return { accepted: reasons.length === 0, reasons };
}

// Applies the policy to a whole catalog. Duplicate exercise_ids are
// rejected (all occurrences after the first) rather than silently merged.
export function filterPilotCatalog(records, taxonomy = {}) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const { accepted: ok, reasons } = evaluatePilotRecord(record, taxonomy);
    const id = typeof record?.exercise_id === 'string' ? record.exercise_id : null;
    if (ok && seen.has(id)) {
      rejected.push({ exerciseId: id, reasons: [{ code: REJECTION_REASONS.EXERCISE_ID_DUPLICATE, detail: null }] });
      continue;
    }
    if (ok) {
      seen.add(id);
      accepted.push(record);
    } else {
      rejected.push({ exerciseId: id, reasons });
    }
  }
  return { accepted, rejected };
}
