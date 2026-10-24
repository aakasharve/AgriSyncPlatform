# Labour V2 R1 — release-statistics reconciliation

> **spec:** 2026-08-28-labour-v2-release-1 · **closure task, read-only**
> **Run:** 2026-09-03. Branch `feat/labour-v2-r1` @ `7219974d`, PR #75 (draft, open).
> `origin/main` @ `b33403a3`. Every number below names the command that printed it;
> re-running that command on this tree reproduces it.

**Why this sheet exists:** you were shown two different sizes for this release. Both
are real. Neither is a mistake. They answer two different questions, and this sheet
says which is which so nothing has to be hidden.

---

## The ten-second table

| | **PR base** (`origin/main...HEAD`) | **Historical base** (`a7784b18..HEAD`) |
|---|---|---|
| **Answers** | "What does merging this PR change in `main`?" | "How far did the tree move since work began?" |
| **Commits** | **128** | **137** |
| **Files changed** | **333** | **403** |
| **Insertions** | **+81,859** | **+85,000** |
| **Deletions** | **−1,306** | **−5,046** |
| **Is it what GitHub shows on #75?** | **Yes — exactly** | No |
| **Use it for** | the merge decision, review scope, the PR body | the effort's timeline story |

**The gap, in one line:** `main` moved **9 commits / 77 files / +3,142 / −3,741** after
this branch forked, and this branch later merged those 9 commits in. The historical
base counts them; the PR base correctly does not.

**The one honest caveat:** the historical base is *not* a pure measure of what this
effort produced. It includes 9 commits of other people's work (keystore rotation, the
AI intelligence activation, the DFES scoring fix, three APK releases). If the question
is "what did this team build", the **PR base is the more truthful number**, not the
larger one.

---

## 1. Both bases, with exact commands and outputs

### 1a. PR base — `origin/main...HEAD` (three-dot; what GitHub shows on #75)

```
$ git rev-list --count origin/main..HEAD
128

$ git diff --shortstat origin/main...HEAD
 333 files changed, 81859 insertions(+), 1306 deletions(-)
```

Confirmed against GitHub's own computation, not just ours:

```
$ gh api repos/aakasharve/AgriSyncPlatform/pulls/75 \
    --jq '{commits,additions,deletions,changed_files,base:.base.sha,head:.head.sha}'
{"additions":81859,"base":"b33403a34a2ad997fc81077bc635e30c4eb8c19f",
 "changed_files":333,"commits":128,"deletions":1306,
 "head":"7219974db4f63e899a80a901648fd75e18f2dd4a"}
```

GitHub and the local repo agree to the digit on all four figures.

### 1b. Historical base — `a7784b18..HEAD` (the fork point)

```
$ git log -1 --format='%H %ad %s' --date=short a7784b18
a7784b18c171f8e6fdff6f1f6e30c2b4a25ab499 2026-08-28 fix(ssf): widen prompt_version; stop labour conflict retry loop (#60)

$ git rev-list --count a7784b18..HEAD
137

$ git diff --shortstat a7784b18 HEAD
 403 files changed, 85000 insertions(+), 5046 deletions(-)
```

`a7784b18` is the merge-base of the fork, so its two-dot and three-dot diffs are
identical — verified: `git diff --shortstat a7784b18...HEAD` prints the same line.

---

## 2. Why they differ — in plain language

When this work started on 2026-08-28, `main` was at `a7784b18`. The branch forked there.

Then two things happened at the same time:

1. **This branch built Labour V2 R1** — 127 commits of its own work.
2. **`main` kept moving** — 9 other commits landed on it from other efforts:

```
$ git log --oneline --no-decorate a7784b18..origin/main
b33403a3 chore(release): v1.0.12 / versionCode 20 for the DFES scoring fix (#74)
05c5fc8c fix(voice): streaming path makes no AiJob, zeroing every DFES score (#73)
7644ee62 Turn on the AI intelligence layer: contract fix, dead-weight removal, ... (#72)
8a581df0 chore(release): v1.0.11 / versionCode 19 for the subtitle fix (#71)
2cace4e3 fix(home): nameboard subtitle truncated, so make the ornament yield (#69)
fdf03c97 fix(api): an expired token must not dead-end a farmer mid-request (#68)
e5aedf4a Rotate the release signing key, build a Play bundle, and fix four dead API calls (#66)
4374d078 chore(release): v1.0.10 / versionCode 18 for the nameboard APK (#67)
c4882ffa feat(home): nameboard, banner strip, and the 800-line cap green again (#65)
```

