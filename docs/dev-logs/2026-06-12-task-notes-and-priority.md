# Dev Log — Added Task Notes and Priority

## Date
June 12, 2026

## Project
WeekFlow

## Summary

Today I added support for task notes and priority levels.

Before this update, a task only had a title, assigned day, completion status, and completion timestamp. That worked for a basic task list, but it was still limited because some tasks need extra details.

I wanted the Inbox to be more useful as a brain-dump area, so I added optional notes and a priority level when creating an Inbox task.

Now the user can add a task with:

```txt
Task title
Optional notes
Priority level
```

---

## What I Added

I added two new fields to tasks:

```txt
notes
priority
```

The priority levels are:

```txt
Low
Medium
High
```

For now, the Inbox screen is the first screen that lets the user enter notes and choose priority.

---

## Why I Added This

The Inbox tab is meant for quickly writing down tasks when the user does not want to fully schedule them yet.

Some tasks are simple, but others need more context.

For example:

```txt
Task: Find out how many drives I need for NAS
Notes: I want to handle 2 drive failures
Priority: High
```

Without notes, the task title has to hold too much information. Adding notes makes the task easier to understand later.

Priority also helps the user quickly see what matters most.

---

## Files I Updated

### `lib/db.ts`

I updated the database migration logic so the tasks table supports two new columns:

```txt
notes
priority
```

I also added migration logic to safely add those columns if the tasks table already exists.

### `lib/taskStorage.ts`

I updated the task storage layer so tasks can save and load notes and priority.

The task model now includes:

```txt
id
title
day
notes
priority
completed
completedAt
```

I also updated the task insert function so new tasks can be created with optional notes and priority.

### `context/TaskContext.tsx`

I updated the shared task context so `addTask()` can accept notes and priority.

Before:

```txt
addTask(title, day)
```

After:

```txt
addTask(title, day, notes, priority)
```

### `app/(tabs)/inbox.tsx`

I updated the Inbox tab UI.

I added:

```txt
Notes input
Priority picker
Display for priority
Display for notes
```

---

## How It Works Now

```txt
Open Inbox
→ Add task title
→ Add optional notes
→ Pick Low, Medium, or High priority
→ Save task
→ Task is stored in SQLite
→ Task appears in Inbox with notes and priority
```

---

## Testing I Did

I tested this by creating an Inbox task with:

```txt
Title: Find out how many drives you need for NAS
Notes: I want to handle 2 drive failures
Priority: High
```

The task showed correctly in the Inbox tab with the priority and notes.

I also moved the task into the Weekly tab and confirmed that the task still moved to the selected day.

---

## Issue I Noticed

After moving the task out of Inbox, the Daily and Weekly tabs only showed the task title and assigned day.

The notes and priority were still stored in the task data, but Daily and Weekly were not displaying those fields yet.

---

## Current Status

Task notes and priority are now working in the Inbox tab.

The app currently supports:

```txt
Persistent tasks
Persistent goals
Inbox tasks
Daily tasks
Weekly tasks
Completed history
Task delete controls
Goal delete controls
Task notes
Task priority
```

---

## Git Commit

```txt
feat: add task notes and priority support
```

---

## Next Step

Next I needed to update the Daily, Weekly, and History screens so task notes and priority were visible after a task left the Inbox.
