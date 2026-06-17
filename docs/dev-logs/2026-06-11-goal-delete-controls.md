# Dev Log — Added Goal Delete Controls

## Date
June 11, 2026

## Project
WeekFlow

## Summary

Today I added delete controls for 12-week goals.

Before this update, goals could be created and marked complete, but there was no way to remove a goal from the app.

This update makes the Goals tab easier to manage.

---

## What I Added

I added a Delete button to goal cards.

The Delete button removes the goal from local SQLite storage and updates the Goals tab right away.

---

## Why I Added This

Goals can change over time.

The user might create a goal by mistake, decide a goal no longer matters, or want to clean up old test data while developing the app.

Adding delete controls makes the Goals tab more usable and keeps the app from feeling stuck with old information.

---

## Files I Updated

### `lib/goalStorage.ts`

I added a function to delete a goal by ID from SQLite.

### `context/GoalContext.tsx`

I added a shared `deleteGoal()` function so screens can delete goals through the goal context.

After the database is updated, the context removes the goal from the current state.

### `app/(tabs)/index.tsx`

I added a Delete button to each goal card on the Goals tab.

---

## How It Works

```txt
User clicks Delete on a goal
→ GoalContext calls deleteGoal()
→ SQLite removes the goal
→ React state updates
→ Goal disappears from the Goals tab
```

---

## Testing I Did

I tested this by creating a test goal, deleting it, and refreshing the app.

The goal stayed deleted after refresh, which confirmed SQLite was updating correctly.

---

## Current Status

Goal delete controls are working.

The app can now:

```txt
Create goals
Persist goals
Mark goals complete
Mark completed goals active again
Delete goals
```

---

## Git Commit

```txt
feat: add delete controls for goals
```

---

## Next Step

Next I planned to add an Inbox tab so unscheduled tasks could be captured before being moved into the week.
