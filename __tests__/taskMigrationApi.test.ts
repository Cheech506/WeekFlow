import {
    previewTaskMigration,
    type TaskMigrationPreview,
} from '../lib/taskMigrationApi';
import { makeTask } from './testFactories';

afterEach(() => {
  jest.restoreAllMocks();
});

test('sends tasks only to the read-only preview endpoint', async () => {
  const tasks = [
    makeTask({
      id: 101,
      title: 'Preview this task',
    }),
  ];

  const preview: TaskMigrationPreview = {
    received_count: 1,
    would_create_count: 1,
    already_imported_count: 0,
    conflict_count: 0,
    conflict_source_task_ids: [],
    goal_linked_count: 0,
    recurring_count: 0,
    completed_count: 0,
    can_import: true,
    database_changed: false,
  };

  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => preview,
    } as Response);

  await expect(
    previewTaskMigration(
      'http://127.0.0.1:8000/',
      tasks
    )
  ).resolves.toEqual(preview);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/api/v1/tasks/import/preview',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks,
      }),
    }
  );
});

test('reports an unsuccessful preview response', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        detail: 'Database is unavailable',
      }),
    } as Response);

  await expect(
    previewTaskMigration(
      'http://127.0.0.1:8000',
      [makeTask()]
    )
  ).rejects.toThrow(
    'Task migration preview returned 503'
  );
});

test('rejects a response that claims the database changed', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        received_count: 1,
        would_create_count: 1,
        already_imported_count: 0,
        conflict_count: 0,
        conflict_source_task_ids: [],
        goal_linked_count: 0,
        recurring_count: 0,
        completed_count: 0,
        can_import: true,
        database_changed: true,
      }),
    } as Response);

  await expect(
    previewTaskMigration(
      'http://127.0.0.1:8000',
      [makeTask()]
    )
  ).rejects.toThrow(
    'Task migration preview returned an invalid response'
  );
});