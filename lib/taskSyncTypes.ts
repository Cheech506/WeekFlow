/** Shared records for the task cache and its pending-upload queue. */

import type { ApiTask, CreateApiTaskInput, UpdateApiTaskInput } from './api/taskApi';

export type TaskSyncAction = 'create' | 'update' | 'delete';

/** A sending/uncertain operation must be reconciled before it is replaced. */
export type TaskSyncOutboxState =
  | 'pending'
  | 'sending'
  | 'uncertain'
  | 'conflict'
  | 'rejected';

export type TaskSyncStatus = 'synced' | TaskSyncOutboxState;

/**
 * The backend must provide a stable server-instance identity before sync
 * is enabled. A URL alone is insufficient: a fresh database at the same
 * URL may reuse numeric task IDs. Owner identity matters for future login.
 */
export type TaskSyncScope = {
  scopeKey: string;
  baseUrl: string;
  serverInstanceKey: string;
  ownerKey: string;
  createdAt: string;
  lastDownloadAt: string | null;
  lastUploadAt: string | null;
};

/**
 * Editable/displayed task data with no ambiguous task ID inside its JSON.
 * Goal and recurring-rule IDs remain native PostgreSQL IDs. Source fields
 * remain migration metadata. The cache row owns localId and serverId.
 */
export type TaskSyncWorkingCopy = Omit<ApiTask, 'id'>;

export type CachedSyncTask = {
  localId: number;
  scopeKey: string;
  serverId: number | null;
  clientTaskKey: string;
  workingCopy: TaskSyncWorkingCopy;
  /** Last CONFIRMED server version, not the newest offline working copy. */
  serverSnapshot: ApiTask | null;
  /** Increases for local edits, so an old upload cannot clear newer work. */
  localRevision: number;
  isDeleted: boolean;
  status: TaskSyncStatus;
  cachedAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
};

/** Completion time is preserved when an action occurs while offline. */
type CompletionChange =
  | { completed: true; completedAt: string }
  | { completed: false; completedAt: null };

/**
 * Offline creation initially supports ordinary tasks. Series generation,
 * conversion, and series edits require their dedicated online workflows.
 * This is a SYNC payload, not input for the existing createApiTask function.
 * The future sync endpoint must validate it and deduplicate its operation.
 */
export type TaskSyncCreatePayload =
  Omit<CreateApiTaskInput, 'recurringRuleId' | 'recurrenceOccurrenceDate'> &
  { createdAt: string } & CompletionChange;

export type TaskSyncUpdatePayload =
  Omit<UpdateApiTaskInput, 'completed'> &
  (
    | { completed?: never; completedAt?: never }
    | CompletionChange
  );

export type TaskSyncDeletePayload = Record<string, never>;

/** Metadata frozen with the exact request being uploaded. */
type TaskSyncOperationMetadata = {
  operationKey: string;
  scopeKey: string;
  localTaskId: number;
  clientTaskKey: string;
  state: TaskSyncOutboxState;
  localRevision: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Validated conflict data will be defined with the server sync response. */
  conflict: Record<string, unknown> | null;
};

/** The action determines both the permitted payload and required baseline. */
export type TaskSyncOperation = TaskSyncOperationMetadata & (
  | {
      action: 'create';
      serverId: null;
      baseSnapshot: null;
      payload: TaskSyncCreatePayload;
    }
  | {
      action: 'update';
      serverId: number;
      baseSnapshot: ApiTask;
      payload: TaskSyncUpdatePayload;
    }
  | {
      action: 'delete';
      serverId: number;
      baseSnapshot: ApiTask;
      payload: TaskSyncDeletePayload;
    }
);

/** Strip the server task ID before saving the working-copy JSON. */
export function taskWorkingCopy(task: ApiTask): TaskSyncWorkingCopy {
  const { id: _serverId, ...workingCopy } = task;
  return workingCopy;
}
