# Dev Log — Linked Tasks to 12 Week Goals

## Date
June 15, 2026

## Project
WeekFlow

## Summary

Today I added the ability to link tasks to 12-week goals.

Before this update, goals and tasks were separate parts of the app. A user could create goals, and they could create tasks, but there was no connection between the bigger goal and the smaller tasks needed to complete it.

This update makes the app more useful because tasks can now support a larger goal.

For example:

```txt
Goal: 100% Dispatch
Task: Test linked goals for Daily and Weekly
```

Now the app can show which tasks belong to a specific goal.

---

## What I Added

I added a new relationship between tasks and goals.

Tasks can now store:

```txt
goal_id
```

This allows a task to optionally be connected to a goal.

---

## Files I Updated

### `lib/db.ts`

I updated the tasks table so it supports a new column:

```txt
goal_id
```

I also added migration logic so the column can be added safely without deleting the existing database.

### `lib/taskStorage.ts`

I updated the task storage model so tasks can save and load the linked goal ID.

The task model now includes:

```txt
goalId
```

### `context/TaskContext.tsx`

I updated the shared task context so `addTask()` can accept a goal ID.

The important fix was making sure the goal ID actually gets passed into `insertTask()`.

Before the fix, the Inbox goal picker worked visually, but the selected goal was not being saved with the task.

After the fix, the selected goal is saved correctly.

### `app/(tabs)/inbox.tsx`

I updated the Inbox tab so the user can choose a goal when creating a task.

The Inbox form now includes:

```txt
Task title
Optional notes
Priority
Linked goal
```

The task card also shows the linked goal after the task is created.

### `app/(tabs)/index.tsx`

I updated the Goals tab so each goal shows its linked tasks.

The Goals tab now displays:

```txt
Linked Tasks
Number completed
Task title
Task day
Task priority
Task notes
```

### `app/(tabs)/daily.tsx`

I updated the Daily tab so linked tasks show their goal name.

### `app/(tabs)/weekly.tsx`

I updated the Weekly tab so linked tasks also show their goal name.

---

## Testing I Did

I tested the feature by creating a goal called:

```txt
100% Dispatch
```

Then I created a task in Inbox and linked it to that goal.

I confirmed that:

```txt
The goal button turned blue before saving
The task saved correctly
The Inbox card showed the linked goal
The Goals tab showed the task under the goal
The Daily tab showed the linked goal
The Weekly tab showed the linked goal
```

I also found and fixed a bug where the selected goal ID was not being passed into the task storage function.

---

## Current Status

Task-to-goal linking is now working.

The app now supports:

```txt
Persistent tasks
Persistent goals
Inbox tasks
Daily tasks
Weekly tasks
Completed task history
Task notes
Task priority
Task delete controls
Goal delete controls
Moving tasks from Inbox into the week
Linking tasks to 12-week goals
Showing linked tasks inside the Goals tab
Showing linked goal names in Daily and Weekly
```

---

## Git Commit

```txt
feat: link tasks to goals
```

---

## Next Step

The next small feature should be showing the linked goal name in the History tab.
