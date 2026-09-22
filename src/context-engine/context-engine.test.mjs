import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainingContext, ContextValidationError } from './index.mjs';

const minimalInput = () => ({
  trainingGoal: 'strength',
  environment: 'gym',
  timeAvailableMinutes: 45,
  experienceLevel: 'intermediate',
  modalities: ['gym'],
});

test('1. minimal valid context is normalized with explicit defaults', () => {
  const context = buildTrainingContext(minimalInput());

  assert.deepEqual(context, {
    trainingGoal: 'strength',
    environment: 'gym',
    timeAvailableMinutes: 45,
    experienceLevel: 'intermediate',
    modalities: ['gym'],
    equipment: ['bodyweight'],
    restrictions: [],
    preferences: { dislikedEquipment: [], notes: null },
  });
});

test('2. full context normalizes every declared field', () => {
  const context = buildTrainingContext({
    trainingGoal: 'Fat Loss',
    environment: 'Home',
    timeAvailableMinutes: 30,
    experienceLevel: 'Beginner',
    modalities: ['gym', 'core'],
    equipment: ['Dumbbell', 'resistance-band'],
    restrictions: [
      {
        id: 'left-shoulder',
        description: 'Avoid overhead pressing on the left shoulder',
        region: 'shoulder',
        avoidTags: ['overhead_press'],
        severity: 'soft',
        source: 'professional_guidance',
      },
    ],
    preferences: { dislikedEquipment: ['Machine'], notes: '  prefers free weights  ' },
  });

  assert.deepEqual(context, {
    trainingGoal: 'fat_loss',
    environment: 'home',
    timeAvailableMinutes: 30,
    experienceLevel: 'beginner',
    modalities: ['gym', 'core'],
    equipment: ['dumbbell', 'resistance_band'],
    restrictions: [
      {
        id: 'left_shoulder',
        description: 'Avoid overhead pressing on the left shoulder',
        region: 'shoulder',
        avoidTags: ['overhead_press'],
        severity: 'soft',
        source: 'professional_guidance',
      },
    ],
    preferences: { dislikedEquipment: ['machine'], notes: 'prefers free weights' },
  });
});

test('3. duplicate equipment is normalized to a single entry', () => {
  const context = buildTrainingContext({
    ...minimalInput(),
    equipment: ['Dumbbell', 'dumbbell', ' DUMBBELL '],
  });

  assert.deepEqual(context.equipment, ['dumbbell']);
});

test('4. duplicate modalities are normalized to a single entry', () => {
  const context = buildTrainingContext({
    ...minimalInput(),
    modalities: ['gym', 'Gym', 'GYM'],
  });

  assert.deepEqual(context.modalities, ['gym']);
});

test('5. invalid time is rejected', () => {
  for (const timeAvailableMinutes of [0, -10, 500, 12.5]) {
    assert.throws(
      () => buildTrainingContext({ ...minimalInput(), timeAvailableMinutes }),
      ContextValidationError,
    );
  }
});

test('6. unknown experience level is rejected', () => {
  assert.throws(
    () => buildTrainingContext({ ...minimalInput(), experienceLevel: 'expert' }),
    ContextValidationError,
  );
});

test('7. unknown modality is rejected', () => {
  assert.throws(
    () => buildTrainingContext({ ...minimalInput(), modalities: ['yoga'] }),
    ContextValidationError,
  );
});

test('8. an active restriction is preserved in the output', () => {
  const context = buildTrainingContext({
    ...minimalInput(),
    restrictions: [{ description: 'Knee pain on deep flexion', region: 'knee' }],
  });

  assert.equal(context.restrictions.length, 1);
  assert.equal(context.restrictions[0].description, 'Knee pain on deep flexion');
  assert.equal(context.restrictions[0].region, 'knee');
  // Defaults applied to an explicitly declared restriction are not the same
  // as inventing one — see test 9 for the "no restrictions" case.
  assert.equal(context.restrictions[0].severity, 'hard');
  assert.equal(context.restrictions[0].source, 'user_declared');
});

test('9. no restriction is invented when none is declared', () => {
  const context = buildTrainingContext(minimalInput());

  assert.deepEqual(context.restrictions, []);
});

test('10. equivalent input produces deterministic output', () => {
  const first = buildTrainingContext({
    trainingGoal: 'Strength',
    environment: 'GYM',
    timeAvailableMinutes: 45,
    experienceLevel: 'Intermediate',
    modalities: ['Gym', 'gym'],
    equipment: ['Dumbbell', 'dumbbell'],
    restrictions: [{ description: 'Sore lower back' }],
  });

  const second = buildTrainingContext({
    trainingGoal: 'strength',
    environment: 'gym',
    timeAvailableMinutes: 45,
    experienceLevel: 'intermediate',
    modalities: ['gym'],
    equipment: ['dumbbell'],
    restrictions: [{ description: 'Sore lower back' }],
  });

  assert.deepEqual(first, second);
});

test('rejects structurally invalid input instead of guessing', () => {
  assert.throws(() => buildTrainingContext(null), ContextValidationError);
  assert.throws(() => buildTrainingContext({}), ContextValidationError);
  assert.throws(
    () => buildTrainingContext({ ...minimalInput(), timeAvailableMinutes: '45' }),
    ContextValidationError,
  );
});

test('the returned context is frozen (immutable)', () => {
  const context = buildTrainingContext(minimalInput());
  assert.throws(() => {
    context.trainingGoal = 'tampered';
  });
  assert.throws(() => {
    context.equipment.push('barbell');
  });
});
