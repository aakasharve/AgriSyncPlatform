# CLAUDE.md — AgriSync Platform Agent Protocol

> This file is the single source of truth for ALL agents working in this repository.
> Read it fully before taking any action. The rules here are enforced by the stop hook and the conflict-resolver agent.
>
> Full operational protocols live in the local `_COFOUNDER/` vault (not committed).
> This file is the committed, always-available subset every agent must know.

---

## §1 — Activation Phrases (Skill Triggers)

When the user says any of the phrases below, invoke the matching skill **immediately** using the Skill tool — before generating any other response or taking any action.

Matching is **case-insensitive and partial**. "let's do co founder mode", "can we activate the skills", or "run the review" all match.

| User Says | Skill to Invoke | Effect |
|-----------|-----------------|--------|
| "activate co founder mode" | `/co-founder-mode` | Full 8-agent production review pipeline |
| "co-founder mode" | `/co-founder-mode` | Full 8-agent production review pipeline |
| "utilize skills" | `/co-founder-mode` | Full 8-agent production review pipeline |
| "run review pipeline" | `/co-founder-mode` | Full 8-agent production review pipeline |
| "production review" | `/co-founder-mode` | Full 8-agent production review pipeline |
| "run build doctor" | `/build-doctor` | Fix all compilation errors |
| "run security review" | `/security-hardener` | Audit and harden all security surfaces |
| "run arch review" | `/arch-reviewer` | Audit Clean Architecture violations |
| "clean the repo" | `/repo-cleanup` | Remove build artifacts, fix .gitignore |
| "run test audit" | `/test-auditor` | Identify and write critical missing tests |
| "enforce ci" | `/cicd-enforcer` | Harden CI/CD pipeline |
| "run perf audit" | `/perf-analyzer` | Find and fix scalability bottlenecks |
| "resolve conflicts" | `/conflict-resolver` | Final cross-agent conflict resolution |
| "reset co founder mode" | (reset state) | Clear review-state.json, restart pipeline |

---

## §2 — Project Identity

| Field | Value |
|-------|-------|
| **Project** | AgriSync Platform |
| **Type** | Agricultural logistics SaaS — mobile-first, offline-capable, AI-integrated |
| **Status** | Pre-launch — functionally working, hardening in progress |
| **Owner** | aakasharve |
| **Git branch** | `claude/add-agrisync-repo-link-4Z7iQ` |
| **Repo** | https://github.com/aakasharve/AgriSyncPlatform |

**Tech stack summary:**
- Backend: .NET 10, ASP.NET Core Minimal API, EF Core 10, PostgreSQL
- Auth: JWT Bearer tokens
- AI: Google Gemini API, Sarvam AI (speech-to-text, NLP)
- Storage: AWS S3 (prod), local filesystem (dev)
- Frontend: React 19, TypeScript strict, Vite 6, Tailwind CSS 3.4
- Mobile: Capacitor 8 (Android/iOS), offline-first via Dexie + custom sync engine
- Logging: Serilog (console + file sinks)
- Tests: xUnit — 3 projects (ArchitectureTests, DomainTests, SyncIntegrationTests)
- CI/CD: GitHub Actions (`.github/workflows/dotnet-ci.yml`)

**Monorepo layout:**
```
/src
  AgriSync.sln                    .NET solution (12 projects)
  AgriSync.Bootstrapper/          API host, DI wiring, database seeding
  AgriSync.BuildingBlocks/        Shared infrastructure patterns
  AgriSync.SharedKernel/          Cross-app contracts, DTOs, roles, reference data
  apps/
    ShramSafal/                   Agricultural logistics domain (Domain/Application/Infrastructure/API)
    User/                         Auth and identity domain (Domain/Application/Infrastructure/API)
  clients/
    mobile-web/                   React + Capacitor mobile web app
    marketing-web/                Astro marketing site (stub, not yet deployed)
  tests/
    AgriSync.ArchitectureTests/
    ShramSafal.Domain.Tests/
    ShramSafal.Sync.IntegrationTests/
```

---

## §3 — Git Protocol

**Working branch:** `claude/add-agrisync-repo-link-4Z7iQ`

All commits go to this branch. Push via:
```bash
git push -u origin claude/add-agrisync-repo-link-4Z7iQ
```

**Rules:**
- Never push to `main` or any other branch without explicit permission
- Never use `--force`, `--no-verify`, or `--no-gpg-sign`
- Never amend a published commit — create a new one
- The stop hook blocks session end if there are unpushed commits — do not work around it

