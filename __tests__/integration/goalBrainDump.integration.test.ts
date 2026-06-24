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

  test('creates, completes, and deletes a goal', async () => {
    const goalStorage = await import('../../lib/goalStorage');

    const goal = await goalStorage.insertGoal(
      '  Integration goal  '
    );

    expect(goal.title).toBe('Integration goal');

    const completedAt =
      await goalStorage.updateGoalCompletion(
        goal.id,
        true
      );

    let goals = await goalStorage.getGoals();

    expect(goals[0].completed).toBe(true);
    expect(goals[0].completedAt).toBe(completedAt);

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
