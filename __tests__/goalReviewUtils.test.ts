import { describe, expect, test } from '@jest/globals';

import {
  calculateGoalAnalytics,
  createGoalCompletionSnapshot,
  normalizeGoalCompletionReflection,
  resolveGoalCompletionSnapshot,
} from '../lib/goalReviewUtils';
import {
  localIso,
  makeGoal,
  makeGoalMilestone,
  makeTask,
} from './testFactories';

describe('goal review utilities', () => {
  test('normalizes optional reflection fields', () => {
    expect(
      normalizeGoalCompletionReflection({
        whatHelped: '  Weekly planning  ',
        hardestPart: '   ',
        learned: null,
        doDifferently: '  Start sooner  ',
      })
    ).toEqual({
      whatHelped: 'Weekly planning',
      hardestPart: null,
      learned: null,
      doDifferently: 'Start sooner',
    });
  });

  test('rejects reflection answers that are too long', () => {
    expect(() =>
      normalizeGoalCompletionReflection({
        learned: 'x'.repeat(1001),
      })
    ).toThrow('1000 characters or fewer');
  });

  test('calculates task, milestone, priority, and recent activity analytics', () => {
    const goal = makeGoal();
    const now = new Date(localIso(2026, 6, 30, 12));
    const tasks = [
      makeTask({
        goalId: goal.id,
        completed: true,
        priority: 2,
        completedAt: localIso(2026, 6, 29, 10),
      }),
      makeTask({
        goalId: goal.id,
        completed: true,
        priority: 0,
        completedAt: localIso(2026, 6, 27, 10),
      }),
      makeTask({ goalId: goal.id }),
    ];
    const milestones = [
      makeGoalMilestone({
        goalId: goal.id,
        completed: true,
        completedAt: localIso(2026, 6, 28, 10),
      }),
      makeGoalMilestone({ goalId: goal.id }),
    ];

    const analytics = calculateGoalAnalytics(
      goal,
      tasks,
      milestones,
      now
    );

    expect(analytics).toMatchObject({
      taskTotal: 3,
      taskCompleted: 2,
      taskRemaining: 1,
      taskProgress: 67,
      milestoneTotal: 2,
      milestoneCompleted: 1,
      milestoneRemaining: 1,
      highPriorityCompleted: 1,
      healthStatus: 'healthy',
      healthLabel: 'Healthy',
    });
    expect(analytics.healthReason).toContain('1 day ago');
    expect(analytics.lastActivityAt).toBe(localIso(2026, 6, 29, 10));
  });

  test('reports no activity and needs attention with clear reasons', () => {
    const goal = makeGoal();
    const now = new Date(localIso(2026, 6, 30, 12));

    const noActivity = calculateGoalAnalytics(goal, [], [], now);
    expect(noActivity.healthStatus).toBe('noActivity');
    expect(noActivity.healthReason).toContain('No linked task or milestone');

    const stale = calculateGoalAnalytics(
      goal,
      [
        makeTask({
          goalId: goal.id,
          completed: true,
          completedAt: localIso(2026, 6, 10, 10),
        }),
      ],
      [],
      now
    );

    expect(stale.healthStatus).toBe('needsAttention');
    expect(stale.healthReason).toContain('20 days');
  });

  test('creates and resolves completion snapshots independently from live data', () => {
    const goal = makeGoal({
      completionTaskTotal: 10,
      completionTaskCompleted: 9,
      completionMilestoneTotal: 4,
      completionMilestoneCompleted: 3,
      completionHighPriorityCompleted: 2,
    });
    const liveAnalytics = calculateGoalAnalytics(
      goal,
      [makeTask({ completed: true, completedAt: localIso(2026, 6, 30) })],
      [],
      new Date(localIso(2026, 6, 30))
    );

    expect(createGoalCompletionSnapshot(liveAnalytics)).toMatchObject({
      taskTotal: 1,
      taskCompleted: 1,
    });
    expect(resolveGoalCompletionSnapshot(goal, liveAnalytics)).toEqual({
      taskTotal: 10,
      taskCompleted: 9,
      milestoneTotal: 4,
      milestoneCompleted: 3,
      highPriorityCompleted: 2,
    });
  });
});