On 2026-09-03 this branch **merged those 9 commits in** — commit `76a7a3b8`,
`Merge remote-tracking branch 'origin/main' into feat/labour-v2-r1`.

From that moment the two counts split:

- **The historical base** (`a7784b18..HEAD`) looks back to the fork point, so it sweeps
  up all 9 of `main`'s commits and the 77 files they touched. It answers *"what is
  different in the tree today versus 2026-08-28"* — a fair description of the effort's
  span, but it credits this branch with work it merely absorbed.
- **The PR base** (`origin/main...HEAD`) is the *three-dot* comparison. Three dots mean
  "compare against the point where these two lines last agreed" — which, after the
  merge, is `b33403a3`, today's `main` tip. Anything already on `main` is excluded by
  construction. It answers *"what does this PR add to `main`"* — the only question that
  matters at the merge button.

The arithmetic closes exactly:

```
$ git diff --shortstat a7784b18...origin/main
 77 files changed, 3142 insertions(+), 3741 deletions(-)

$ comm -23 <(git diff --name-only a7784b18 HEAD | sort) \
           <(git diff --name-only origin/main...HEAD | sort) | wc -l
70
```

403 − 333 = **70 files** appear only in the historical base — precisely the count of
files touched by `main`-only work. (`main` touched 77 files; 7 of them this branch also
touched, so 70 are `main`-only.) Commits: 137 − 128 = **9**, exactly `main`'s 9.
Insertions: 85,000 − 81,859 = 3,141 against `main`'s 3,142 — the one-line difference is
a file both sides edited.

### 2a. The trap that produced the two numbers in the first place

The local `main` **ref in this worktree is stale** — it still points at the fork point:

```
$ git rev-parse --short main          # local ref, NOT updated
a7784b18
$ git rev-parse --short origin/main   # the real main
b33403a3

$ git diff --shortstat main...HEAD          # stale local ref
 403 files changed, 85000 insertions(+), 5046 deletions(-)
$ git diff --shortstat origin/main...HEAD   # what GitHub actually shows
 333 files changed, 81859 insertions(+), 1306 deletions(-)
```

So anyone running the *apparently correct* command `git diff main...HEAD` in this
worktree gets the historical number and reasonably believes it is the PR number.
**That is the whole origin of the discrepancy.** Nothing was fabricated; a stale ref
was read as a fresh one.

---

## 3. Area breakdown for the PR base

Bucketed from `git diff --numstat origin/main...HEAD`.

| Area | Files | Insertions | Deletions |
|---|---:|---:|---:|
| **Server** (`src/apps/`) | 61 | +33,925 | −404 |
| **Client** (`src/clients/`, non-test) | 96 | +5,379 | −576 |
| **Tests** (backend + client) | 139 | +17,032 | −318 |
| **Docs** (`docs/`) | 29 | +25,433 | −0 |
| **Contract** (`sync-contract/`) | 8 | +90 | −8 |
| **Total** | **333** | **+81,859** | **−1,306** |

Finer split, because two rows above are misleading on their own:

| Sub-area | Files | Insertions | Deletions |
|---|---:|---:|---:|
| server: EF migrations | 11 | +30,206 | −1 |
| server: application/domain/api code | 50 | +3,719 | −403 |
| client: code | 96 | +5,379 | −576 |
| tests: backend (`src/tests/`) | 59 | +8,901 | −198 |
| tests: client (vitest + snapshots) | 80 | +8,131 | −120 |
| docs: plans + specs | 10 | +13,085 | −0 |
| docs: mockups (HTML) | 19 | +12,348 | −0 |
| contract: schemas | 6 | +86 | −5 |
| contract: tests | 2 | +4 | −3 |

### The number behind the number

**36.5% of this PR's insertions are machine-generated and were never typed.**

```
$ git diff --numstat origin/main...HEAD \
    | awk '$3 ~ /\.Designer\.cs$|ModelSnapshot\.cs$|\.snap$|payloads-csharp\//'
5861	0	.../Migrations/20260831155124_GrantFieldOperatorWorkRowsToAppRole.Designer.cs
5924	0	.../Migrations/20260831180408_AddAttendanceMarks.Designer.cs
5972	0	.../Migrations/20260831185516_AddAttendanceMarkCorrections.Designer.cs
5976	0	.../Migrations/20260902103708_AddLabourGrantExpiry.Designer.cs
5988	0	.../Migrations/20260902154713_AddEngagedThroughToLabourAssignments.Designer.cs
 128	1	.../Migrations/ShramSafalDbContextModelSnapshot.cs
  25	0	sync-contract/schemas/payloads-csharp/AttendanceMarkPayload.cs
   2	1	sync-contract/schemas/payloads-csharp/CreateDailyLogPayload.cs
```