**Push retry policy (network errors only — not 403):**
Retry up to 4 times: wait 2s → 4s → 8s → 16s. Report after 4 failures.

**Commit message format:**
```
<type>: <short imperative description (under 70 chars)>

- <what changed, one bullet per file or concern>
- <why this change was needed>

<AGENT-NAME>: <brief checkpoint note>
```

Types: `fix` `feat` `security` `arch` `test` `perf` `ci` `chore` `refactor`

**Never commit:**
- Files matching `.gitignore` (especially: `*.log`, `*.txt` debug dumps, `.claude/`, `_COFOUNDER/`)
- Hardcoded secrets or credentials
- `node_modules/`, `bin/`, `obj/`, `dist/`
- IDE files (`.vs/`, `.idea/`, `.vscode/`)

---

## §4 — Clean Architecture Rules

These rules are law. The `/arch-reviewer` agent enforces them. Never write code that violates them.

```
ALLOWED dependency directions:
  API              → Application → Domain           ✅
  Infrastructure   → Application → Domain           ✅
  BuildingBlocks   → any layer                      ✅
  SharedKernel     → any layer (read-only DTOs)     ✅
  Bootstrapper     → everything (DI wiring only)    ✅

FORBIDDEN:
  Domain           → Application or Infrastructure   ❌  (domain is innermost)
  Application      → Infrastructure                  ❌  (use ports/interfaces)
  ShramSafal       → User.Domain                     ❌  (use SharedKernel.CrossAppEvents)
  BuildingBlocks   → any domain app (ShramSafal, User) ❌
```

---

## §5 — Review Pipeline

The co-founder-mode skill runs 8 agents in this wave structure:

```
WAVE 1  (sequential — blocking)
  /build-doctor            Fix all compilation errors. Nothing else starts until DONE.

WAVE 2  (logical parallel — run one after another, each is independent)
  /security-hardener       Secrets, JWT, CORS, auth gates, file uploads, AI key exposure
  /arch-reviewer           Layer violations, DDD correctness, sync resilience, AI robustness
  /repo-cleanup            Delete committed artifacts, strengthen .gitignore
  /cicd-enforcer           Automate CI triggers, health checks, migration safety, env docs

WAVE 3  (logical parallel — needs arch-reviewer DONE before starting)
  /test-auditor            Write critical tests: finance, planning, AI parsing, sync
  /perf-analyzer           N+1 queries, missing indexes, AI blocking, bundle size, cache

WAVE 4  (sequential — blocking — always last)
  /conflict-resolver       Merge all agent changes, verify final build, push, produce report
```

**The conflict-resolver is the only agent that pushes to remote.**
All other agents commit locally only.

---

## §6 — Shared Agent State

All agents communicate through a local ephemeral state file:

```
/home/user/AgriSyncPlatform/.claude/review-state.json
```

This file is **not committed to git** (`.claude/` is gitignored per §1 of `.gitignore`).
It is created fresh by `/co-founder-mode` at pipeline start and lives only for the session duration.

**State protocol:**
1. Check if the file exists before reading it
2. Update only your own agent's top-level key
3. Never overwrite another agent's section
4. Set `status` to `"in_progress"` when you start, `"done"` or `"blocked"` when you finish

**Initialize if missing:**
```bash
mkdir -p /home/user/AgriSyncPlatform/.claude
cat > /home/user/AgriSyncPlatform/.claude/review-state.json << 'EOF'
{
  "build-doctor":       { "status": "pending", "backend_errors": [], "frontend_errors": [], "fixed": [], "unresolved": [], "completed_at": "" },
  "security-hardener":  { "status": "pending", "findings": [], "unresolved": [], "completed_at": "" },
  "arch-reviewer":      { "status": "pending", "findings": [], "layer_violation_count": 0, "completed_at": "" },
  "repo-cleanup":       { "status": "pending", "deleted": [], "moved": [], "gitignore_additions": [], "completed_at": "" },
  "test-auditor":       { "status": "pending", "coverage_gaps": [], "tests_written": 0, "completed_at": "" },
  "cicd-enforcer":      { "status": "pending", "findings": [], "workflows_created": [], "workflows_modified": [], "completed_at": "" },
  "perf-analyzer":      { "status": "pending", "findings": [], "completed_at": "" },
  "conflict-resolver":  { "status": "pending", "agents_reviewed": [], "conflicts_found": [], "conflicts_resolved": [], "conflicts_unresolvable": [], "final_build_status": "", "production_ready": false, "blockers_remaining": [], "completed_at": "" }
}
EOF
```

