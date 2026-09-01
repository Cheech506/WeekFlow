# WeekFlow Current Architecture

## Overview

WeekFlow is currently a local-first productivity application built with React Native, Expo, and TypeScript. The application runs on mobile devices and can also be rendered in a web browser through Expo Web.

At this stage of development, WeekFlow does not use a backend server. The application's data is stored locally on the device using SQLite. The purpose of the capstone project is to take this existing local application and move it toward a self-hosted client/server architecture.

## Current Technology Stack

WeekFlow currently uses:

- React Native for the application interface.
- Expo as the development framework and tooling around React Native.
- TypeScript for application code and type checking.
- Expo Router for application navigation.
- React Context for shared application state.
- Expo SQLite for local persistent data storage.
- Jest for automated frontend and storage testing.
- Git and GitHub for version control.

## Current Application Structure

The application can be thought of as several layers:

User Interface
↓
React Context
↓
Storage Modules
↓
SQLite Database

### User Interface

The user interface contains the main WeekFlow screens such as:

- Goals
- Inbox
- Daily
- Weekly
- History
- Settings

Reusable components are also used throughout the application for task cards, filters, weekly reviews, goal information, empty states, and other interface elements.

## Navigation

Expo Router is used for file-based navigation.

The main tab screens are stored under the `app/(tabs)` directory. WeekFlow currently has five main tabs:

- Goals
- Inbox
- Daily
- Weekly
- History

Settings is opened separately from the main tab bar.

## Application State

React Context is used to manage shared application data.

Examples include:

- TaskContext
- GoalContext
- BrainDumpContext
- CycleContext
- WeeklyReviewContext
- CycleReviewContext

These contexts allow multiple screens to access and update the same application data without every screen maintaining its own separate copy.

## Storage Layer

WeekFlow separates database operations from the user interface through storage modules.

Examples include:

- taskStorage
- goalStorage
- brainDumpStorage
- recurringStorage
- cycleStorage
- weeklyReviewStorage

Instead of placing SQLite queries directly inside the screens, the interface calls functions from the context and storage layers.

For example, completing a task follows a flow similar to:

User presses Done
↓
TaskContext
↓
Task Storage
↓
SQLite Database
↓
TaskContext refreshes
↓
User interface updates

This separation makes the application easier to maintain and test.

## Current Database

WeekFlow currently uses SQLite through Expo SQLite.

The database contains information for features such as:

- Tasks
- Goals
- Goal milestones
- Brain Dumps
- Recurring task rules
- Planning cycles
- Weekly reviews
- Weekly commitments
- Cycle reviews
- Application metadata

SQLite works well for the current local-first version because the application can store and access its data without needing a network connection or server.

## Business Logic

Reusable business logic is separated from the screens when possible.

Examples include logic for:

- Date calculations
- Recurring task generation
- Goal progress
- Cycle calculations
- History filtering
- Backup validation
- Weekly review behavior

Keeping this logic separate from the interface makes it easier to reuse and test.

## Testing

WeekFlow currently uses Jest for automated testing.

The project contains unit tests for individual pieces of application logic and integration tests for storage and database behavior.

TypeScript is also checked with:

`npx tsc --noEmit`

This checks the project for type errors without creating a production build.

## Backup and Restore

Because WeekFlow currently stores its data locally, the application includes a backup and restore system.

WeekFlow can export its important application data and later import it again. This existing backup format may also be useful later when migrating current local WeekFlow data into the new PostgreSQL server.

## Current Limitation

The biggest limitation of the current architecture is that the SQLite database belongs to the device running WeekFlow.

This means the mobile application and web version do not currently share one centralized source of data.

The current architecture is approximately:

Mobile Application
↓
React Native
↓
React Context
↓
Storage Layer
↓
SQLite

## Capstone Transition

During the capstone, WeekFlow will move toward a self-hosted client/server architecture.

The final architecture will eventually look more like:

Mobile Application
↓
WeekFlow API
↓
FastAPI
↓
PostgreSQL

The web client will communicate with the same API and PostgreSQL database.

This will allow the mobile and browser clients to use the same centralized WeekFlow data while keeping the application self-hosted.
