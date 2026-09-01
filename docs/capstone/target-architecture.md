# WeekFlow Target Architecture

## Overview

The goal of the WeekFlow capstone is to move the application from a local-only architecture into a self-hosted client/server system.

The current version of WeekFlow stores its data locally in SQLite on the device. This works well for one device, but it makes it difficult for the mobile application and browser version to share the same data.

The new architecture will introduce a centralized WeekFlow server that both the mobile and web clients can connect to.

## Target Architecture

The planned architecture is:

Mobile Application
        |
        v
   WeekFlow API
        |
        v
     FastAPI
        |
        v
   PostgreSQL
        ^
        |
   Web Client

Both the mobile application and browser client will communicate with the same FastAPI backend.

The FastAPI backend will become the layer responsible for validating requests, applying server-side logic, and communicating with PostgreSQL.

## Mobile Client

The mobile application will continue to use React Native, Expo, and TypeScript.

The existing WeekFlow interface and features will remain largely the same, but the way data is stored will change.

Instead of all important data being written directly to SQLite, the mobile client will eventually communicate with the WeekFlow API.

The general flow will become:

React Native Screen
        |
        v
React Context
        |
        v
API Client
        |
        v
FastAPI
        |
        v
PostgreSQL

SQLite may still be used later as a local cache or for offline functionality, but PostgreSQL will become the main centralized source of data.

## Web Client

WeekFlow already supports web rendering through Expo and React Native Web.

The existing web client will be updated so that it also communicates with the WeekFlow API instead of relying on local-only data.

The browser interface will also need additional responsive layout work because the current interface is mainly designed around mobile screen sizes.

The web client should eventually allow the same core WeekFlow actions as the mobile application, including managing tasks, goals, planning cycles, and history.

## FastAPI Backend

The backend will be written in Python using FastAPI.

FastAPI will provide REST API endpoints that the mobile and web clients can use.

Examples of future API routes include:

GET /api/v1/tasks
POST /api/v1/tasks
PATCH /api/v1/tasks/{id}
DELETE /api/v1/tasks/{id}

Similar endpoints will eventually exist for goals, Brain Dumps, planning cycles, milestones, recurring tasks, and reviews.

The backend will also handle authentication, validation, database access, and server-side business logic.

## PostgreSQL Database

PostgreSQL will be used as the main server database.

The current SQLite schema will be used as a starting point when designing the PostgreSQL schema.

Server-side tables will include data such as:

- Users
- Tasks
- Goals
- Goal milestones
- Brain Dumps
- Recurring task rules
- Planning cycles
- Weekly reviews
- Weekly commitments
- Cycle reviews

PostgreSQL will allow both the mobile and browser clients to work with one centralized source of data.

## Authentication

The first version of the self-hosted server will use a single-owner account model.

When a WeekFlow server is first installed, the owner will create an account.

The mobile and web clients will then authenticate with the server before accessing WeekFlow data.

Passwords will not be stored directly. The backend will store secure password hashes and use authenticated API requests.

## Server Connection

The mobile application will eventually allow the user to enter the address of their own WeekFlow server.

For example:

http://weekflow-server:8000

or

https://weekflow.example.com

The application will contact the server, verify that it is a compatible WeekFlow server, and then allow the user to authenticate.

This will allow WeekFlow to remain self-hosted rather than depending on a centrally operated cloud service.

## Docker Deployment

The server will eventually be deployed using Docker Compose.

The planned Docker environment will include at least:

- WeekFlow API container
- PostgreSQL database container

The web application may also be included as part of the Docker deployment later in the project.

Docker will make the server easier to install, update, and run on different systems.

## Data Migration

Existing WeekFlow users may already have data stored locally in SQLite.

The current WeekFlow backup and restore system will be evaluated as a possible migration method.

A future migration flow could look like:

Existing SQLite Data
        |
        v
WeekFlow Backup
        |
        v
Server Import
        |
        v
PostgreSQL

This will allow existing tasks, goals, Brain Dumps, and planning information to move into the new server instead of requiring the user to start over.

## Testing

Testing will continue throughout the capstone.

The React Native application will continue using Jest and TypeScript checks.

The backend will use Python testing tools such as pytest.

Later testing will also cover:

- API endpoints
- PostgreSQL operations
- Authentication
- Mobile-to-server communication
- Web-to-server communication
- Docker deployment
- Data migration
- Server failure and reconnection behavior

## Final Goal

The final goal is for WeekFlow to operate as a self-hosted full-stack application.

The user should be able to run the WeekFlow server on their own computer or home server, connect to it using the installed mobile application, and access the same data through a web browser.

The final architecture will be approximately:

               WeekFlow Server
        ---------------------------
        |        FastAPI          |
        |           |             |
        |       PostgreSQL        |
        ---------------------------
             ^             ^
             |             |
        Mobile App      Web Client
