import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('task template storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('creates, edits, and deletes a reusable task template', async () => {
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );

    const createdTemplate =
      await templateStorage.insertTaskTemplate(
        '  Weekly report  ',
        '  Gather updates  ',
        2,
        null
      );

    expect(createdTemplate).toMatchObject({
      title: 'Weekly report',
      notes: 'Gather updates',
      priority: 2,
      goalId: null,
    });

    await templateStorage.updateTaskTemplateById(
      createdTemplate.id,
      'Updated weekly report',
      '',
      1,
      null
    );

    const [updatedTemplate] =
      await templateStorage.getTaskTemplates();

    expect(updatedTemplate).toMatchObject({
      title: 'Updated weekly report',
      notes: null,
      priority: 1,
    });

    await templateStorage.deleteTaskTemplateById(
      createdTemplate.id
    );

    expect(
      await templateStorage.getTaskTemplates()
    ).toEqual([]);
  });

  test('rejects blank titles without creating a template', async () => {
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );

    await expect(
      templateStorage.insertTaskTemplate('   ')
    ).rejects.toThrow('needs a title');

    expect(
      await templateStorage.getTaskTemplates()
    ).toEqual([]);
  });

  test('unlinks a template when its goal is deleted', async () => {
    const goalStorage = await import('../../lib/goalStorage');
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );

    const goal = await goalStorage.insertGoal(
      'Template goal',
      '2026-07-01',
      '2026-09-23'
    );

    const template =
      await templateStorage.insertTaskTemplate(
        'Goal-linked template',
        '',
        0,
        goal.id
      );

    await goalStorage.deleteGoalById(goal.id);

    const [storedTemplate] =
      await templateStorage.getTaskTemplates();

    expect(storedTemplate.id).toBe(template.id);
    expect(storedTemplate.goalId).toBeNull();
  });
});
