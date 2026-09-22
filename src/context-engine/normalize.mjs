import {
  DEFAULT_RESTRICTION_SEVERITY,
  DEFAULT_RESTRICTION_SOURCE,
} from './context-schema.mjs';

// Lowercases, trims, and unifies separators so 'Fat Loss', 'fat-loss' and
// 'fat_loss' all normalize to the same token before enum validation.
// Assumes `value` is already known to be a string (structural validation
// runs before normalization).
export function normalizeToken(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

// Normalizes each value and removes duplicates, keeping first-seen order.
export function normalizeTokenArray(values) {
  const seen = new Set();
  const result = [];
  for (const rawValue of values) {
    const token = normalizeToken(rawValue);
    if (token !== '' && !seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

function slugify(value) {
  return normalizeToken(value)
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Preserves a user-declared restriction as-is; only normalizes casing/
// whitespace and fills an id/severity/source when the caller omitted them.
// Never infers that the restriction is resolved, and never invents a
// restriction that wasn't declared.
export function normalizeRestriction(raw) {
  const description = raw.description.trim();
  return {
    id: raw.id !== undefined ? slugify(raw.id) : slugify(description),
    description,
    region: raw.region !== undefined ? normalizeToken(raw.region) : null,
    avoidTags: raw.avoidTags !== undefined ? normalizeTokenArray(raw.avoidTags) : [],
    severity:
      raw.severity !== undefined ? normalizeToken(raw.severity) : DEFAULT_RESTRICTION_SEVERITY,
    source: raw.source !== undefined ? normalizeToken(raw.source) : DEFAULT_RESTRICTION_SOURCE,
  };
}

// Deduplicates by normalized id, keeping the first occurrence — makes
// buildTrainingContext deterministic for equivalent-but-repeated input.
export function dedupeRestrictions(restrictions) {
  const seen = new Set();
  const result = [];
  for (const restriction of restrictions) {
    if (!seen.has(restriction.id)) {
      seen.add(restriction.id);
      result.push(restriction);
    }
  }
  return result;
}

export function normalizePreferences(raw) {
  return {
    dislikedEquipment:
      raw.dislikedEquipment !== undefined ? normalizeTokenArray(raw.dislikedEquipment) : [],
    notes: raw.notes !== undefined && raw.notes !== null ? String(raw.notes).trim() : null,
  };
}

export function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}
