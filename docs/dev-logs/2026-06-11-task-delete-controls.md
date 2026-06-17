# Dev Log — Added Task Delete Controls

## Date
June 11, 2026

## Project
WeekFlow

## Summary

Today I added delete controls for tasks.

Before this update, tasks could be added, completed, and shown in the app, but there was no clean way to remove a task if it was added by mistake or was no longer needed.

This update gives the user more control over the task list.

---

## What I Added

I added a Delete button to task cards.

The Delete button removes a task from the app and deletes it from local SQLite storage.

---

## Why I Added This

A task app needs a way to clean up mistakes.

Without delete controls, the user would be stuck with tasks they no longer wanted. That makes the app harder to use and makes the task list messy over time.

Adding delete controls makes the app feel more complete and easier to manage.

---

## Files I Updated

### `lib/taskStorage.ts`

I added a function to delete a task by ID from SQLite.

### `context/TaskContext.tsx`

I added a shared `deleteTask()` function so screens can delete tasks through the task context instead of directly touching the database.

After the task is deleted from SQLite, the context updates the task state so the task disappears from the UI.

### Task screens

I added Delete buttons to task cards so the user can remove tasks from the interface.

---

## How It Works

```txt
User clicks Delete
→ TaskContext calls deleteTask()
→ SQLite deletes the task
→ React state updates
→ Task disappears from the screen
```

---

## Testing I Did

I tested this by creating test tasks, deleting them, and confirming they disappeared from the active task views.

I also refreshed the app to confirm the deleted tasks did not come back from SQLite.

---

## Current Status

Task delete controls are working.

The app can now:

```txt
Add tasks
Complete tasks
Persist tasks
Delete tasks
Update the UI after deletion
```

---

## Git Commit

```txt
feat: add delete controls for tasks
```

---

## Next Step

Next I planned to add delete controls for goals so the Goals tab has the same type of cleanup ability.
