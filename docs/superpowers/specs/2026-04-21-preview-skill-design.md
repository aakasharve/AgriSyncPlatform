# Design: /preview Skill — Seamless Web Preview for AgriSync

**Date:** 2026-04-21
**Status:** Approved
**Scope:** Local dev preview only. Deploy pipeline is out of scope (future `/deploy-pipeline` skill).

---

## Problem

Every time a web preview is requested, one or more of the following failures occur:
- Backend (`dotnet run`) not running when frontend preview loads
- Port conflict from a previous session — process still holding 3000 / 4001 / 4000 / 5048
- Multiple manual terminal steps required each time
- No single clickable link surfaced after startup

The skill eliminates all of these failure modes with a single `/preview` invocation.

---

## Skill Invocation

```
/preview
```

Skill type: **Rigid** — steps execute in fixed order, no deviation.

---

## Port Map

| Service | Port |
|---|---|
| Backend (ASP.NET Core) | 5048 |
| mobile-web (React + Vite) | 3000 |
| admin-web (React + Vite) | 4001 |
| marketing-web (Astro) | 4000 |
| PostgreSQL | 5433 (external, not managed by skill) |

---

## Full Flow

### Step 1 — Ask which client(s)

Skill presents a numbered menu:

```
Which client do you want to preview?
1. mobile-web (port 3000)
2. admin-web (port 4001)
3. marketing-web (port 4000)
4. mobile-web + admin-web
5. all three
```

User picks a number. Skill proceeds based on selection.
Backend is always started (required for mobile-web and admin-web; skipped only for marketing-web-only).

### Step 2 — Kill stale ports

For each port required by the selection, run:

```bash
# Windows
netstat -ano | findstr :<PORT>
# extract PID → taskkill /F /PID <PID>
```

If a stale process was killed, report it:
```
  Cleared stale process on port 4001 (PID 18234)
```
If port was already free, stay silent.

### Step 3 — Start backend (if required)

Launch `dotnet run --project src/AgriSync.Bootstrapper` as a background process.

Poll `http://localhost:5048/health` every 2 seconds, max 30 attempts (60s timeout).

- On 200 OK → proceed to Step 4
- On timeout → stop, report:
  ```
  Backend failed to start after 60s.
  Last error: <last stderr line>
  Check: Is PostgreSQL running on port 5433?
  ```
  Abort — do not open browser.

### Step 4 — Start frontend(s)

For each selected client, run `npm run dev` as a background process from the client directory.

Wait 3 seconds for Vite to initialize, then capture and echo the URL from Vite stdout.

### Step 5 — Print clickable links

```
  Preview ready:
  → admin-web     http://localhost:4001
  → mobile-web    http://localhost:3000
```

Links are printed as plain URLs so terminal renders them clickable.

### Step 6 — Wait for done signal

```
Done reviewing? (yes / keep running)
```

- `keep running` → return to this prompt after a pause
- `yes` → proceed to Step 7

### Step 7 — Teardown

Kill tracked PIDs in reverse order: frontends first, then backend.
Verify each port is free before reporting clean exit.

```
  Stopped: admin-web, backend
  Ports 4001, 5048 free.
```

### Step 8 — Deploy prompt

```
Deploy this change?
1. Deploy  →  (runs /deploy-pipeline skill when built)
2. Skip
```

- Option 1 → Print:
  ```
  Deploy pipeline not built yet.
  Next step: build the /deploy-pipeline skill.
  Target: AWS backend + shramsafal.in web + Android APK.
  ```
- Option 2 → Clean exit.

---

## Error Handling

| Failure | Response |
|---|---|
| Port occupied | Kill PID silently, report if killed |
| Backend health timeout | Abort with last stderr + DB hint |
| npm run dev fails | Report error, skip that client's link |
| PostgreSQL down | Caught via backend health timeout message |

---

## Out of Scope

- Android APK build and deploy
- AWS infrastructure deploy
- Marketing-web deploy (static Astro — different pipeline)
- Auto-detection of which client to preview (user always asked explicitly — reliable over inference)

---

## Future: /deploy-pipeline Skill

When built, this skill will cover:
- Backend deploy to AWS
- Web frontend deploy to shramsafal.in
- Android APK build + release

The `/preview` skill's deploy branch will invoke `/deploy-pipeline` once it exists.
