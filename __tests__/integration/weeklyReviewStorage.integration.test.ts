import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import type { WeeklyReviewSnapshot } from '../../lib/weeklyReview';

const snapshot: WeeklyReviewSnapshot = {
  completedCount: 6,
  unfinishedCount: 2,
  overdueCount: 1,
  completionRate: 75,
  goalsProgressedCount: 2,
  bestDay: 'Wednesday',
  bestDayCount: 3,
  archivedBrainDumpCount: 1,
  highPriorityCompletedCount: 2,
  recurringCompletedCount: 1,
};

describe('weekly review storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('saves reflection and preserves the first analytics snapshot', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');

    await storage.saveWeeklyReview(
      '2026-07-06',
      null,
      {
        whatWentWell: 'The week stayed focused.',
        nextWeekFocus: 'Finish the backup lab.',
      },
      snapshot
    );

    await storage.saveWeeklyReview(
      '2026-07-06',
      null,
      {
        whatWentWell: 'Updated reflection.',
        whatLearned: 'Use fewer commitments.',
      },
      {
        ...snapshot,
        completedCount: 99,
        completionRate: 100,
      }
    );

    const [review] = await storage.getWeeklyReviews();

    expect(review).toMatchObject({
      weekStart: '2026-07-06',
      whatWentWell: 'Updated reflection.',
      whatLearned: 'Use fewer commitments.',
      completedCount: 6,
      completionRate: 75,
      highPriorityCompletedCount: 2,
    });
  });

  test('creates, completes, reopens, and deletes weekly commitments', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');

    const id = await storage.insertWeeklyCommitment(
      '2026-07-06',
      null,
      'Finish restore testing'
    );

    await storage.setWeeklyCommitmentCompleted(id, true);
    expect((await storage.getWeeklyCommitments())[0]).toMatchObject({
      taskId: null,
      title: 'Finish restore testing',
      completed: true,
    });

    await storage.setWeeklyCommitmentCompleted(id, false);
    expect((await storage.getWeeklyCommitments())[0].completedAt).toBeNull();

    await storage.deleteWeeklyCommitmentById(id);
    expect(await storage.getWeeklyCommitments()).toEqual([]);
  });

  test('links a real task, synchronizes completion, and preserves the commitment when the task is deleted', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');
    const taskStorage = await import('../../lib/taskStorage');

    const taskId = await taskStorage.insertTask(
      'Finish database notes',
      'Inbox'
    );
    const commitmentId = await storage.insertTaskWeeklyCommitment(
      '2026-07-06',
      null,
      taskId
    );

    await expect(
      storage.insertTaskWeeklyCommitment('2026-07-06', null, taskId)
    ).rejects.toThrow('already a commitment');

    expect((await storage.getWeeklyCommitments())[0]).toMatchObject({
      id: commitmentId,
      taskId,
      title: 'Finish database notes',
      completed: false,
    });

    await storage.setWeeklyCommitmentCompleted(commitmentId, true);
    expect((await taskStorage.getTasks())[0]).toMatchObject({
      id: taskId,
      completed: true,
    });

    await storage.toggleWeeklyCommitmentById(commitmentId);
    expect((await taskStorage.getTasks())[0]).toMatchObject({
      id: taskId,
      completed: false,
      completedAt: null,
    });

    await taskStorage.updateTaskById(
      taskId,
      'Finish updated database notes'
    );
    expect((await storage.getWeeklyCommitments())[0].title).toBe(
      'Finish updated database notes'
    );

    await taskStorage.deleteTaskById(taskId);
    expect((await storage.getWeeklyCommitments())[0]).toMatchObject({
      id: commitmentId,
      taskId: null,
      title: 'Finish updated database notes',
      completed: false,
    });
  });

  test('upserts an unfinished-task decision without creating duplicates', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');
    const taskStorage = await import('../../lib/taskStorage');

    /*
     * Weekly task decisions intentionally reject dangling task IDs. Create a
     * real scheduled task so this test exercises the upsert behavior rather
     * than failing the database relationship guardrail.
     */
    const taskId = await taskStorage.insertTask(
      'Recurring lab review',
      'Wednesday',
      '',
      0,
      null,
      '2026-07-08'
    );

    await storage.recordWeeklyTaskDecision({
      weekStart: '2026-07-06',
      taskId,
      taskTitle: 'Recurring lab review',
      originalDueDate: '2026-07-08',
      action: 'reschedule',
      resolvedDueDate: '2026-07-15',
      recurringRuleId: 7,
      recurrenceOccurrenceDate: '2026-07-08',
    });

    await storage.recordWeeklyTaskDecision({
      weekStart: '2026-07-06',
      taskId,
      taskTitle: 'Recurring lab review updated',
      originalDueDate: '2026-07-08',
      action: 'nextWeek',
      resolvedDueDate: '2026-07-15',
      recurringRuleId: 7,
      recurrenceOccurrenceDate: '2026-07-08',
    });

    const decisions = await storage.getWeeklyTaskDecisions();

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      taskId,
      taskTitle: 'Recurring lab review updated',
      action: 'nextWeek',
      resolvedDueDate: '2026-07-15',
      recurringRuleId: 7,
      recurrenceOccurrenceDate: '2026-07-08',
    });

    await storage.deleteWeeklyTaskDecisionById(decisions[0].id);
    expect(await storage.getWeeklyTaskDecisions()).toEqual([]);
  });

  test('preserves a deleted task decision without a dangling task ID', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');

    await storage.recordWeeklyTaskDecision({
      weekStart: '2026-07-06',
      taskId: null,
      taskTitle: 'Remove obsolete task',
      originalDueDate: '2026-07-10',
      action: 'delete',
      recurringRuleId: null,
      recurrenceOccurrenceDate: null,
    });

    expect((await storage.getWeeklyTaskDecisions())[0]).toMatchObject({
      taskId: null,
      taskTitle: 'Remove obsolete task',
      action: 'delete',
      resolvedDueDate: null,
    });
  });

  test('rejects invalid review weeks and mismatched task decisions', async () => {
    const storage = await import('../../lib/weeklyReviewStorage');

    await expect(
      storage.insertWeeklyCommitment(
        '2026-07-07',
        null,
        'This date is a Tuesday'
      )
    ).rejects.toThrow('must start on Monday');

    await expect(
      storage.recordWeeklyTaskDecision({
        weekStart: '2026-07-06',
        taskId: 25,
        taskTitle: 'Outside the selected week',
        originalDueDate: '2026-07-13',
        action: 'keep',
      })
    ).rejects.toThrow('does not belong to that review week');

    await expect(
      storage.recordWeeklyTaskDecision({
        weekStart: '2026-07-06',
        taskId: 25,
        taskTitle: 'Wrong next-week date',
        originalDueDate: '2026-07-08',
        action: 'nextWeek',
        resolvedDueDate: '2026-07-16',
      })
    ).rejects.toThrow('must preserve its weekday');
  });
});
