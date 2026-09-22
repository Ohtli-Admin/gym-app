// Controlled vocabularies and structural constants for Context Engine v0.1.
// These are GymApp-side enums (context/session facts), not a restatement of
// Gym-Exercise-Library's canonical taxonomy.

export const TRAINING_GOALS = Object.freeze([
  'strength',
  'hypertrophy',
  'endurance',
  'fat_loss',
  'general_fitness',
  'mobility_recovery',
]);

export const ENVIRONMENTS = Object.freeze(['gym', 'home', 'outdoor', 'travel']);

// 'bodyweight' is an explicit statement of "no equipment", not an omission —
// see DEFAULT_EQUIPMENT below and REENGINEERING_DECISION_FRAME.md's note on
// replacing the legacy "assume all equipment" behavior.
export const EQUIPMENT = Object.freeze([
  'bodyweight',
  'dumbbell',
  'barbell',
  'kettlebell',
  'resistance_band',
  'pull_up_bar',
  'bench',
  'machine',
  'cardio_machine',
  'bike',
]);

export const EXPERIENCE_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);

// Training modalities/domains (not exercises). Extend this list as future
// modalities are supported.
export const MODALITIES = Object.freeze(['gym', 'calisthenics', 'cardio', 'core']);

// A restriction's severity is a user/context instruction, not a medical
// diagnosis (see AGENTS.md, "Safety and AI-generation boundaries").
export const RESTRICTION_SEVERITIES = Object.freeze(['soft', 'hard']);

export const RESTRICTION_SOURCES = Object.freeze([
  'user_declared',
  'professional_guidance',
  'rehabilitation_instruction',
]);

export const TIME_AVAILABLE_MINUTES_MIN = 5;
export const TIME_AVAILABLE_MINUTES_MAX = 240;

export const DEFAULT_EQUIPMENT = Object.freeze(['bodyweight']);
export const DEFAULT_RESTRICTION_SEVERITY = 'hard';
export const DEFAULT_RESTRICTION_SOURCE = 'user_declared';
