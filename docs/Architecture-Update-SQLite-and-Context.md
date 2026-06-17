# Architecture Update — SQLite and Context

## Project
WeekFlow

## Summary

This document explains the architecture update where I connected WeekFlow screens to SQLite storage through React Context.

The goal was to keep the app organized so screens do not directly manage database logic.

---

## Main Architecture

WeekFlow uses three main layers:

```txt
UI screens
React Context
Storage/database files
```

---

## UI Screens

The screens are located in:

```txt
app/(tabs)
```

The screens display data and call context functions when the user performs an action.

Examples:

```txt
Add task
Complete task
Delete task
Move task to a weekday
Add goal
Toggle goal
Delete goal
```

---

## React Context

The context files are:

```txt
context/TaskContext.tsx
context/GoalContext.tsx
```

These files hold shared state and expose functions to the screens.

---

## Storage Layer

The storage files are:

```txt
lib/db.ts
lib/taskStorage.ts
lib/goalStorage.ts
```

These files handle SQLite setup and database queries.

The screens do not directly write SQL. They call context functions, and the context calls the storage layer.

---

## Database

The app uses SQLite through Expo SQLite.

The main database file is:

```txt
weekflow.db
```

The main tables are:

```txt
tasks
goals
```

---

## Why This Structure Helps

This structure keeps the app easier to maintain.

Instead of putting database code inside every screen, the app separates responsibilities:

```txt
Screens = user interface
Context = shared app state
Storage = SQLite logic
```

---

## Current Status

This architecture is working and supports the main app features.
