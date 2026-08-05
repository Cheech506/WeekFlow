import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

const snapshot = {
  goalTotal: 4,
  goalCompleted: 0,
  taskCompleted: 1,
  milestoneTotal: 1,
  milestoneCompleted: 1,
  weeklyReviewsCompleted: 0,
  longestStreak: 1,
  bestWeekNumber: 5,
  bestWeekCount: 1,
  bestDay: 'Tuesday',
  bestDayCount: 1,
  highPriorityCompleted: 1,
  recurringCompleted: 0,
  rewardsUnlocked: 0,
  brainDumpsArchived: 0,
};

describe('cycle review storage integration', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    let id = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => id++);
  });

  test('saves and reloads a Week 13 draft with goal outcomes and next-cycle commitments', async () => {
    const cycleStorage = await import('../../lib/cycleStorage');
    const goalStorage = await import('../../lib/goalStorage');
    const reviewStorage = await import('../../lib/cycleReviewStorage');

    const cycle = await cycleStorage.startPlanningCycle('2026-07-01', {
      name: 'Summer 2026',
    });
    const goal = await goalStorage.insertGoal(
      'Carry this goal',
      '2026-07-01',
      '2026-09-22',
      null,
      {},
      cycle.id
    );

    await reviewStorage.saveCycleReviewDraft({
      cycleId: cycle.id,
      reflection: {
        biggestAccomplishment: '  Built the review foundation  ',
      },
      nextCycle: {
        name: 'Fall 2026',
        primaryFocus: 'Prepare for the capstone',
        theme: 'Finish strong',
        startDate: '2026-09-30',
        firstWeekCommitments: ['  Set up the first week  '],
      },
      snapshot: { ...snapshot, goalTotal: 1 },
      outcomes: [{ goalId: goal.id, action: 'carryForward' }],
    });

    const [review] = await reviewStorage.getCycleReviews();
    const [outcome] = await reviewStorage.getCycleGoalOutcomes();

    expect(review).toMatchObject({
      cycleId: cycle.id,
      biggestAccomplishment: 'Built the review foundation',
      nextCycleName: 'Fall 2026',
      nextCycleStartDate: '2026-09-30',
      nextCycleFirstWeekCommitments: ['Set up the first week'],
      finalizedAt: null,
    });
    expect(outcome).toMatchObject({
      cycleReviewId: review.id,
      goalId: goal.id,
      goalTitle: 'Carry this goal',
      action: 'carryForward',
      destinationGoalId: null,
    });
  });

  test('finalizes the old cycle, applies every goal outcome, and starts the planned next cycle atomically', async () => {
    const cycleStorage = await import('../../lib/cycleStorage');
    const goalStorage = await import('../../lib/goalStorage');
    const milestoneStorage = await import('../../lib/goalMilestoneStorage');
    const taskStorage = await import('../../lib/taskStorage');
    const weeklyStorage = await import('../../lib/weeklyReviewStorage');
    const reviewStorage = await import('../../lib/cycleReviewStorage');

    const cycle = await cycleStorage.startPlanningCycle('2026-07-01', {
      name: 'Summer 2026',
      primaryFocus: 'Finish WeekFlow',
    });

    const completeGoal = await goalStorage.insertGoal(
      'Complete during review',
      '2026-07-01',
      '2026-09-22',
      'Buy a game',
      {},
      cycle.id
    );
    const carryGoal = await goalStorage.insertGoal(
      'Carry forward',
      '2026-07-01',
      '2026-09-22',
      null,
      {
        purpose: 'Preserve this purpose',
        successDefinition: 'Finish the remaining work',
        notes: 'Carry the planning notes too.',
      },
      cycle.id
    );
    const archiveGoal = await goalStorage.insertGoal(
      'Archive unfinished',
      '2026-07-01',
      '2026-09-22',
      null,
      {},
      cycle.id
    );
    const replaceGoal = await goalStorage.insertGoal(
      'Replace this goal',
      '2026-07-01',
      '2026-09-22',
      null,
      {},
      cycle.id
    );

    const carriedMilestone = await milestoneStorage.insertGoalMilestone(
      carryGoal.id,
      'Preserved milestone',
      '2026-08-15',
      'Keep the milestone notes.'
    );
    await milestoneStorage.updateGoalMilestoneCompletion(
      carriedMilestone.id,
      true
    );

    const taskId = await taskStorage.insertTask(
      'High priority goal task',
      'Tuesday',
      '',
      2,
      completeGoal.id,
      '2026-08-04'
    );
    await taskStorage.completeTaskById(taskId);

    await reviewStorage.finalizeCycleReviewAndStartNextCycle({
      cycleId: cycle.id,
      reflection: {
        biggestAccomplishment: 'Finished the local planning system',
      },
      nextCycle: {
        name: 'Fall 2026',
        primaryFocus: 'Prepare for the capstone',
        theme: 'Finish strong',
        startDate: '2026-09-30',
        firstWeekCommitments: [
          'Set up the capstone plan',
          'Review carried goals',
        ],
      },
      snapshot,
      outcomes: [
        { goalId: completeGoal.id, action: 'complete' },
        { goalId: carryGoal.id, action: 'carryForward' },
        { goalId: archiveGoal.id, action: 'archive' },
        {
          goalId: replaceGoal.id,
          action: 'replace',
          replacementTitle: 'Replacement goal',
        },
      ],
    });

    const cycles = await cycleStorage.getPlanningCycles();
    const oldCycle = cycles.find((item) => item.id === cycle.id);
    const nextCycle = cycles.find((item) => item.active);

    expect(oldCycle).toMatchObject({ active: false, name: 'Summer 2026' });
    expect(nextCycle).toMatchObject({
      name: 'Fall 2026',
      primaryFocus: 'Prepare for the capstone',
      theme: 'Finish strong',
      startDate: '2026-09-30',
      endDate: '2026-12-22',
      active: true,
    });

    const goals = await goalStorage.getGoals();
    const oldComplete = goals.find((goal) => goal.id === completeGoal.id);
    const oldCarry = goals.find((goal) => goal.id === carryGoal.id);
    const oldArchive = goals.find((goal) => goal.id === archiveGoal.id);
    const carriedCopy = goals.find(
      (goal) =>
        goal.cycleId === nextCycle?.id && goal.title === 'Carry forward'
    );
    const replacement = goals.find(
      (goal) =>
        goal.cycleId === nextCycle?.id && goal.title === 'Replacement goal'
    );

    expect(oldComplete?.completed).toBe(true);
    expect(oldComplete).toMatchObject({
      completionTaskTotal: 1,
      completionTaskCompleted: 1,
      completionHighPriorityCompleted: 1,
    });
    expect(oldCarry).toMatchObject({ cycleId: cycle.id, completed: false });
    expect(oldArchive).toMatchObject({ cycleId: cycle.id, completed: false });
    expect(carriedCopy).toMatchObject({
      purpose: 'Preserve this purpose',
      successDefinition: 'Finish the remaining work',
      notes: 'Carry the planning notes too.',
      completed: false,
    });
    expect(replacement).toMatchObject({ completed: false });

    const milestones = await milestoneStorage.getGoalMilestones();
    expect(
      milestones.find((milestone) => milestone.goalId === carriedCopy?.id)
    ).toMatchObject({
      title: 'Preserved milestone',
      notes: 'Keep the milestone notes.',
      completed: true,
    });

    const commitments = await weeklyStorage.getWeeklyCommitments();
    expect(commitments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          weekStart: '2026-09-28',
          cycleId: nextCycle?.id,
          title: 'Set up the capstone plan',
        }),
        expect.objectContaining({
          weekStart: '2026-09-28',
          cycleId: nextCycle?.id,
          title: 'Review carried goals',
        }),
      ])
    );

    const [review] = await reviewStorage.getCycleReviews();
    const outcomes = await reviewStorage.getCycleGoalOutcomes();
    expect(review).toMatchObject({
      cycleId: cycle.id,
      goalCompleted: 1,
      rewardsUnlocked: 1,
      nextCycleId: nextCycle?.id,
      finalizedAt: expect.any(String),
    });
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: carryGoal.id,
          action: 'carryForward',
          destinationGoalId: carriedCopy?.id,
        }),
        expect.objectContaining({
          goalId: replaceGoal.id,
          action: 'replace',
          destinationGoalId: replacement?.id,
        }),
      ])
    );

    await expect(
      reviewStorage.finalizeCycleReviewAndStartNextCycle({
        cycleId: cycle.id,
        nextCycle: { startDate: '2027-01-01' },
        snapshot,
        outcomes: [],
      })
    ).rejects.toThrow('current cycle');
  });

  test('rolls back finalization when any unfinished goal is missing an outcome', async () => {
    const cycleStorage = await import('../../lib/cycleStorage');
    const goalStorage = await import('../../lib/goalStorage');
    const reviewStorage = await import('../../lib/cycleReviewStorage');

    const cycle = await cycleStorage.startPlanningCycle('2026-07-01');
    await goalStorage.insertGoal(
      'Needs a decision',
      '2026-07-01',
      '2026-09-22',
      null,
      {},
      cycle.id
    );

    await expect(
      reviewStorage.finalizeCycleReviewAndStartNextCycle({
        cycleId: cycle.id,
        nextCycle: { startDate: '2026-09-30' },
        snapshot: { ...snapshot, goalTotal: 1 },
        outcomes: [],
      })
    ).rejects.toThrow('Choose an outcome');

    expect(await cycleStorage.getPlanningCycles()).toHaveLength(1);
    expect((await cycleStorage.getActivePlanningCycle())?.id).toBe(cycle.id);
  });
});
