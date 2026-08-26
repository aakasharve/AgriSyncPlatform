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

## Doctrine Pointer (read before designing)

**Read `docs/AGRISYNC-DOCTRINE.md` before any architecture, schema, security, trust-ledger, correction, or data-provenance work.** It carries the LOCKED product principles (the Phase Rule, no fabricated numbers, attribution never changes reported quantity, creator ≠ data subject) and the reasoning rules behind them. Its `P` rules outrank a feature plan on matters of principle. Do not copy it here — pointer only, so the two cannot diverge.

For **Labour Management** work specifically, follow the reading order in that document's §6 before proposing anything.

## Cofounder OS Pointer

All decisions, plans, ADRs, specs, and agent memory live under `_COFOUNDER/` (private nested git repo). Read `_COFOUNDER/CLAUDE.md` next.

---

## Hard Rules (non-negotiable)

- No secrets in git (no `.env`, no API keys, no connection strings)
- No `dist/` in git
- No `--no-verify`
- No force-push to `main`
- **Signing:** local feature-branch commits need **not** be signed. GitHub signs the squash-merge
  into `main`, which is where signature provenance actually carries weight for a public repo.
  Do not claim a local commit is signed — `git log --format=%G?` returns `N` in this environment,
  and asserting otherwise is a false claim about verification. *(Founder decision 2026-08-08,
  replacing the previous unqualified "signed commits required", which had gone unmet since
  2026-05-26 and was carried three times without resolution.)*
- No `Class1.cs` placeholder files
- Repo is the source of truth — never suggest, propose, or change anything from a superficial glance, assumption, or doc claim; verify in the actual code first (Read / Grep / confirm the path). Prevents scope drift.

---

## Commit & PR Conventions

- Conventional Commits format (`feat:`, `fix:`, `chore:`, etc.)
- PR body must reference spec ID from `_COFOUNDER/specs/_active/`
- Never amend after push
- Branch: `main` for all app code

---

## Definition of Done for Any Change

- Spec referenced in `_COFOUNDER/specs/_active/` or `_shipped/`
- Tests added or updated
- Architecture tests pass (`dotnet test src/tests/AgriSync.ArchitectureTests/`)
- If AI prompt touched: version bumped in `_COFOUNDER/memory/prompt-registry.md` + golden-set delta computed
- Plan carries a **Change Surface** (DB / Backend / Frontend / Cross-cutting, each answered explicitly), tracked with binary `[ ]`/`[x]` tasks
- **Founder Acceptance Gate** cleared — founder verified via supplied pointers and ticked `[x]` — BEFORE any deployment step (code-complete ≠ approved)
- **Deployed + prod-proven** — a deployment step is `[x]` with prod evidence (`/version` SHA or HTTP status) and a `DEPLOYMENT_TRACKER.md` row (approved ≠ deployed; written ≠ live)

> Plan-authoring rules (the four sections above) live in `superpowers:writing-plans` and `_COFOUNDER/CLAUDE.md` → "Plan authoring under cofounder mode".
