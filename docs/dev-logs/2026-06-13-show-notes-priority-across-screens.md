# Dev Log — Show Task Notes and Priority Across Screens

## Date
June 13, 2026

## Project
WeekFlow

## Summary

Today I updated the Daily, Weekly, and History tabs so they show task notes and priority.

Before this update, I had already added notes and priority to tasks, but those details only showed in the Inbox tab. When I moved a task from Inbox into the Weekly plan, the task still moved correctly, but the extra details were not visible anymore.

The notes and priority were still part of the task data, but the Daily and Weekly screens were only displaying the task title and assigned day.

This update fixes that by showing the extra task information everywhere it matters.

---

## What I Added

I updated the task cards so they now show:

```txt
Task title
Assigned day
Priority
Notes
```

This makes the task information more consistent across the app.

Now, if a user creates a detailed task in Inbox and moves it into the week, the important details stay visible.

---

## Why I Added This

The Inbox is used to quickly brain-dump tasks, but some tasks need more detail.

For example:

```txt
Task: Find out how many drives I need for NAS
Notes: I want to handle 2 drive failures
Priority: High
```

That information should not disappear once the task gets moved to a weekday.

The task should keep its context through the whole app flow:

```txt
Inbox
→ Weekly
→ Daily
→ History
```

---

## Files I Updated

### `app/(tabs)/daily.tsx`

I updated the Daily tab task card so it now displays the task title, assigned day, priority, and notes.

### `app/(tabs)/weekly.tsx`

I updated the Weekly tab task cards so scheduled tasks show priority and notes.

### `app/(tabs)/history.tsx`

I updated the History tab so completed tasks also show priority and notes.

---

## Helper Function Added

I added a helper function to convert the priority number into readable text.

The priority values are:

```txt
0 = Low
1 = Medium
2 = High
```

The UI displays them as:

```txt
Low
Medium
High
```

---

## How It Works Now

```txt
Create task in Inbox
→ Add notes and priority
→ Move task to a weekday
→ Notes and priority show in Weekly
→ If the task is for today, notes and priority show in Daily
→ Complete the task
→ Notes and priority show in History
```

---

## Testing I Did

I tested the feature by creating an Inbox task with:

```txt
Title: Find out how many drives I need for NAS
Notes: I want to handle 2 drive failures
Priority: High
```

Then I moved it into the weekly schedule and confirmed the priority and notes showed in Weekly, Daily, and History.

---

## Current Status

Task notes and priority now show across the main task screens.

The app currently supports:

```txt
Persistent tasks with SQLite
Persistent goals with SQLite
Inbox tasks
Daily tasks
Weekly tasks
Completed task history
Task delete controls
Goal delete controls
Task notes
Task priority
Moving Inbox tasks into the week
Displaying task details across task screens
```

---

## Git Commit

```txt
feat: show task notes and priority across task screens
```

---

## Next Step

The next feature will probably be linking tasks to 12-week goals.
