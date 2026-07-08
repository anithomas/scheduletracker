# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Is

**Family Household Tracker** — a single-file (`index.html`) web app backed by Firebase for managing auto maintenance, home maintenance schedules, a family calendar, and financial reporting with tax calculations. No build step, no package manager.

## Running the App

Open `index.html` directly in a browser. Firebase credentials are hardcoded in the file (public Firebase config, not secrets). Sign in with a Google account. Data syncs in real-time via Firestore.

There are no build, lint, or test commands — the entire application is vanilla HTML/CSS/JS in one file.

## Architecture

Everything lives in `index.html` (~2536 lines):

- **Lines 1–25**: Firebase config constants and SDK imports
- **Lines 26–1189**: All CSS (including responsive breakpoints at `max-width: 768px` and `640px`)
- **Lines 1190–end**: All JavaScript as a single `<script>` block

**Firebase services used:**
- Firestore — primary data store (real-time `onSnapshot` listeners)
- Firebase Auth — Google Sign-In only
- Cloud Storage — receipt/invoice file uploads

**Firestore collections:**
- `autoRecords` — vehicle service history
- `homeItems` — home maintenance schedule items
- `events` — calendar events
- `settings/config` — app configuration (vehicles, members, categories, RBAC user list)

**Data flow:** Firestore listeners update in-memory arrays (`autoRecords`, `homeItems`, `events`) → render functions rebuild DOM via `innerHTML`.

**Global state:** `autoRecords`, `homeItems`, `events` (synced arrays), `appConfig`, `appVehicles`, `appMembers`, `homeCategories`, `serviceTypes`, `eventTypes`, `currentUserRole`.

## Key Code Sections (by line range)

| Lines | Responsibility |
|-------|----------------|
| 1204–1272 | Default config values & `loadConfig()` |
| 1758–1791 | Auth (`initAuth`, `checkUserAccess`, `applyRBAC`) |
| 1793–1814 | `startListeners()` — Firestore real-time subscriptions |
| 1816–1877 | Utilities: date formatting, color helpers |
| 1895–1964 | HST/tax calculator logic |
| 1966–1996 | File upload to Firebase Storage |
| 1998–2115 | Auto maintenance CRUD (`saveAuto`, `editAuto`, `delAuto`, `renderAuto`) |
| 2117–2222 | Home maintenance CRUD (`saveHome`, `editHome`, `delHome`, `renderHome`) |
| 2224–2341 | Calendar CRUD (`saveCal`, `editCal`, `delCal`, `renderCalendar`) |
| 2343–2514 | Reports (summary + filtered spend by vehicle/category/period) |
| 2516–2533 | Modal open/close utilities |

## Conventions

**Function naming:** `save*`, `edit*`, `del*`, `render*`, `open*`, `close*` prefixes (e.g., `saveAuto`, `renderHome`, `openModal`).

**CSS classes:** kebab-case (`stat-card`, `btn-primary`, `modal`). RBAC visibility is controlled via CSS classes `.rbac-admin`, `.rbac-add`, `.rbac-viewer` toggled by `applyRBAC(role)`.

**Dates:** Stored as `YYYY-MM-DD` strings in Firestore. `nextDate` is always calculated from `lastDate + durVal/durUnit`.

**Costs:** Pre-tax cost stored; tax rate stored separately (`taxRate` field, default 13% Ontario HST). Reports compute `total = cost * (1 + taxRate/100)`. A `totalOverride` field allows manual total entry.

**Attachments:** Legacy single `attachmentUrl` field; new records use `attachmentUrls: string[]`. Both must be handled in render functions.

## RBAC

Four roles: `admin`, `contributor`, `viewer`, `denied`. The first Google account to sign in auto-bootstraps as admin. Role assignments live in `settings/config.authorizedUsers`. `applyRBAC()` adds/removes CSS classes on the `<body>` to show/hide UI elements per role.

## Firestore Document Shape

**autoRecords:**
```
vehicleId, vehicle, service, lastDate, nextDate, mileage (km),
kmInterval, nextMileage, cost, taxRate, totalOverride?,
durVal, durUnit ('days'|'months'|'years'), notes,
attachmentUrl (legacy)?, attachmentUrls[], updatedBy, updatedAt
```

**homeItems:**
```
item, category, freq (days), durVal, durUnit, lastDate, nextDate,
cost, taxRate, totalOverride?, notes,
attachmentUrl (legacy)?, attachmentUrls[], updatedBy, updatedAt
```

**events:**
```
title, date, endDate?, time (HH:MM 24h), type, member,
location, notes, updatedBy, updatedAt
```

**settings/config:**
```
appName, logoEmoji, defaultTaxRate, currency,
vehicles[], members[], homeCategories[], serviceTypes[],
eventTypes[{value, emoji, label}], authorizedUsers[], updatedAt
```
