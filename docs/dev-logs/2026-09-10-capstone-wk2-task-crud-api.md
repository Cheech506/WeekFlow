# Capstone WK2 — Complete Task CRUD API

**Date:** September 10, 2026  
**Status:** Complete

## Summary

Today I completed the first full CRUD API for WeekFlow tasks.

The FastAPI backend can now create, read, update, and delete task records stored in PostgreSQL. Pydantic validates incoming and outgoing data, while SQLAlchemy translates the Python operations into PostgreSQL queries.

## Completed Task API

The backend now supports:

```text
POST   /api/v1/tasks
GET    /api/v1/tasks
GET    /api/v1/tasks/{task_id}
PATCH  /api/v1/tasks/{task_id}
DELETE /api/v1/tasks/{task_id}
```

Together, these endpoints provide full CRUD functionality:

```text
Create → POST
Read   → GET
Update → PATCH
Delete → DELETE
```

## TaskUpdate Schema

Added a `TaskUpdate` Pydantic schema for partial task updates.

Unlike `TaskCreate`, every `TaskUpdate` field may be omitted. This allows the client to change one part of a task without resending or accidentally erasing the rest of the task.

For example:

```json
{
  "priority": 2
}
```

changes only the task’s priority.

The schema also:

- Removes extra whitespace from strings
- Rejects blank titles
- Restricts priority to `0`, `1`, or `2`
- Prevents required database values from being set to `null`
- Allows `notes: null` to clear notes
- Allows `due_date: null` to move a task back to Inbox
- Allows tasks to be completed or reopened

## Partial Update Behavior

Added:

```http
PATCH /api/v1/tasks/{task_id}
```

The route uses:

```python
task_data.model_dump(exclude_unset=True)
```

This produces a dictionary containing only the fields the client actually sent.

The update route also keeps related fields synchronized:

- Changing `due_date` recalculates the weekday stored in `day`
- Clearing `due_date` sets `day` to `Inbox`
- Completing a task sets `completed_at`
- Reopening a task clears `completed_at`
- Repeating `completed: true` preserves the original completion timestamp
- Updating an unknown task ID returns `404 Task not found`

SQLAlchemy applies the supplied values to the existing Task object and commits the update to PostgreSQL.

## Delete Behavior

Added:

```http
DELETE /api/v1/tasks/{task_id}
```

The route:

1. Finds the requested task
2. Returns `404` if it does not exist
3. Marks the SQLAlchemy object for deletion
4. Commits the deletion to PostgreSQL
5. Returns `204 No Content`

A `204` response intentionally has no JSON body because the requested deletion succeeded and the task no longer exists.

## API Data Flow

The completed backend flow is:

```text
Client or Swagger
        ↓
FastAPI route
        ↓
Pydantic validation
        ↓
SQLAlchemy session
        ↓
PostgreSQL
        ↓
TaskRead response
        ↓
JSON returned to the client
```

Alembic is not part of normal task requests. Alembic manages database structure, while SQLAlchemy handles the task data stored inside that structure.

## Testing

Added automated tests for:

- Partial updates
- Preserving omitted values
- Clearing nullable values
- Recalculating the weekday
- Completing a task
- Preserving an existing completion timestamp
- Reopening a completed task
- Rejecting invalid updates
- Returning `404` for missing tasks
- Deleting a task
- Returning an empty `204` response
- Confirming deleted tasks can no longer be retrieved

Final backend result:

```text
24 passed, 1 warning
```

The remaining warning is the previously known FastAPI TestClient deprecation warning and does not cause a test failure.

Alembic also reported:

```text
No new upgrade operations detected.
```

No migration was required because this work changed API behavior rather than the PostgreSQL table structure.

## Manual Verification

Swagger was used to verify the live API against PostgreSQL:

- Task creation returned `201 Created`
- Task retrieval returned `200 OK`
- Task updates returned `200 OK`
- Task deletion returned `204 No Content`
- Missing and deleted task IDs returned `404 Not Found`

Swagger also documents possible `422 Validation Error` responses. These are expected and show that FastAPI can reject invalid input before it reaches PostgreSQL.

## Files Updated

```text
server/app/routers/tasks.py
server/app/schemas/__init__.py
server/app/schemas/task.py
server/tests/test_task_schemas.py
server/tests/test_tasks_api.py
```

## Result

WeekFlow now has a tested, server-side PostgreSQL Task API with complete create, read, update, and delete functionality.

The existing mobile application and its SQLite data remain preserved. Connecting the mobile client to this API will be handled as a separate step so offline-storage and synchronization behavior can be designed safely.