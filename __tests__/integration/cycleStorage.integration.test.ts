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

  test('starts and edits the current twelve-week cycle', async () => {
    const storage = await import('../../lib/cycleStorage');

    const cycle = await storage.startPlanningCycle(
      '2026-07-01'
    );

    expect(cycle).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-09-22',
      active: true,
    });

    const updated =
      await storage.updatePlanningCycleStartDate(
        cycle.id,
        '2026-07-06'
      );

    expect(updated).toMatchObject({
      startDate: '2026-07-06',
      endDate: '2026-09-27',
      active: true,
    });
  });

  test('starting a new cycle preserves and closes the previous cycle', async () => {
    const storage = await import('../../lib/cycleStorage');

    const first = await storage.startPlanningCycle(
      '2026-07-01'
    );
    const second = await storage.startPlanningCycle(
      '2026-09-23'
    );

    const cycles = await storage.getPlanningCycles();

    expect(cycles).toHaveLength(2);
    expect(
      cycles.filter((cycle) => cycle.active)
    ).toHaveLength(1);
    expect(
      cycles.find((cycle) => cycle.id === first.id)
    ).toMatchObject({
      active: false,
    });
    expect(
      cycles.find((cycle) => cycle.id === second.id)
    ).toMatchObject({
      active: true,
    });
  });

  test('does not allow a historical cycle to be edited', async () => {
    const storage = await import('../../lib/cycleStorage');

    const first = await storage.startPlanningCycle(
      '2026-07-01'
    );
    await storage.startPlanningCycle('2026-09-23');

    await expect(
      storage.updatePlanningCycleStartDate(
        first.id,
        '2026-07-02'
      )
    ).rejects.toThrow('current planning cycle');
  });
});
