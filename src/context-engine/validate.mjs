import {
  ENVIRONMENTS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  MODALITIES,
  RESTRICTION_SEVERITIES,
  RESTRICTION_SOURCES,
  TIME_AVAILABLE_MINUTES_MAX,
  TIME_AVAILABLE_MINUTES_MIN,
  TRAINING_GOALS,
} from './context-schema.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// Structural validation: is the shape of the raw input even well-formed
// enough to normalize? This never checks enum membership or ranges — that
// is validateSemantics' job, run after normalization/defaults.
export function validateStructure(input) {
  const issues = [];

  if (!isPlainObject(input)) {
    issues.push({ field: 'input', message: 'must be a plain object', code: 'invalid_type' });
    return issues;
  }

  for (const field of ['trainingGoal', 'environment', 'experienceLevel']) {
    if (input[field] === undefined) {
      issues.push({ field, message: 'is required', code: 'required_missing' });
    } else if (!isNonEmptyString(input[field])) {
      issues.push({ field, message: 'must be a non-empty string', code: 'invalid_type' });
    }
  }

  if (input.timeAvailableMinutes === undefined) {
    issues.push({
      field: 'timeAvailableMinutes',
      message: 'is required',
      code: 'required_missing',
    });
  } else if (typeof input.timeAvailableMinutes !== 'number' || !Number.isFinite(input.timeAvailableMinutes)) {
    issues.push({
      field: 'timeAvailableMinutes',
      message: 'must be a finite number',
      code: 'invalid_type',
    });
  }

  if (input.modalities === undefined) {
    issues.push({ field: 'modalities', message: 'is required', code: 'required_missing' });
  } else if (!isStringArray(input.modalities) || input.modalities.length === 0) {
    issues.push({
      field: 'modalities',
      message: 'must be a non-empty array of strings',
      code: 'invalid_type',
    });
  }

  if (input.equipment !== undefined && !isStringArray(input.equipment)) {
    issues.push({ field: 'equipment', message: 'must be an array of strings', code: 'invalid_type' });
  }

  if (input.restrictions !== undefined) {
    if (!Array.isArray(input.restrictions)) {
      issues.push({
        field: 'restrictions',
        message: 'must be an array',
        code: 'invalid_type',
      });
    } else {
      input.restrictions.forEach((restriction, index) => {
        const field = `restrictions[${index}]`;
        if (!isPlainObject(restriction)) {
          issues.push({ field, message: 'must be an object', code: 'invalid_type' });
          return;
        }
        if (!isNonEmptyString(restriction.description)) {
          issues.push({
            field: `${field}.description`,
            message: 'must be a non-empty string',
            code: 'invalid_type',
          });
        }
        if (restriction.id !== undefined && !isNonEmptyString(restriction.id)) {
          issues.push({ field: `${field}.id`, message: 'must be a non-empty string', code: 'invalid_type' });
        }
        if (restriction.region !== undefined && !isNonEmptyString(restriction.region)) {
          issues.push({
            field: `${field}.region`,
            message: 'must be a non-empty string',
            code: 'invalid_type',
          });
        }
        if (restriction.avoidTags !== undefined && !isStringArray(restriction.avoidTags)) {
          issues.push({
            field: `${field}.avoidTags`,
            message: 'must be an array of strings',
            code: 'invalid_type',
          });
        }
        if (restriction.severity !== undefined && !isNonEmptyString(restriction.severity)) {
          issues.push({
            field: `${field}.severity`,
            message: 'must be a non-empty string',
            code: 'invalid_type',
          });
        }
        if (restriction.source !== undefined && !isNonEmptyString(restriction.source)) {
          issues.push({
            field: `${field}.source`,
            message: 'must be a non-empty string',
            code: 'invalid_type',
          });
        }
      });
    }
  }

  if (input.preferences !== undefined) {
    if (!isPlainObject(input.preferences)) {
      issues.push({ field: 'preferences', message: 'must be an object', code: 'invalid_type' });
    } else {
      if (
        input.preferences.dislikedEquipment !== undefined &&
        !isStringArray(input.preferences.dislikedEquipment)
      ) {
        issues.push({
          field: 'preferences.dislikedEquipment',
          message: 'must be an array of strings',
          code: 'invalid_type',
        });
      }
      if (
        input.preferences.notes !== undefined &&
        input.preferences.notes !== null &&
        typeof input.preferences.notes !== 'string'
      ) {
        issues.push({
          field: 'preferences.notes',
          message: 'must be a string or null',
          code: 'invalid_type',
        });
      }
    }
  }

  return issues;
}

// Semantic validation: run after normalization/defaults, on already
// token-normalized values. Checks enum membership and numeric ranges only.
export function validateSemantics(context) {
  const issues = [];

  if (!TRAINING_GOALS.includes(context.trainingGoal)) {
    issues.push({
      field: 'trainingGoal',
      message: `must be one of: ${TRAINING_GOALS.join(', ')}`,
      code: 'unknown_value',
    });
  }

  if (!ENVIRONMENTS.includes(context.environment)) {
    issues.push({
      field: 'environment',
      message: `must be one of: ${ENVIRONMENTS.join(', ')}`,
      code: 'unknown_value',
    });
  }

  if (!EXPERIENCE_LEVELS.includes(context.experienceLevel)) {
    issues.push({
      field: 'experienceLevel',
      message: `must be one of: ${EXPERIENCE_LEVELS.join(', ')}`,
      code: 'unknown_value',
    });
  }

  if (
    !Number.isInteger(context.timeAvailableMinutes) ||
    context.timeAvailableMinutes < TIME_AVAILABLE_MINUTES_MIN ||
    context.timeAvailableMinutes > TIME_AVAILABLE_MINUTES_MAX
  ) {
    issues.push({
      field: 'timeAvailableMinutes',
      message: `must be an integer between ${TIME_AVAILABLE_MINUTES_MIN} and ${TIME_AVAILABLE_MINUTES_MAX}`,
      code: 'out_of_range',
    });
  }

  if (context.modalities.length === 0) {
    issues.push({
      field: 'modalities',
      message: 'must contain at least one modality',
      code: 'invalid_value',
    });
  }
  context.modalities.forEach((modality, index) => {
    if (!MODALITIES.includes(modality)) {
      issues.push({
        field: `modalities[${index}]`,
        message: `must be one of: ${MODALITIES.join(', ')}`,
        code: 'unknown_value',
      });
    }
  });

  context.equipment.forEach((item, index) => {
    if (!EQUIPMENT.includes(item)) {
      issues.push({
        field: `equipment[${index}]`,
        message: `must be one of: ${EQUIPMENT.join(', ')}`,
        code: 'unknown_value',
      });
    }
  });

  context.restrictions.forEach((restriction, index) => {
    if (!RESTRICTION_SEVERITIES.includes(restriction.severity)) {
      issues.push({
        field: `restrictions[${index}].severity`,
        message: `must be one of: ${RESTRICTION_SEVERITIES.join(', ')}`,
        code: 'unknown_value',
      });
    }
    if (!RESTRICTION_SOURCES.includes(restriction.source)) {
      issues.push({
        field: `restrictions[${index}].source`,
        message: `must be one of: ${RESTRICTION_SOURCES.join(', ')}`,
        code: 'unknown_value',
      });
    }
  });

  context.preferences.dislikedEquipment.forEach((item, index) => {
    if (!EQUIPMENT.includes(item)) {
      issues.push({
        field: `preferences.dislikedEquipment[${index}]`,
        message: `must be one of: ${EQUIPMENT.join(', ')}`,
        code: 'unknown_value',
      });
    }
  });

  return issues;
}
