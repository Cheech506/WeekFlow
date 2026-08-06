import {
  brainDumpMatchesHistoryFilters,
  createDefaultHistoryFilters,
  getTaskHistoryCycleId,
  goalMatchesHistoryFilters,
  resolveHistoryDateRange,
  taskMatchesHistoryFilters,
} from '@/lib/historyFilters';
import {
  makeBrainDump,
  makeGoal,
  makePlanningCycle,
  makeTask,
  resetFactoryIds,
} from './testFactories';

describe('history filters', () => {
  beforeEach(() => resetFactoryIds());

  const firstCycle = makePlanningCycle({
    id: 1,
    name: 'Summer Cycle',
    startDate: '2026-06-01',
    endDate: '2026-08-23',
    active: false,
  });
  const secondCycle = makePlanningCycle({
    id: 2,
    name: 'Fall Cycle',
    startDate: '2026-09-01',
    endDate: '2026-11-23',
    active: false,
  });

  test('resolves preset and custom date ranges', () => {
    expect(
      resolveHistoryDateRange(
        {
          datePreset: '7days',
          customStartDate: '',
          customEndDate: '',
        },
        new Date(2026, 7, 6, 12)
      )
    ).toEqual({
      startDateKey: '2026-07-31',
      endDateKey: '2026-08-06',
      error: null,
    });

    expect(
      resolveHistoryDateRange({
        datePreset: 'custom',
        customStartDate: '2026-08-10',
        customEndDate: '2026-08-01',
      }).error
    ).toContain('cannot be after');
  });

  test('uses a linked goal cycle before falling back to completion date', () => {
    const linkedGoal = makeGoal({ id: 7, cycleId: 2 });
    const goalsById = new Map([[linkedGoal.id, linkedGoal]]);

    expect(
      getTaskHistoryCycleId(
        makeTask({
          goalId: 7,
          completed: true,
          completedAt: new Date(2026, 6, 5, 12).toISOString(),
        }),
        goalsById,
        [secondCycle, firstCycle]
      )
    ).toBe(2);

    expect(
      getTaskHistoryCycleId(
        makeTask({
          goalId: null,
          completed: true,
          completedAt: new Date(2026, 6, 5, 12).toISOString(),
        }),
        goalsById,
        [secondCycle, firstCycle]
      )
    ).toBe(1);
  });

  test('filters completed tasks by recurrence, goal, cycle, priority, search, and date', () => {
    const goal = makeGoal({ id: 7, title: 'Database Portfolio', cycleId: 1 });
    const task = makeTask({
      id: 10,
      title: 'Test MySQL restore',
      notes: 'Document the recovery steps',
      priority: 2,
      goalId: 7,
      recurringRuleId: 4,
      completed: true,
      completedAt: new Date(2026, 7, 4, 12).toISOString(),
    });
    const filters = {
      ...createDefaultHistoryFilters(),
      searchText: 'recovery',
      content: 'tasks' as const,
      priority: 2 as const,
      goal: 7 as const,
      recurrence: 'recurring' as const,
      cycle: 1 as const,
      datePreset: '7days' as const,
    };

    expect(
      taskMatchesHistoryFilters({
        task,
        filters,
        goalsById: new Map([[goal.id, goal]]),
        cycles: [firstCycle],
        range: resolveHistoryDateRange(filters, new Date(2026, 7, 6, 12)),
      })
    ).toBe(true);
  });

  test('searches completed goal planning and reflection text while respecting cycle filters', () => {
    const goal = makeGoal({
      id: 3,
      cycleId: 1,
      completed: true,
      completedAt: new Date(2026, 7, 2, 12).toISOString(),
      completionLearned: 'Backups need restore verification',
    });
    const filters = {
      ...createDefaultHistoryFilters(),
      content: 'goals' as const,
      searchText: 'restore verification',
      cycle: 1 as const,
    };

    expect(
      goalMatchesHistoryFilters({
        goal,
        milestonesText: 'Create backup runbook',
        filters,
        range: resolveHistoryDateRange(filters),
      })
    ).toBe(true);
  });

  test('keeps brain dumps separate from cycle-specific results', () => {
    const brainDump = makeBrainDump({
      archived: true,
      archivedAt: new Date(2026, 7, 2, 12).toISOString(),
      body: 'Research PostgreSQL indexes',
    });
    const filters = {
      ...createDefaultHistoryFilters(),
      cycle: 1 as const,
    };

    expect(
      brainDumpMatchesHistoryFilters({
        brainDump,
        filters,
        range: resolveHistoryDateRange(filters),
      })
    ).toBe(false);
  });
});