| | Files | Insertions | Deletions |
|---|---:|---:|---:|
| Auto-generated (EF Designer snapshots etc.) | 8 | **+29,876** | −2 |
| Hand-written | 325 | **+51,983** | −1,304 |

Each EF migration re-emits the *entire* database model as a ~5,900-line snapshot file.
Five migrations therefore cost ~29,700 lines that no one wrote and no one reviews line
by line. If anyone quotes "82,000 lines" as a measure of effort or review burden, the
honest figure is **~52,000 hand-written**, and of those **25,433 are documentation** —
leaving roughly **26,500 lines of hand-written code and tests**.

---

## 4. Commits: this effort vs merged in from `main`

```
$ git rev-list --count origin/main..HEAD          # this branch's own
128
$ git rev-list --count --merges origin/main..HEAD
1
$ git rev-list --count --no-merges origin/main..HEAD
127
$ git rev-list --count a7784b18..origin/main      # main's own, absorbed
9
$ git shortlog -sne --no-merges origin/main..HEAD
   127	agrisync-bot <bot@example.com>
```

| Bucket | Count |
|---|---:|
| Authored by this effort (non-merge) | **127** |
| Merge commit that absorbed `main` (`76a7a3b8`) | **1** |
| **Subtotal — the PR's commits** | **128** |
| Merged in from `main` (other efforts, already on `main`) | **9** |
| **Total in the historical range** | **137** |

Every non-merge commit on this branch is authored by `agrisync-bot` — one author, no
split attribution to reconcile.

---

## 5. Contradiction audit — every place a number appears

Sources checked: PR #75 body (live, via `gh`), `phase-5-walk-evidence.md`,
`reviews/FINAL-branch-package-index.txt`, and `reports/task-5-report.md` — the closest
thing to a completion report; there is no separate one.

### 5a. Release-size numbers

| Where | Claim | Verdict |
|---|---|---|
| GitHub PR #75 API | 333 files, +81,859, −1,306, 128 commits | **MATCHES** — reproduced locally to the digit |
| PR #75 body | "**124 commits**" | **STALE by 4.** True at `f48c74e5`; 4 commits landed after (`76a7a3b8`, `08bd1183`, `1907eed0`, `7219974d`). Actual: **128** |
| `FINAL-branch-package-index.txt` | "319 files changed, 79670 insertions(+), 1300 deletions(-)", 116 commits listed | **HONEST SNAPSHOT.** Reproduces exactly at its own SHA `cd29b590`: `git diff --shortstat origin/main...cd29b590` prints the identical line, and `git rev-list --count origin/main..cd29b590` = 116. 21 commits have landed since. Not a contradiction — a dated review package |
| `phase-5-walk-evidence.md` | *no* release-size numbers | **N/A** — it makes no file/line/commit claims to contradict |
| `task-5-report.md` | scoped only to `1c367628..HEAD` ("9 test files + the evidence sheet") | **CONSISTENT** — a task-scoped diff, correctly labelled as such |

**Verified curiosity worth recording:** at `cd29b590` the two bases were *identical* —
`origin/main...cd29b590` and `a7784b18...cd29b590` both print
`319 files changed, 79670 insertions(+), 1300 deletions(-)` — because the merge had not
happened yet. The merge `76a7a3b8` is the exact event that split the two numbers.

### 5b. A tooling trap that will manufacture a fourth number

```
$ gh pr view 75 --json commits --jq '.commits|length'
100          # <- NOT the commit count; the GraphQL page cap
$ gh api repos/aakasharve/AgriSyncPlatform/pulls/75 --jq .commits
128          # <- the true count
```

`gh pr view --json commits` silently caps at 100. Anyone using it will report "100
commits" and be wrong. **Use the REST endpoint for commit counts.**

### 5c. Verification / test-count numbers

