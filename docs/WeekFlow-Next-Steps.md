# WeekFlow Next Steps

## Project
WeekFlow

## Summary

This document lists the next steps for improving WeekFlow after the current MVP.

The app already has the main structure working, so the next work should focus on making task creation more complete and improving the user experience.

---

## Current Strong Points

WeekFlow already supports:

```txt
Goals
Inbox
Daily tasks
Weekly tasks
Completed history
SQLite persistence
Task notes
Task priority
Task-to-goal linking
```

---

## Best Next Feature

The best next feature is improving task creation in Daily and Weekly.

Right now the most complete task creation form is in Inbox.

Daily and Weekly should eventually support:

```txt
Task title
Notes
Priority
Linked goal
```

This would let the user create detailed tasks from any main task screen.

---

## Other Useful Next Features

### Task Editing

The user should be able to edit an existing task instead of deleting and recreating it.

### Real Dates

The app currently uses weekday names.

A later update should use actual calendar dates so weekly planning can roll forward from week to week.

### Streaks

A streak feature could track how many days or weeks the user completed tasks.

### Weekly Review

A weekly review screen could show:

```txt
Tasks completed this week
Goals worked on
Tasks left unfinished
```

### Sync

A long-term goal is self-hosted sync so data can move between devices.

---

## Recommended Build Order

```txt
1. Improve Daily and Weekly task creation forms
2. Add task editing
3. Add real date support
4. Add weekly review
5. Add streaks
6. Add self-hosted sync
```
