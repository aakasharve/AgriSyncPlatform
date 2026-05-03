# AgriSync — voice-first farm operations platform for smallholder farmers.

---

## Stack Inventory

- **Backend**: .NET 10.0, Clean Architecture, bounded contexts (User, ShramSafal)
  - Projects: Domain / Application / Infrastructure / Api per context; only Bootstrapper is executable
- **Frontend**: React 19 + TypeScript + Vite, Dexie offline storage, Zod schemas
- **AI**: Gemini 2.0 Flash (browser, via `GeminiClient.ts`), `VoiceParserPort` abstraction
- **Marketing**: Astro 4 + React islands + Tailwind + GSAP + Remotion
- **DB**: PostgreSQL 16, port 5433, `agrisync` database, schemas: `public` (User), `ssf` (ShramSafal)

---

## Layering Rules (hard)

- Domain may NOT import Infrastructure or Api
- SharedKernel has zero dependencies (pure types only)
- BuildingBlocks may use SharedKernel only
- Frontend `domain/` may NOT import `infrastructure/` or `pages/`
- Cross-context communication via SharedKernel events only — no direct service-to-service imports

---

## Cofounder OS Pointer

All decisions, plans, ADRs, specs, and agent memory live under `_COFOUNDER/` (private nested git repo). Read `_COFOUNDER/CLAUDE.md` next.

---

## Hard Rules (non-negotiable)

- No secrets in git (no `.env`, no API keys, no connection strings)
- No `dist/` in git
- No `--no-verify`
- No force-push to `main`
- Signed commits required
- No `Class1.cs` placeholder files

---

## Commit & PR Conventions

- Conventional Commits format (`feat:`, `fix:`, `chore:`, etc.)
- PR body must reference spec ID from `_COFOUNDER/specs/_active/`
- Never amend after push
- Branch: `akash_edits` for all app code

---

## Definition of Done for Any Change

- Spec referenced in `_COFOUNDER/specs/_active/` or `_shipped/`
- Tests added or updated
- Architecture tests pass (`dotnet test src/tests/AgriSync.ArchitectureTests/`)
- If AI prompt touched: version bumped in `_COFOUNDER/memory/prompt-registry.md` + golden-set delta computed
