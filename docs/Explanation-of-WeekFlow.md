# Explanation of WeekFlow

## What WeekFlow Is

WeekFlow is a weekly task and goal planning app.

The main idea is to help the user quickly capture tasks, organize them into the week, complete them, and review what they finished.

The app also supports 12-week goals so daily and weekly tasks can connect to bigger goals.

---

## Why I Built It

I wanted an app that works more like how I actually plan tasks.

A lot of task apps are either too simple or too complicated. I wanted something focused on:

```txt
What do I need to do today?
What do I need to do this week?
What did I already finish?
What bigger goal does this task support?
```

---

## Main App Flow

The basic flow is:

```txt
Add task to Inbox
→ Move task into the week
→ Work from Daily or Weekly
→ Complete the task
→ Review it in History
```

For larger planning, the flow is:

```txt
Create a 12-week goal
→ Link tasks to the goal
→ See linked tasks under the goal
→ Complete tasks over time
```

---

## Main Screens

### Goals

The Goals tab stores 12-week goals.

Each goal can show linked tasks so the user can see what smaller tasks support the larger goal.

### Inbox

The Inbox is for quick task capture.

Tasks can be added without choosing a day immediately. Later, they can be moved to a weekday.

### Daily

The Daily tab shows tasks assigned to the current day.

### Weekly

The Weekly tab shows tasks organized by Monday through Sunday.

### History

The History tab shows completed tasks.

It helps the user look back at what they finished, including priority, notes, linked goal, and completion date.

---

## Technical Overview

WeekFlow uses:

```txt
React Native
Expo
TypeScript
Expo Router
SQLite
React Context
```

SQLite stores the data locally.

React Context shares tasks and goals across the different screens.

---

## Current Status

WeekFlow is a working local MVP.

It supports task creation, goal creation, persistence, completion history, notes, priority, and goal linking.
