# AgriSyncPlatform

![CI](https://github.com/agrisync/agrisync/actions/workflows/build.yml/badge.svg) *(CI workflow coming in Week 3)*

AgriSync is a voice-first farm operations platform for smallholder farmers. Farmers speak in Marathi; AI structures the record; farmers own their data. Built for offline-first mobile use, connected when available.

## Repository Layout

```
AgriSyncPlatform/
├── src/
│   ├── AgriSync.Bootstrapper/      # Single executable — wires all apps together
│   ├── AgriSync.SharedKernel/      # Zero-dependency contracts and IDs
│   ├── AgriSync.BuildingBlocks/    # Cross-cutting: JWT, EF, Result<T>
│   ├── apps/
│   │   ├── User/                   # Auth, phone-based identity, memberships
│   │   │   ├── User.Domain/
│   │   │   ├── User.Application/
│   │   │   ├── User.Infrastructure/
│   │   │   └── User.Api/           # Library (not runnable)
│   │   └── ShramSafal/             # Farm operations bounded context
│   │       ├── ShramSafal.Domain/
│   │       ├── ShramSafal.Application/
│   │       ├── ShramSafal.Infrastructure/
│   │       └── ShramSafal.Api/     # Library (not runnable)
│   ├── clients/
│   │   ├── mobile-web/             # React 19 + Vite PWA (offline-first)
│   │   └── marketing-web/          # Astro 4 + React islands
│   └── tests/
│       ├── AgriSync.ArchitectureTests/
│       ├── ShramSafal.Domain.Tests/
│       └── ShramSafal.Sync.IntegrationTests/
└── .github/workflows/
    └── dotnet-ci.yml               # Build + test on push/PR to main
```

## Architecture

**Backend** follows Clean Architecture. Dependency direction is strictly:

```
Domain → Application → Infrastructure → Api → Bootstrapper
```

- `SharedKernel` has zero dependencies (pure value types and IDs)
- `BuildingBlocks` provides JWT helpers, EF base types, and `Result<T>`
- `Api` projects are class libraries — only `AgriSync.Bootstrapper` is an executable
- Database: PostgreSQL 16 on port 5433, database `agrisync`, schemas `public` (User) and `ssf` (ShramSafal)

**Frontend** (`mobile-web`) is an offline-first PWA:

- React 19 + Vite + TypeScript
- Dexie (IndexedDB) for local storage and outbox queue
- Push/pull sync with idempotency keys
- Voice logging via Sarvam AI (STT) + Gemini (structured extraction)

## Prerequisites

| Tool | Version |
|------|---------|
| .NET SDK | 10.0.x |
| Node.js | 20+ |
| pnpm | 9+ |
| PostgreSQL | 16 |

## How to Run Locally

See `_COFOUNDER/runbooks/` for full setup instructions (runbook coming in Week 3). Quick start:

```bash
# Backend (requires PostgreSQL 16 on port 5433, database `agrisync`)
cd src
dotnet run --project AgriSync.Bootstrapper
```

```bash
# Frontend
cd src/clients/mobile-web
pnpm install && pnpm dev
```

The API starts on `https://localhost:7001`. On first run it seeds demo data automatically.

### Database setup

```bash
psql -U postgres -c "CREATE DATABASE agrisync;"
```

### Backend configuration

Copy the example config and fill in your local Postgres password:

```bash
cp src/AgriSync.Bootstrapper/appsettings.Development.example.json \
   src/AgriSync.Bootstrapper/appsettings.Development.json
# Edit the file and replace CHANGE_ME with your local Postgres password
```

## Running Tests

```bash
# Unit + architecture tests
dotnet test src/AgriSync.sln --configuration Release

# TypeScript type-check
cd src/clients/mobile-web && npx tsc --noEmit
```

## Seed Data

The bootstrapper seeds a demo farm on first run:

| User | Phone | Password | Role |
|------|-------|----------|------|
| Ramu Patil | 9999999999 | ramu123 | Primary Owner |
| Ganesh Mukadam | 8888888888 | ganesh123 | Mukadam |

6 plots (Grapes, Pomegranate, Sugarcane, Onion) with 48 logs, 111 tasks, 24 cost entries, and 32 verifications.

## How to Contribute

Read `_COFOUNDER/CLAUDE.md` for agent protocols. All code changes require a spec in `_COFOUNDER/specs/_active/` first. No spec, no PR.

## CI

GitHub Actions runs on every push and pull request to `main` — see [`.github/workflows/dotnet-ci.yml`](.github/workflows/dotnet-ci.yml).

## License

Proprietary. All rights reserved. Not open source.