| Where | Claim | Verdict |
|---|---|---|
| PR body | "Domain **1997**" | **CORRECT AT HEAD** — re-run today: `Failed: 0, Passed: 1997, Skipped: 1, Total: 1998` |
| `phase-5-walk-evidence.md` | "**1990 passed, 1 skipped (1991)**" | **STALE, and fully explained.** 7 `[Fact]`s were added after its snapshot (`git diff cd29b590..HEAD -- src/tests/ShramSafal.Domain.Tests/` → +7 `[Fact]`, −0, no `[Theory]`). 1990 + 7 = **1997**. Arithmetic closes exactly |
| `task-5-report.md` | "1990 passed, 1 skipped (1991)" | Same stale snapshot, same explanation |
| PR body / walk-evidence / task-5 | Architecture "**107**" | **ALL THREE MATCH** — re-run today: `Failed: 0, Passed: 107, Skipped: 0, Total: 107` |
| PR body | "client vitest **468** (labour)" | **MATCHES** walk-evidence's dated re-run. No labour test file changed after it — `git diff --numstat f48c74e5..HEAD -- src/clients/mobile-web/src/features/labour/` is empty — so 468 is still current |
| walk-evidence | keeps **both** 439 (pre-Task-9) and 468 (post-Task-9), each dated | **MODEL BEHAVIOUR** — "both counts are kept so neither snapshot lies about its date" |
| PR body | "RealPostgres labour+attendance+disturbance **70**" | **RECONCILES** — 69 `RealPostgres` tests in the `IntegrationTests.Labour` namespace + 1 disturbance test (`Dfes.DeclaredNoWorkDayTests.A_reason_chip_rides_as_a_DisturbanceEvent_and_names_the_cause`) = **70**. Derived from `dotnet test --list-tests`; no doc stated the aggregate, so it was re-derived here |
| PR body / walk-evidence | "tsc **0 errors**" | **MATCH** |
| walk-evidence / task-5 | "3333 passed, 2 failed (3335)", both flakes green in isolation | **MATCH each other**, and match the known baseline: two `mainView`-family files flake under full parallelism |
| PR body | "**107** architecture laws" | **MATCH** — the same 107 as the architecture suite |

### 5d. Not contradictions (checked and cleared)

`2026-08-14-labour-DEPLOY-HANDOFF.md` ("146 commits ahead"),
`2026-08-14-COMPLETE-GAP-REGISTER.md` ("148 commits behind"), and
`2026-08-14-telegram-style-server-migration-HANDOFF.md` ("141 commits ahead") all
describe **`feat/labour-management-ui`** — a different branch from a different effort.
They do not bear on this release.

---

## 6. What to fix before merge (documentation only — no code)

Two edits, both one line, neither serious enough to block the gate:

1. **PR #75 body: "124 commits" → "128 commits"** — or drop the count entirely, since it
   goes stale on every push and GitHub shows the live number anyway.
2. **`phase-5-walk-evidence.md`, the Domain row.** Add a dated re-run line beside
   1990/1991 exactly the way the sheet already does for 439 → 468, so the sheet and the
   PR body stop disagreeing: **1997 passed, 1 skipped (1998)** as of 2026-09-03 at
   `7219974d`.

Nothing else disagrees. `FINAL-branch-package-index.txt` should be left exactly as it
is — it is a correctly dated snapshot, and rewriting it would destroy the evidence that
it was true when written.

---

## Appendix — commands to reproduce every figure

```bash
# Bases
git rev-list --count origin/main..HEAD                 # 128
git diff --shortstat origin/main...HEAD                # 333 / +81859 / -1306
git rev-list --count a7784b18..HEAD                    # 137
git diff --shortstat a7784b18 HEAD                     # 403 / +85000 / -5046

# The gap
git rev-list --count a7784b18..origin/main             # 9
git diff --shortstat a7784b18...origin/main            # 77 / +3142 / -3741
git log --merges --oneline origin/main..HEAD           # 76a7a3b8

# Composition
git rev-list --count --no-merges origin/main..HEAD     # 127
git shortlog -sne --no-merges origin/main..HEAD        # 127 agrisync-bot

# GitHub's own numbers (REST — do NOT use `gh pr view --json commits`, it caps at 100)
gh api repos/aakasharve/AgriSyncPlatform/pulls/75 \
  --jq '{commits,additions,deletions,changed_files}'

# Snapshot reproduction
git diff --shortstat origin/main...cd29b590            # 319 / +79670 / -1300

# Test counts
dotnet test src/tests/ShramSafal.Domain.Tests/ShramSafal.Domain.Tests.csproj  # 1997 / 1 skipped / 1998
dotnet test src/tests/AgriSync.ArchitectureTests/*.csproj                     # 107 / 0 / 107
```
