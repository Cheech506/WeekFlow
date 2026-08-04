import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('planning cycle storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('starts and edits the current named twelve-week cycle', async () => {
    const storage = await import('../../lib/cycleStorage');

    const cycle = await storage.startPlanningCycle(
      '2026-07-01',
      {
        name: 'Summer 2026',
        primaryFocus: 'Finish WeekFlow local v1.0',
        theme: 'Build the foundation',
      }
    );

    expect(cycle).toMatchObject({
      name: 'Summer 2026',
      primaryFocus: 'Finish WeekFlow local v1.0',
      theme: 'Build the foundation',
      startDate: '2026-07-01',
      endDate: '2026-09-22',
      active: true,
    });

    const updated = await storage.updatePlanningCycle(
      cycle.id,
      '2026-07-06',
      {
        name: 'DBA Preparation',
        primaryFocus: 'Prepare for a database administrator role',
        theme: 'Finish what matters',
      }
    );

    expect(updated).toMatchObject({
      name: 'DBA Preparation',
      primaryFocus: 'Prepare for a database administrator role',
      theme: 'Finish what matters',
      startDate: '2026-07-06',
      endDate: '2026-09-27',
      active: true,
    });
  });

  test('starting a new cycle preserves the previous cycle as a historical folder', async () => {
    const storage = await import('../../lib/cycleStorage');

    const first = await storage.startPlanningCycle(
      '2026-07-01',
      { name: 'Summer 2026' }
    );
    const second = await storage.startPlanningCycle(
      '2026-09-23',
      { name: 'Fall 2026' }
    );

    const cycles = await storage.getPlanningCycles();

    expect(cycles).toHaveLength(2);
    expect(cycles.filter((cycle) => cycle.active)).toHaveLength(1);
    expect(cycles.find((cycle) => cycle.id === first.id)).toMatchObject({
      name: 'Summer 2026',
      active: false,
    });
    expect(cycles.find((cycle) => cycle.id === second.id)).toMatchObject({
      name: 'Fall 2026',
      active: true,
    });
  });

  test('assigns existing active goals when the first cycle is created', async () => {
    const goalStorage = await import('../../lib/goalStorage');
    const cycleStorage = await import('../../lib/cycleStorage');

    const goal = await goalStorage.insertGoal(
      'Existing goal',
      '2027-01-15',
      '2027-04-09'
    );

    expect(goal.cycleId).toBeNull();

    const cycle = await cycleStorage.startPlanningCycle(
      '2026-07-01',
      { name: 'First Cycle' }
    );

    const storedGoal = (await goalStorage.getGoals()).find(
      (item) => item.id === goal.id
    );

    expect(storedGoal?.cycleId).toBe(cycle.id);
  });

  test('stores newly created goals inside the selected cycle folder', async () => {
    const cycleStorage = await import('../../lib/cycleStorage');
    const goalStorage = await import('../../lib/goalStorage');

    const cycle = await cycleStorage.startPlanningCycle(
      '2026-07-01',
      { name: 'Summer 2026' }
    );

    const goal = await goalStorage.insertGoal(
      'Finish WeekFlow',
      '2026-07-01',
      '2026-09-22',
      null,
      {},
      cycle.id
    );

    expect(goal.cycleId).toBe(cycle.id);
    expect((await goalStorage.getGoals())[0].cycleId).toBe(cycle.id);

    await expect(
      goalStorage.insertGoal(
        'Broken folder goal',
        '2026-07-01',
        '2026-09-22',
        null,
        {},
        999
      )
    ).rejects.toThrow('Goal cycle does not exist.');
  });

  test('does not allow a historical cycle to be edited', async () => {
    const storage = await import('../../lib/cycleStorage');

    const first = await storage.startPlanningCycle(
      '2026-07-01',
      { name: 'Summer 2026' }
    );
    await storage.startPlanningCycle('2026-09-23', {
      name: 'Fall 2026',
    });

    await expect(
      storage.updatePlanningCycle(first.id, '2026-07-02', {
        name: 'Changed',
      })
    ).rejects.toThrow('current planning cycle');
  });
});
