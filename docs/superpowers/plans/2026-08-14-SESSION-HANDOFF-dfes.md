# Session Handoff — DFES Companion, 2026-08-14

**Read this first, then the plan.** This file is the entry point for a fresh session. It carries
state, guardrails and traps. The plan carries the work.

- **Plan (the work, task by task):** `docs/superpowers/plans/2026-08-14-dfes-farmer-facing-deploy-readiness.md`
- **Doctrine (read before any architecture/schema/provenance decision):** `docs/AGRISYNC-DOCTRINE.md`
- **Cofounder OS:** `_COFOUNDER/CLAUDE.md`

---

## 1. Where the work stands

| | |
|---|---|
| **Worktree** | `e:\APPS\Running App Versions\AgriSyncPlatform\.claude\worktrees\dfes-companion` |
| **Branch** | `feat/dfes-companion` |
| **HEAD** | `83702ed1` |
| **vs `origin/main`** | **64 ahead, 0 behind** |
| **Pushed?** | **No.** Never pushed. Do not push. |
| **Merged?** | No. Merge verdict in the branch manifest is still `NO` — founder-only to flip. |
| **Deployed?** | No. |

**What this branch is:** Track C of the AI-Intelligence plan — the farmer-facing DFES / Shram Sathi
companion. Tracks A (`AiResponseNormalizer`) and B (`LedgerDerivationService`) are **already on
`main`**, deployed with flags off. Verified, not assumed.

**Production is awake** (checked 2026-08-14): `api.shramsafal.in/health` → 200, `app.shramsafal.in`
→ 200. The older "prod hibernated" memory is stale.

### Commits made this session

| SHA | What |
|---|---|
| `ac911fdc` | `feat(dfes)`: `AnsweredGap` — a farmer's gap answer as a scoreable fact. **21 tests green.** |
| `83702ed1` | `docs(dfes)`: the plan + Task 0 verdict + founder rulings |

### Uncommitted, deliberately left alone

Three modified `.snap` snapshot files and ~11 untracked demo/preview files under
`src/clients/mobile-web/` (`reveal-demo.*`, `shramsathi-demo.*`, `preview-workflow.*`,
`after-save.png`, two `vite.*.config.ts`). These are session scratch from earlier UI work.
**Do not commit or delete them without asking the founder.**

---

## 2. THE BLOCKING DEFECT — read this before touching anything

> **A manual-entry day cannot score. The farmer types his whole day and is told ०/१०.**

This is settled with **both** database and code evidence. It is Task 0b in the plan and it outranks
every other task.

### Code cause

`ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs:32-45` is the
**sole** writer of `labour_assignments`, `irrigation_entries` and `machinery_usages`:

```csharp
public async Task<DerivationOutcome> DeriveAsync(
    DailyLog log, AiJob sourceJob, ...)                          // :33  requires an AI job
{
    ArgumentNullException.ThrowIfNull(sourceJob);                // :36
    if (string.IsNullOrWhiteSpace(sourceJob.NormalizedResultJson)) ... // :40 bails
    using var doc = JsonDocument.Parse(sourceJob.NormalizedResultJson); // :45 the ONLY source
```

A manual entry has **no AI job**. So nothing is written → `PersistedDayRootBuilder` finds nothing →
`DfesLensExtractor` has neither an AI root nor a persisted root → `UnaccountedDay`, score 0.

### Database evidence (live `agrisync_dfes`)

```
date       | log      | src    | tasks | labour | irrig | mach
2026-08-14 | b84a7c2a | manual |   0   |   0    |   0   |  0     (x8 on this date)
2026-08-13 | 5f09a0af | voice  |   0   |   1    |   0   |  0
2026-08-13 | 6aea90f0 | manual |   0   |   0    |   0   |  0
2026-08-13 | cf42b94b | voice  |   0   |   1    |   0   |  0
```

And the aggregate for today: `2026-08-14 | exec 0 | ins 0 | UnaccountedDay | has_work = f`.

### ⚠️ TRAP — this was flip-flopped twice. Do not re-litigate it.

The original claim ("manual entry persists nothing") was **RIGHT**. A later correction called it
wrong, reasoning from two facts that are **both true**:

- the client *does* send the complete draft — `CreateLog.ts:59-69`, `draft: input.formData`
- the scorer *does* read persisted children for every log — `DailyRichnessDerivationService.cs:93-102`

The conclusion was still false, because **nothing on the server converts a manual draft into those
children.** The 2026-08-13 task-7 fix widened what the scorer *reads*; it never created anything for
it to read on the manual path. If you find yourself about to "correct" this again, re-read this
section first.

### Intended fix (Task 0b) — reuse, do not duplicate

