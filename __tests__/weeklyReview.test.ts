import {
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  applyWeeklyReviewSnapshot,
  calculateWeeklyReview,
  createWeeklyReviewSnapshot,
} from '../lib/weeklyReview';
import {
  localIso,
  makeBrainDump,
  makeGoal,
  makeTask,
  resetFactoryIds,
} from './testFactories';

describe('calculateWeeklyReview', () => {
  beforeEach(() => {
    resetFactoryIds();
  });

  test('summarizes the current week', () => {
    const goalOne = makeGoal({ id: 1 });
    const goalTwo = makeGoal({ id: 2 });

    const tasks = [
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 22, 10),
        goalId: 1,
        priority: 2,
        recurringRuleId: 9,
        recurrenceOccurrenceDate: '2026-06-22',
      }),
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 24, 9),
        goalId: 1,
      }),
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 24, 15),
        goalId: 2,
      }),
      makeTask({
        day: 'Tuesday',
        dueDate: '2026-06-23',
        goalId: 1,
      }),
      makeTask({
        day: 'Friday',
        dueDate: '2026-06-26',
        goalId: 2,
      }),
    ];

    const brainDumps = [
      makeBrainDump({
        archived: true,
        archivedAt: localIso(2026, 6, 23),
      }),
    ];

    const review = calculateWeeklyReview(
      tasks,
      [goalOne, goalTwo],
      brainDumps,
      new Date(2026, 5, 24, 18),
      0
    );

    expect(review.status).toBe('current');
    expect(review.title).toBe('Week So Far');
    expect(review.completedCount).toBe(3);
    expect(review.unfinishedCount).toBe(2);
    expect(review.overdueCount).toBe(1);
    expect(review.completionRate).toBe(60);
    expect(review.goalsProgressedCount).toBe(2);
    expect(review.bestDay).toBe('Wednesday');
    expect(review.bestDayCount).toBe(2);
    expect(review.archivedBrainDumpCount).toBe(1);
    expect(review.highPriorityCompletedCount).toBe(1);
    expect(review.recurringCompletedCount).toBe(1);
  });

  test('summarizes a previous week', () => {
    const review = calculateWeeklyReview(
      [
        makeTask({
          completed: true,
          completedAt: localIso(2026, 6, 16),
        }),
        makeTask({
          day: 'Wednesday',
          dueDate: '2026-06-17',
        }),
      ],
      [],
      [],
      new Date(2026, 5, 24, 12),
      -1
    );

    expect(review.status).toBe('past');
    expect(review.title).toBe('Weekly Review');
    expect(review.completedCount).toBe(1);
    expect(review.unfinishedCount).toBe(1);
    expect(review.overdueCount).toBe(1);
    expect(review.completionRate).toBe(50);
  });

  test('rebuilds a saved review from its historical snapshot', () => {
    const liveReview = calculateWeeklyReview(
      [
        makeTask({
          completed: true,
          completedAt: localIso(2026, 6, 24),
        }),
      ],
      [],
      [],
      new Date(2026, 5, 24, 12),
      0
    );

    const snapshot = createWeeklyReviewSnapshot(liveReview);
    const changedReview = calculateWeeklyReview(
      [],
      [],
      [],
      new Date(2026, 5, 24, 12),
      0
    );
    const savedReview = applyWeeklyReviewSnapshot(
      changedReview,
      snapshot
    );

    expect(savedReview.title).toBe('Saved Weekly Review');
    expect(savedReview.completedCount).toBe(1);
    expect(savedReview.completionRate).toBe(100);
  });

  test('builds a future weekly preview', () => {
    const goalOne = makeGoal({ id: 1 });
    const goalTwo = makeGoal({ id: 2 });

    const review = calculateWeeklyReview(
      [
        makeTask({
          day: 'Monday',
          dueDate: '2026-06-29',
          goalId: 1,
        }),
        makeTask({
          day: 'Wednesday',
          dueDate: '2026-07-01',
          goalId: 2,
        }),
      ],
      [goalOne, goalTwo],
      [],
      new Date(2026, 5, 24, 12),
      1
    );

    expect(review.status).toBe('future');
    expect(review.title).toBe('Weekly Preview');
    expect(review.completedCount).toBe(0);
    expect(review.unfinishedCount).toBe(2);
    expect(review.scheduledGoalCount).toBe(2);
    expect(review.collapsedSummary).toBe(
      '2 tasks scheduled'
    );
  });
});