---

## §7 — Severity Levels

All agents use this consistent severity scale:

| Level | Meaning | Required Action |
|-------|---------|-----------------|
| **[BLOCKER]** | Prevents launch — any user will hit this | Fix immediately in current session |
| **[HIGH]** | Will cause real pain within first week live | Fix in current session |
| **[MEDIUM]** | Will slow growth or development | Document, defer to post-launch sprint |
| **[LOW]** | Best practice gap | Document, add to backlog |

---

## §8 — Finding ID Format

| Agent | Prefix | Example |
|-------|--------|---------|
| build-doctor | `BUILD-` | `BUILD-001` |
| security-hardener | `SEC-` | `SEC-003` |
| arch-reviewer | `ARCH-` | `ARCH-007` |
| repo-cleanup | `CLEAN-` | `CLEAN-002` |
| test-auditor | `TEST-` | `TEST-012` |
| cicd-enforcer | `CICD-` | `CICD-004` |
| perf-analyzer | `PERF-` | `PERF-009` |
| conflict-resolver | `CONF-` | `CONF-001` |

Conflict findings: append `-CONFLICT` (e.g., `ARCH-003-CONFLICT`).
Bugs discovered by tests: append `-BUG` (e.g., `TEST-007-BUG`).

---

## §9 — Conflict Resolution Authority

When two agents disagree on how a file should look, this priority order decides:

```
1. Correctness   — version that makes all tests pass
2. Security      — security-hardener constraints override everything else
3. Architecture  — arch-reviewer layer decisions override cosmetic changes
4. Build         — build-doctor baseline is what all other changes build on
5. Performance   — perf-analyzer changes are additive, never structural
6. Cleanup       — repo-cleanup is lowest priority (only deletes/moves)
```

`/conflict-resolver` is the final arbiter. Its decisions are final.

---

## §10 — Hard Rules (Never Violate)

These apply to every agent in every session:

- Never push to `main` or any branch other than the designated working branch
- Never delete source code files (only artifact/log files may be deleted by repo-cleanup)
- Never use `--no-verify`, `--force`, or `--no-gpg-sign` on git operations
- Never use `as any` or `: any` to silence TypeScript errors
- Never use `.Result` or `.Wait()` on async operations in C# (causes deadlocks under load)
- Never call `Database.EnsureCreated()` outside of test projects
- Never call `Database.Migrate()` on application startup in production (must be environment-gated)
- Never expose secrets or API keys in frontend bundles (no secrets with `VITE_` prefix)
- Never hardcode credentials in any `appsettings*.json` file
- Never commit files from `§1` through `§9` of `.gitignore`
- Never create markdown documentation files unless explicitly requested

---

## §11 — Known Baseline Issues

These exist before the review pipeline runs. The assigned agent owns each fix.

| Issue | Owner | Severity |
|-------|-------|----------|
| CS0234: `User.Domain.Entities` namespace missing in `DatabaseSeeder.cs` | `/build-doctor` | BLOCKER |
| 41 TypeScript compilation errors in `mobile-web` | `/build-doctor` | BLOCKER |
| GitHub Actions CI only triggers on manual dispatch | `/cicd-enforcer` | BLOCKER |
| Hardcoded password in `appsettings.Development.json` | `/security-hardener` | HIGH |
| Committed error dump files (`errors.txt`, `tsc_errors.txt`, `build_log.txt`) | `/repo-cleanup` | HIGH |
| No `README.md` architecture overview or setup guide | (out of scope) | LOW |

---

## §12 — Session Start Checklist

Every new session on this project must run these checks before accepting work:

```bash
# 1. Confirm correct branch
git branch --show-current
# Expected: claude/add-agrisync-repo-link-4Z7iQ

# 2. Check for uncommitted changes from previous sessions
git status --short

# 3. Confirm review-state file (created fresh if missing)
test -f /home/user/AgriSyncPlatform/.claude/review-state.json \
  && echo "review-state: ok" \
  || echo "review-state: missing — will be created by co-founder-mode"
```

If on wrong branch: do not proceed — report to user and wait for instruction.
If uncommitted changes exist: report them, do not auto-commit or stash without user awareness.