`CreateDailyLogHandler.cs:539-543` already names the AI wire arrays:
`labour, inputs, irrigation, observations, plannedTasks, cropActivities, machinery, activityExpenses`.
The manual draft built at `ManualEntry.tsx:261` uses **the same bucket names**. So normalise the
manual draft into that same wire shape and feed the existing `DeriveAsync` — every persistence path
is reused unchanged.

**Two hard constraints:**
1. **Provenance (`P8`).** The synthetic job must declare itself **manual**. Never a model version,
   prompt version or extractor SHA. A hand-typed figure must stay distinguishable from an inferred
   one, forever.
2. **No-multiply (`P4`).** A labour row with no explicitly entered total gets none. Do not multiply
   a rate by hours. Copy only what the farmer actually typed.

---

## 3. Founder rulings — 2026-08-14 (binding)

| # | Ruling | Consequence |
|---|---|---|
| **A** | **Answering Sathi's question must raise the day's score.** | Tasks 1–4. `AnsweredGap` shipped (`ac911fdc`). |
| **1** | **Pilot to 10–20 personally chosen farmers.** Shared-handset exposure is **out of scope by segment**: *"this does not happen that a farmer shares phone — if that is the case we are not building this app for them."* | **Accepted risk, NOT fixed.** Code path unchanged. Re-opens as a blocker if FPO/FPC or shared devices are ever targeted. |
| **2** | **Honest no-work days: no score, but keep consistency.** *"Reward honesty and mark its consistency — no score needed for such days."* | **Mostly already built** — `RichnessStamper.cs:45-54` sets `AdvancesBar: false`; `StreakRules.cs:15` (`AdvanceOnDeclaredNoWork: true, NeutralOnRestDay: true`) advances the streak on an external blocker and stays neutral on a rest day. **What's broken** is the pull erasing the declaration — `logsReconciler.ts:186` hardcodes `dayOutcome: 'WORK_RECORDED'`. Task 5 + Task 6. |
| **3** | **Agronomist gate REMOVED.** A real agronomist in the founder's contact reshaped the 12 questions; treat them as genuine. **New requirement: questions must be context-rich**, wired to weather and the previous log. | Sign-off task deleted. Task 7 added. |
| **4** | **Calibration sitting happens AFTER the pilot starts.** | Until then the target `9` is an **engineering guess** and must be described that way in any founder-facing report. |

### On ruling 3 — what is actually missing

The engine **already receives** weather, crop stage, a schedule gap, an open observation and a
weather-reconcile signal (`dfesQuestionEngine.ts:61-75`) and uses them to **choose** the question.
But `resolvePrompt` (`:107-112`) substitutes only `{crop}`, `{observation}`, `{category}`. Weather is
packed into `SelectedQuestion.weatherContext` (`:119`) and **never reaches the farmer's ear**. There
is **no previous-log input at all**. The founder's observation was precise.

Task 7 builds the mechanism. **The Marathi rewrite is founder + agronomist work** — draft the 16
prompts to `G:\VALIDATION\shram-sathi-context-rich-prompts.md` and stop there.

---

## 4. Environment — the traps that cost time

### Database

| | |
|---|---|
| **DFES database** | **`agrisync_dfes`** on `localhost:5433` |
| ❌ Not | `agrisync_dev` (stale) or `agrisync_dev_v2` (**has no DFES migration** — `ssf.daily_richness_aggregates` does not exist there) |
| **Trap** | This worktree's `appsettings.Development.json` points at the stale `agrisync_dev`. |
| **Credentials** | `_COFOUNDER/Agrisync_Credentials/CREDENTIALS.md` — founder-authorised route |
| **psql** | `/c/Program Files/PostgreSQL/16/bin/psql.exe` |

**Schema notes that cost time:** the `Id` column is **quoted and capitalised** (`l."Id"`, not `l.id`).
`daily_richness_aggregates` has `execution_score / insight_score / learning_score` — there is **no**
single `score` column; the `/10` is derived by `DayUnderstandingScore`. Child tables are
`log_tasks`, `labour_assignments`, `irrigation_entries`, `machinery_usages`, `observation_events`,
`disturbance_events`.

### 🛑 Standing prohibitions

- **Never modify `pg_hba.conf`.** Never flip local auth to `trust`, not even briefly.
- **Never print a credential value.** Redact on **value position**, not on the label — the vault keys
  entries by role name (`postgres : …`), which defeats any `(password|secret|key)[:=]` pattern.
  *(This exact mistake was made this session; three local role passwords leaked.)*
- **Never push any branch. Never rewrite history. Never drop a database.**
- **Never `git add .` or `-A`.** Stage by explicit path.
- **Commits are UNSIGNED by design** (CLAUDE.md, founder decision 2026-08-08). Never claim a commit
  is signed — `git log --format=%G?` returns `N` here.
