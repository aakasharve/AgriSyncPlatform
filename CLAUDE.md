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

## Branching Model (hard) — trunk-based, weekly review

*(Founder decision 2026-08-28; lifetime rule changed 2026-10-24: no fixed time
limit, weekly review instead.)*

**One product truth (`main`) plus branches around it.**

- `main` is the latest integrated, working ShramSafal. Everything starts from it:
  **cut every branch from `origin/main`, never from a local working tree.**
- A branch is a workspace, not a second version of the product. Name new ones
  `task/<short-thing>`. Merge as soon as the work is coherent, then delete the
  branch. Rebase on `origin/main` before final verification.
- **There is no fixed time limit on a branch.**
- **Once a week, review the full branch list** (`git branch -a`, open PRs and
  worktrees). The founder decides for each branch: **keep** (active work),
  **park** (deliberately held; labelled and written down with what unblocks it)
  or **delete**. Deleted branches are backed up first. A parked branch is a
  decision, not a defect.
- Nothing is deleted, merged, pushed or deployed without the founder's explicit
  yes for that specific item.
- **Worktrees are for isolation only.** Remove one when its branch is merged,
  deleted or parked. Stop its dev servers first: a leftover Vite/Bootstrapper
  process locks the directory.

### Two classes of change — different speed, same safety floor

Pre-pilot (no real farmers yet), optimize for learning speed, not ceremony:

| Class | Examples | Process |
|---|---|---|
| **Normal product change** | screens, onboarding, Marathi copy, navigation, small features, workflow experiments | branch → build → targeted tests → merge → deploy. No heavy test ceremony unless the area demands it. |
| **Trust-critical change** | DB schema/migrations, auth, cross-farm access, RLS, sync, financial calculations, deletion/retention, permissions, server authority, consent/privacy, offline data safety | branch **and** the full stronger test set before merge. Non-negotiable regardless of stage. |

The speed relaxation applies **only** to reversible product decisions. The
irreversible trust/data invariants stay strict. When unsure which class a change
is in, treat it as trust-critical.

---

## Commit & PR Conventions

- Conventional Commits format (`feat:`, `fix:`, `chore:`, etc.)
- Subject line **max 72 chars** (`commit-msg` hook enforces it)
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
