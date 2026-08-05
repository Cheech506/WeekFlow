import { calculateGoalDashboardSnapshot } from '../lib/dashboardUtils';
import {
  localIso,
  makeGoal,
  makeGoalMilestone,
  makeTask,
  makeWeeklyCommitment,
  resetFactoryIds,
} from './testFactories';

describe('goal dashboard utilities', () => {
  beforeEach(() => {
    resetFactoryIds();
  });

  test('builds today, commitment, streak, and goal-health summaries', () => {
    const now = new Date(localIso(2026, 8, 5, 12));
    const attentionGoal = makeGoal({
      id: 10,
      cycleId: 4,
      title: 'Database portfolio',
    });
    const healthyGoal = makeGoal({
      id: 11,
      cycleId: 4,
      title: 'Finish WeekFlow',
    });
    const taskForCommitment = makeTask({
      id: 20,
      title: 'Live linked title',
      dueDate: '2026-08-05',
      goalId: healthyGoal.id,
      completed: false,
    });
    const tasks = [
      makeTask({
        id: 21,
        title: 'Completed today',
        dueDate: '2026-08-05',
        goalId: healthyGoal.id,
        completed: true,
        completedAt: localIso(2026, 8, 5, 9),
      }),
      taskForCommitment,
      makeTask({
        id: 22,
        title: 'Overdue task',
        dueDate: '2026-08-04',
      }),
      makeTask({
        id: 23,
        title: 'Previous streak day',
        completed: true,
        completedAt: localIso(2026, 8, 4, 9),
      }),
      makeTask({
        id: 24,
        title: 'Older streak day',
        completed: true,
        completedAt: localIso(2026, 8, 3, 9),
      }),
      makeTask({
        id: 25,
        title: 'Old goal activity',
        goalId: attentionGoal.id,
        completed: true,
        completedAt: localIso(2026, 7, 15, 9),
      }),
    ];
    const commitments = [
      makeWeeklyCommitment({
        id: 30,
        weekStart: '2026-08-03',
        taskId: taskForCommitment.id,
        title: 'Old saved title',
        completed: true,
      }),
      makeWeeklyCommitment({
        id: 31,
        weekStart: '2026-08-03',
        taskId: null,
        title: 'Manual commitment',
        completed: true,
      }),
      makeWeeklyCommitment({
        id: 32,
        weekStart: '2026-07-27',
        title: 'Different week',
        completed: true,
      }),
    ];
    const milestones = [
      makeGoalMilestone({
        goalId: healthyGoal.id,
        completed: true,
        completedAt: localIso(2026, 8, 4, 10),
      }),
      makeGoalMilestone({
        goalId: healthyGoal.id,
        completed: false,
      }),
    ];

    const snapshot = calculateGoalDashboardSnapshot(
      tasks,
      [healthyGoal, attentionGoal],
      milestones,
      commitments,
      4,
      now
    );

    expect(snapshot).toMatchObject({
      todayDateKey: '2026-08-05',
      currentWeekStart: '2026-08-03',
      completedToday: 1,
      todayRemaining: 1,
      todayTotal: 2,
      todayCompletionRate: 50,
      overdueCount: 1,
      currentStreak: 3,
      longestStreak: 3,
      commitmentCompleted: 1,
      commitmentTotal: 2,
    });
    expect(snapshot.commitments).toEqual([
      {
        id: 30,
        title: 'Live linked title',
        completed: false,
        linkedToTask: true,
      },
      {
        id: 31,
        title: 'Manual commitment',
        completed: true,
        linkedToTask: false,
      },
    ]);
    expect(snapshot.goals.map((goal) => goal.title)).toEqual([
      'Database portfolio',
      'Finish WeekFlow',
    ]);
    expect(snapshot.goals[0]).toMatchObject({
      healthStatus: 'needsAttention',
      taskCompleted: 1,
      taskTotal: 1,
    });
    expect(snapshot.goals[1]).toMatchObject({
      healthStatus: 'healthy',
      taskCompleted: 1,
      taskTotal: 2,
      milestoneCompleted: 1,
      milestoneTotal: 2,
      taskProgress: 50,
    });
  });

  test('returns clean zero states and excludes goals from other cycles', () => {
    const snapshot = calculateGoalDashboardSnapshot(
      [],
      [
        makeGoal({ cycleId: 2, completed: false }),
        makeGoal({ cycleId: 1, completed: false }),
        makeGoal({ cycleId: 2, completed: true }),
      ],
      [],
      [],
      2,
      new Date(localIso(2026, 8, 5, 12))
    );

    expect(snapshot).toMatchObject({
      completedToday: 0,
      todayRemaining: 0,
      todayTotal: 0,
      todayCompletionRate: 0,
      overdueCount: 0,
      currentStreak: 0,
      longestStreak: 0,
      commitmentCompleted: 0,
      commitmentTotal: 0,
    });
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.goals[0].healthStatus).toBe('noActivity');
  });
});
