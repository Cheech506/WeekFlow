import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('goal and brain dump storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('creates, edits, completes, reopens, and deletes a goal', async () => {
    const goalStorage = await import('../../lib/goalStorage');

    const goal = await goalStorage.insertGoal(
      '  Integration goal  ',
      '2026-07-01',
      '2026-09-23'
    );

    expect(goal.title).toBe('Integration goal');

    const editedDates = await goalStorage.updateGoalDates(
      goal.id,
      '2026-07-08',
      '2026-10-07'
    );

    let goals = await goalStorage.getGoals();

    expect(goals[0].startDate).toBe(editedDates.startDate);
    expect(goals[0].endDate).toBe(editedDates.endDate);

    const completedAt =
      await goalStorage.updateGoalCompletion(
        goal.id,
        true
      );

    goals = await goalStorage.getGoals();

    expect(goals[0].completed).toBe(true);
    expect(goals[0].completedAt).toBe(completedAt);

    await goalStorage.updateGoalCompletion(goal.id, false);
    goals = await goalStorage.getGoals();

    expect(goals[0].completed).toBe(false);
    expect(goals[0].completedAt).toBeNull();

    await goalStorage.deleteGoalById(goal.id);
    goals = await goalStorage.getGoals();

    expect(goals).toEqual([]);
  });

  test('creates, archives, restores, and deletes a brain dump', async () => {
    const brainStorage = await import(
      '../../lib/brainDumpStorage'
    );

    const note = await brainStorage.insertBrainDump(
      '  Remember this  '
    );

    expect(note.body).toBe('Remember this');

    await brainStorage.archiveBrainDumpById(note.id);

    let notes = await brainStorage.getBrainDumps();

    expect(notes[0].archived).toBe(true);
    expect(notes[0].archivedAt).not.toBeNull();

    await brainStorage.restoreBrainDumpById(note.id);
    notes = await brainStorage.getBrainDumps();

    expect(notes[0].archived).toBe(false);
    expect(notes[0].archivedAt).toBeNull();

    await brainStorage.deleteBrainDumpById(note.id);
    notes = await brainStorage.getBrainDumps();

    expect(notes).toEqual([]);
  });
});
