import { describe, expect, test } from '@jest/globals';

import {
  buildCycleReportMarkdown,
  calculateCycleReviewSnapshot,
  getDefaultNextCycleStartDate,
  getFirstWeekStartDate,
  normalizeCycleReviewReflection,
  normalizeFirstWeekCommitments,
  normalizeReplacementGoalTitle,
} from '../lib/cycleReviewUtils';
import {
  localIso,
  makeBrainDump,
  makeGoal,
  makeGoalMilestone,
  makePlanningCycle,
  makeTask,
  makeWeeklyReview,
} from './testFactories';

describe('cycle review utilities', () => {
  test('normalizes reflection, replacement titles, and first-week commitments', () => {
    expect(
      normalizeCycleReviewReflection({
        biggestAccomplishment: '  Finished the local app  ',
        biggestChallenge: '   ',
      })
    ).toMatchObject({
      biggestAccomplishment: 'Finished the local app',
      biggestChallenge: null,
    });

    expect(normalizeReplacementGoalTitle('  New goal  ')).toBe('New goal');
    expect(
      normalizeFirstWeekCommitments([
        '  Finish the setup  ',
        '',
        'Review the plan',
      ])
    ).toEqual(['Finish the setup', 'Review the plan']);

    expect(() =>
      normalizeFirstWeekCommitments(['Duplicate', ' duplicate '])
    ).toThrow('unique');
  });

  test('calculates stable cycle results from goal, task, milestone, review, and Brain Dump data', () => {
    const cycle = makePlanningCycle({
      id: 10,
      startDate: '2026-07-01',
      endDate: '2026-09-22',
    });
    const goals = [
      makeGoal({ id: 1, cycleId: 10, completed: true, reward: 'Game' }),
      makeGoal({ id: 2, cycleId: 10, completed: false }),
      makeGoal({ id: 3, cycleId: 999, completed: true }),
    ];
    const milestones = [
      makeGoalMilestone({ id: 11, goalId: 1, completed: true }),
      makeGoalMilestone({ id: 12, goalId: 2, completed: false }),
      makeGoalMilestone({ id: 13, goalId: 3, completed: true }),
    ];
    const tasks = [
      makeTask({
        id: 20,
        completed: true,
        completedAt: localIso(2026, 7, 6),
        priority: 2,
      }),
      makeTask({
        id: 21,
        completed: true,
        completedAt: localIso(2026, 7, 7),
        recurringRuleId: 5,
        recurrenceOccurrenceDate: '2026-07-07',
      }),
      makeTask({
        id: 22,
        completed: true,
        completedAt: localIso(2026, 7, 8),
      }),
      makeTask({
        id: 23,
        completed: true,
        completedAt: localIso(2026, 7, 15),
      }),
      makeTask({
        id: 24,
        completed: true,
        completedAt: localIso(2026, 10, 1),
      }),
    ];
    const weeklyReviews = [
      makeWeeklyReview({ id: 30, cycleId: 10, weekStart: '2026-07-06' }),
      makeWeeklyReview({ id: 31, cycleId: 999, weekStart: '2026-07-06' }),
    ];
    const brainDumps = [
      makeBrainDump({
        id: 40,
        archived: true,
        archivedAt: localIso(2026, 8, 1),
      }),
      makeBrainDump({
        id: 41,
        archived: true,
        archivedAt: localIso(2026, 10, 1),
      }),
    ];

    expect(
      calculateCycleReviewSnapshot(
        cycle,
        goals,
        milestones,
        tasks,
        weeklyReviews,
        brainDumps
      )
    ).toEqual({
      goalTotal: 2,
      goalCompleted: 1,
      taskCompleted: 4,
      milestoneTotal: 2,
      milestoneCompleted: 1,
      weeklyReviewsCompleted: 1,
      longestStreak: 3,
      bestWeekNumber: 1,
      bestWeekCount: 2,
      bestDay: 'Wednesday',
      bestDayCount: 2,
      highPriorityCompleted: 1,
      recurringCompleted: 1,
      rewardsUnlocked: 1,
      brainDumpsArchived: 1,
    });
  });

  test('reserves a full Week 13 before the default next cycle and finds its Monday', () => {
    const cycle = makePlanningCycle({ endDate: '2026-09-22' });

    expect(getDefaultNextCycleStartDate(cycle)).toBe('2026-09-30');
    expect(getFirstWeekStartDate('2026-09-30')).toBe('2026-09-28');
  });

  test('builds a Markdown report with results, outcomes, reflections, and next-cycle planning', () => {
    const cycle = makePlanningCycle({ id: 10, name: 'Summer 2026' });
    const markdown = buildCycleReportMarkdown({
      cycle,
      cycleLabel: 'Summer 2026',
      review: {
        reflection: normalizeCycleReviewReflection({
          biggestAccomplishment: 'Finished WeekFlow local v1.0',
        }),
        snapshot: {
          goalTotal: 2,
          goalCompleted: 1,
          taskCompleted: 30,
          milestoneTotal: 4,
          milestoneCompleted: 3,
          weeklyReviewsCompleted: 10,
          longestStreak: 8,
          bestWeekNumber: 7,
          bestWeekCount: 6,
          bestDay: 'Tuesday',
          bestDayCount: 7,
          highPriorityCompleted: 5,
          recurringCompleted: 4,
          rewardsUnlocked: 1,
          brainDumpsArchived: 3,
        },
        finalizedAt: localIso(2026, 9, 23),
        nextCycleName: 'Fall 2026',
        nextCyclePrimaryFocus: 'Prepare for the capstone',
        nextCycleTheme: 'Finish strong',
        nextCycleStartDate: '2026-10-01',
        firstWeekCommitments: ['Set up the first week'],
      },
      goals: [
        makeGoal({ id: 1, cycleId: 10, title: 'Finished goal', completed: true }),
        makeGoal({ id: 2, cycleId: 10, title: 'Carry goal' }),
      ],
      outcomes: [
        { goalId: 2, action: 'carryForward', replacementTitle: null },
      ],
      weeklyReviews: [
        makeWeeklyReview({ cycleId: 10, weekStart: '2026-07-06' }),
      ],
    });

    expect(markdown).toContain('# Summer 2026 — Cycle Report');
    expect(markdown).toContain('**Carry goal:** Carried Forward');
    expect(markdown).toContain('Finished WeekFlow local v1.0');
    expect(markdown).toContain('## Next Cycle Plan');
    expect(markdown).toContain('Set up the first week');
    expect(markdown).toContain('## Weekly Review Summaries');
  });
});
