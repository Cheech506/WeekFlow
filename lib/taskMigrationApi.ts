import type { Task } from './taskStorage';

export type TaskMigrationPreview = {
  received_count: number;
  would_create_count: number;
  already_imported_count: number;
  conflict_count: number;
  conflict_source_task_ids: number[];
  goal_linked_count: number;
  recurring_count: number;
  completed_count: number;
  can_import: boolean;
  database_changed: false;
};

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isTaskMigrationPreview(
  value: unknown
): value is TaskMigrationPreview {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const preview = value as Record<string, unknown>;

  return (
    isNonNegativeInteger(preview.received_count) &&
    isNonNegativeInteger(preview.would_create_count) &&
    isNonNegativeInteger(preview.already_imported_count) &&
    isNonNegativeInteger(preview.conflict_count) &&
    Array.isArray(preview.conflict_source_task_ids) &&
    preview.conflict_source_task_ids.every(
      (sourceTaskId) =>
        typeof sourceTaskId === 'number' &&
        Number.isSafeInteger(sourceTaskId) &&
        sourceTaskId > 0
    ) &&
    isNonNegativeInteger(preview.goal_linked_count) &&
    isNonNegativeInteger(preview.recurring_count) &&
    isNonNegativeInteger(preview.completed_count) &&
    typeof preview.can_import === 'boolean' &&
    preview.database_changed === false
  );
}

/**
 * Ask the API what a migration would do.
 *
 * This calls the read-only preview endpoint. It never calls the real
 * /api/v1/tasks/import endpoint.
 */
export async function previewTaskMigration(
  baseUrl: string,
  tasks: readonly Task[]
): Promise<TaskMigrationPreview> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  const response = await fetch(
    `${normalizedBaseUrl}/api/v1/tasks/import/preview`,
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

  if (!response.ok) {
    throw new Error(
      `Task migration preview returned ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (!isTaskMigrationPreview(data)) {
    throw new Error(
      'Task migration preview returned an invalid response'
    );
  }

  return data;
}