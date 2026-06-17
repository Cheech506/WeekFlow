# Dev Log — Core Persistence and Goals

## Date
June 11, 2026

## Project
WeekFlow

## Summary

I worked on the core persistence setup for WeekFlow.

Before this update, the app could show tasks and goals in the UI, but the data was not fully persistent. Refreshing the app or restarting development could cause data to disappear.

This update made the app more realistic by saving tasks and goals in SQLite.

---

## What I Added

I added local database storage for:

```txt
Tasks
Goals
Completed task history
```

I also connected the app screens to shared React Context providers.

---

## Why I Added This

A task app needs persistence.

If tasks disappear after refreshing the app, the app is only a demo. Adding SQLite makes WeekFlow behave more like a real application.

---

## Files I Updated

### `lib/db.ts`

I created the database setup and migration logic.

The database creates tables for tasks and goals.

### `lib/taskStorage.ts`

I added functions to save, load, complete, move, and delete tasks.

### `lib/goalStorage.ts`

I added functions to save, load, toggle, and delete goals.

### `context/TaskContext.tsx`

I added shared task state and task actions.

### `context/GoalContext.tsx`

I added shared goal state and goal actions.

### `app/(tabs)/_layout.tsx`

I wrapped the tabs with the task and goal providers so all screens can access shared data.

---

## How It Works

```txt
Screen calls context function
→ Context calls storage function
→ Storage updates SQLite
→ Context updates React state
→ UI refreshes
```

---

## Testing I Did

I tested adding tasks and goals, refreshing the app, and confirming the data stayed saved.

I also tested completing tasks and viewing them in History.

---

## Current Status

The core persistence system is working.

WeekFlow now has a stronger foundation for future features.
