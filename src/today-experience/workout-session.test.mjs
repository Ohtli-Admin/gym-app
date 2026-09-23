import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionFromPlan,
  logSet,
  completeExercise,
  goToExercise,
  finishSession,
  buildSessionSummary,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
} from './workout-session.mjs';

const fakePlan = () => ({
  planId: 'plan-test',
  exercises: [
    {
      exerciseId: 'ex-1',
      name: 'Sentadilla',
      modality: 'gym',
      status: 'compatible',
      reasons: [],
      prescription: { type: 'sets_reps', sets: 3, reps: 10 },
      estimatedDurationMinutes: 6,
    },
    {
      exerciseId: 'ex-2',
      name: 'Plancha',
      modality: 'core',
      status: 'compatible',
      reasons: [],
      prescription: { type: 'duration', durationMinutes: 4 },
      estimatedDurationMinutes: 4,
    },
  ],
});

test('createSessionFromPlan builds one entry per plan exercise, unstarted', () => {
  const session = createSessionFromPlan(fakePlan());
  assert.equal(session.exercises.length, 2);
  assert.equal(session.currentIndex, 0);
  assert.equal(session.finishedAt, null);
  assert.deepEqual(session.exercises[0].sets, []);
  assert.equal(session.exercises[0].completed, false);
});

test('logSet appends a numbered set to the given exercise only', () => {
  const session = createSessionFromPlan(fakePlan());
  logSet(session, 0, { reps: 10, weight: 20 });
  logSet(session, 0, { reps: 8, weight: 20 });

  assert.equal(session.exercises[0].sets.length, 2);
  assert.equal(session.exercises[0].sets[1].setNumber, 2);
  assert.equal(session.exercises[1].sets.length, 0);
});

test('completeExercise and goToExercise update exactly the targeted exercise/index', () => {
  const session = createSessionFromPlan(fakePlan());
  completeExercise(session, 0);
  goToExercise(session, 1);

  assert.equal(session.exercises[0].completed, true);
  assert.equal(session.exercises[1].completed, false);
  assert.equal(session.currentIndex, 1);
});

test('goToExercise ignores an out-of-range index', () => {
  const session = createSessionFromPlan(fakePlan());
  goToExercise(session, 99);
  assert.equal(session.currentIndex, 0);
  goToExercise(session, -1);
  assert.equal(session.currentIndex, 0);
});

test('buildSessionSummary reflects partial vs full completion', () => {
  const session = createSessionFromPlan(fakePlan());
  logSet(session, 0, { reps: 10 });
  completeExercise(session, 0);

  const partial = buildSessionSummary(session);
  assert.equal(partial.completedExercises, 1);
  assert.equal(partial.totalExercises, 2);
  assert.equal(partial.totalSets, 1);
  assert.equal(partial.isFullyCompleted, false);
  assert.equal(partial.durationMinutes, null); // not finished yet

  completeExercise(session, 1);
  finishSession(session);
  const full = buildSessionSummary(session);
  assert.equal(full.isFullyCompleted, true);
  assert.equal(typeof full.durationMinutes, 'number');
});

test('the active-session store round-trips and clears', () => {
  clearActiveSession();
  assert.equal(getActiveSession(), null);

  const session = createSessionFromPlan(fakePlan());
  setActiveSession(session);
  assert.deepEqual(getActiveSession(), session);

  clearActiveSession();
  assert.equal(getActiveSession(), null);
});