- **Nothing goes to `main`.** This branch only.

### Git hooks (they will reject you)

- **pre-commit** runs `dotnet format` on staged C# and blocks if unformatted.
- **commit-msg** requires `spec: <spec-id>` in the **body**, lowercase. Convention on this branch:
  `spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-N)`.
- **commit-msg** rejects a **subject line over 72 characters**.
- `gitleaks` is **not installed** — the secret scan silently skips. Do not rely on it.

---

## 5. Test commands and known flakes

```bash
# Backend — full solution
dotnet test src/AgriSync.sln

# Backend — one suite
dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~AnsweredGapTests"

# Frontend
cd src/clients/mobile-web && npx vitest run
```

**Last known green (2026-08-14):** CI gate `exit 0` · Domain **1212** · Architecture **78** ·
BuildingBlocks **98** · Sync integration **97** · frontend **876**.

### Flakes — do not report these as regressions without re-running

1. **Frontend load timeouts.** Under memory pressure the suite produces `Test timed out in 5000ms`
   in several files. Re-run the affected file **in isolation** before believing it. Seven "failures"
   were re-run in isolation this session and **all passed**.
2. **Integration tests can report `Passed!` in ~1 second while creating ZERO databases.** A green run
   is not proof of execution. Confirm a database was actually provisioned
   (`SELECT datname FROM pg_database WHERE datname LIKE 'ssf_it_%'`) and that elapsed time is
   plausible. DB-touching tests read `AGRISYNC_TEST_APP_ROLE_PASSWORD` from the environment.
3. **Memory starvation** (this machine has run at ~1.4 GB free of 16 GB) produces phantom failures.
   Re-run and report both results.
4. **Never use `--no-file-parallelism`** on the frontend suite — it causes cross-file pollution and
   made 117 files "fail" this session.

---

## 6. Task order

| Task | What | Needs DB? |
|---|---|---|
| **0b** | **Manual day persists what the farmer entered** ← **START HERE** | yes (to verify) |
| 1 | `AnsweredGap` domain type | ✅ **DONE** `ac911fdc` |
| 2 | Extractor credits an answered gap (never double-counts) | no |
| 3 | Answering recomputes the day (`RecomputeAsync` is idempotent) | yes |
| 4 | Client refetches the score after an answer | no |
| 5 | Pull stops erasing `understanding`, `deletion`, `dayOutcome` | no |
| 6 | Honest no-work day shows consistency, not a number | no |
| 7 | Questions speak the weather + previous log they already know | no |
| 8 | Seven `VITE_*` flags into the production config | no |

**Also verified and fixed in Task 5** (from the `feat/server-authoritative-architecture` Phase A
matrix, confirmed to exist on this branch too): `logsReconciler.ts:70` is a **full-record replace**
with no field preservation, so the first pull after a successful sync destroys device-only fields —
on the farmer's own phone, no wipe involved. `understanding` is read by `meterArrival.ts:59` and
`closureReceiptProjection.ts:146`, so **Sathi's familiarity counter currently counts backwards after
every sync.** The `/10` itself is safe — it is server-fetched via `useDayUnderstanding.ts:61`.

---

## 7. Open items for the founder

| Item | Status |
|---|---|
| 🔐 **Rotate 3 local DB passwords** (`postgres`, `agrisync_readonly`, `agrisync_app`) — leaked into this session's output; Postgres binds `0.0.0.0` | **urgent, independent of any session** |
| Pilot roster — 10–20 named farmers | blocks launch |
| Context-rich Marathi (Task 7 Step 5) back through the agronomist | blocks Task 7 copy only |
| Merge verdict `NO` → `YES` in the branch manifest | founder-only |
| Calibration sitting (~20 graded days) | after pilot, per ruling 4 |

**Already resolved, do not re-raise:** the published superuser password was **rotated 2026-08-10** and
now unlocks nothing. The string is still visible on `origin/main` but is inert; a redaction commit is
founder-gated and unpushed.

---

## 8. Working style the founder has asked for

- **Plain language.** He understands concepts, not code. Explain in outcomes, not mechanisms.
- **Questions in chat as copy-pasteable text.** Never use the `AskUserQuestion` picker.
- **Repo is truth.** Never propose or assert from a glance, a doc claim or an assumption — verify in
  the actual code first and cite `file:line`.
- **Adoption before accuracy at this stage** — encouraging beats precise, but **never fabricated**.
- **Status code, not log line**, as the success signal.
- **Deploy only via the `/deploy` plugin.** Never hand-roll.
- **His workflow is deploy → verify → merge**, not merge → deploy.
