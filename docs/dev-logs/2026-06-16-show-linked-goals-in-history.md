# Dev Log — Show Linked Goals in History

## Date
June 16, 2026

## Project
WeekFlow

## Summary

Today I updated the History tab so completed tasks can show the goal they were linked to.

Before this update, task-to-goal linking was already working in Inbox, Goals, Daily, and Weekly. However, once a task was completed and moved into History, the History tab did not show which goal the task belonged to.

This update finishes that part of the app flow.

Now a completed task can show:

```txt
Assigned day
Priority
Linked goal
Notes
Completed date
```

---

## Why I Added This

The History tab is supposed to show what the user accomplished.

Since WeekFlow now supports 12-week goals, it makes sense for completed tasks to still show their goal connection after they are finished.

For example:

```txt
Task: Test Linked Goal
Goal: 100% Dispatch
```

This makes the completed history more useful because it shows not only what was completed, but also what larger goal the task supported.

---

## Files I Updated

### `app/(tabs)/history.tsx`

I imported the Goals context so the History tab can access the list of goals.

Then I matched each completed task’s `goalId` to the correct goal title.

If a completed task has a linked goal, the History card now shows:

```txt
Goal: [goal name]
```

I also cleaned up the completed date display by using the existing `formatCompletedDate()` helper instead of formatting the date directly inside the JSX.

---

## How It Works

The History tab now gets data from both contexts:

```txt
TaskContext
GoalContext
```

The task stores the linked goal ID as:

```txt
goalId
```

The app checks the list of goals and finds the goal with the matching ID.

The flow is:

```txt
Completed task has goalId
→ History tab checks the goals list
→ Matching goal is found
→ History card displays the goal title
```

---

## Testing I Did

I tested this by completing a task that was linked to the goal:

```txt
100% Dispatch
```

Then I checked the History tab and confirmed the completed task showed:

```txt
Assigned day: Monday
Priority: Low
Goal: 100% Dispatch
Completed date
```

---

## Current Status

The task-to-goal linking feature now works across the main task flow.

The app currently supports:

```txt
Creating 12-week goals
Creating tasks
Adding notes to tasks
Setting task priority
Linking tasks to goals
Moving Inbox tasks into the week
Viewing linked tasks under Goals
Viewing linked goals in Daily
Viewing linked goals in Weekly
Viewing linked goals in History
Completing tasks
Viewing completed task history
```

---

## Git Commit

```txt
feat: show linked goals in history
```

---

## Next Step

The next feature could be improving the task creation forms in Daily and Weekly so they can also add notes, priority, and linked goals directly instead of only through Inbox.
