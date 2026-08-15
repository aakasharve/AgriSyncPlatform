# FINAL SERVER-AUTHORITATIVE EXECUTION PLAN

> **This document supersedes all prior planning material as the single execution source.**
> The Planning Directive, Founder Decisions, Phase A Data Ownership Matrix, Founder Direction,
> Lane A containment plan, Lane B programme, `P10`, the four runtime reproductions and the live-AWS
> findings are **inputs**, retained as evidence. Execute from this document only.

> **For agentic workers:** REQUIRED SUB-SKILL — `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes. **Do not redesign the architecture.**
> It is closed (§2). If you believe a task is wrong, produce evidence and stop; do not improvise.

**Date:** 2026-08-15 · **Branch:** `feat/server-authoritative-architecture`
**Method:** seven independent specialists (CTO, data, sync, mobile, cloud, security, QA), reconciled,
then adversarially reviewed and cross-verified. All claims carry file:line evidence.

---

## 0. STATUS — THE ONLY SOURCE OF EXECUTION STATUS

> **§0 is authoritative for status. Every other section defers to it.** No sibling section carries a
> commit count, a branch state, a test tally or a deploy state — those are volatile and duplicating
> them is the same defect this migration exists to remove from the product. **Re-measure at execution
> time.** If any section below contradicts §0, §0 wins and the other section is stale.

> **"LANDED" ≠ "SHIPPED".** Nothing in this plan has reached a farmer. Work described as landed is
> **committed on the feature branch**, behind an unmerged tower. This distinction is foundational to
> the truth doctrine and is used strictly throughout.

> 🛑 **§0 CACHES NO NUMBERS. It tells you how to measure and how to read the answer.**
> Three separate drafts of this section wrote a head SHA, a commit count and a test tally. **All three
> went stale within hours**, because the repo moves while the document sits. A cached number in a plan
> is the same defect as a cached number in the product. **Run the commands. Trust nothing written
> here as a value.**

### Measure before you act — these four, every time

```bash
git log --oneline -8                                   # what has landed
git status --short                                     # is the tree clean
git rev-list --left-right --count main...HEAD          # tower size, for the merge gate
cd src/clients/mobile-web && npm run test:repro         # open containment defects
find src/clients/mobile-web/src -name 'REPRO-*.test.ts'  # which reproductions remain
#  ^ use find, NOT ls with a glob: the glob fails with exit 2 in a non-globstar shell,
#    and an absent REPRO file reads as "graduated" — a failed command would look like success
```

### How to read the answer

- **A REPRO file that disappeared was not deleted — it was RENAMED into the main gate.** That is the
  designed graduation path: once a reproduction goes fully green, it loses the `REPRO-` prefix and
  joins the blocking suite. **A shrinking REPRO count is progress, not loss.** Confirm with
  `git log --diff-filter=R --name-status`.
- **The remaining REPRO failures are a MIX. Do not treat them uniformly.**
  - **`REPRO-A2` isolation failures are OPEN §P0.1 WORK** — the highest-harm defect in this plan.
  - **`REPRO-A3` money/contract failures are OPEN §P0.6 WORK.**
  - **`REPRO-A1` fabrication failures are §17 DEFERRALS, expected red**, waiting on F1 to make the
    fields optional. One of them — the `cropActivities … status completed` assertion — is the
    **founder-blocked D1 two-rule collision (§P0.5)** and must NOT be "fixed" by an executor.
  - **Read each failure against §17 before acting on it.** An earlier §0 carried this qualifier; a
    later edit deleted it, leaving an unqualified sentence that overrode the deferral register.
  - 🛑 **§0's precedence clause does NOT extend to overriding §17.** Where §0 and §17 disagree about
    whether something is deferred, **§17 wins.** §0 is authoritative for *measured state*, never for
    *what is in scope*.
- **"LANDED" means committed on this branch. Nothing here has reached a farmer.**

### What has landed, by area — verify with the commands above, do not trust this list's completeness

| Area | State |
|---|---|
| §P0.5 same-device destruction · §P0.6 money · §P0.7 offline trust | `[x]` **LANDED ON FEATURE BRANCH** — not merged, not released |
| §P0.8 device storage pressure | `[~]` **PARTIALLY STARTED** — later commits touch storage and voice-retention surfaces. **Re-check the diff before assuming it is untouched;** an earlier draft asserted the landed work touched no storage file and that is no longer true |
| §P0.1 isolation | `[x]` **LANDED + FOUNDER-ACCEPTED 2026-08-15** — closed on a real-browser two-farmer check, both directions. Not merged, not released |
| §P0.2 audit bypass · §P0.3 RLS · §P0.4 transcript · §P0.9 security items | `[ ]` **OPEN** |

**§P0.2 is now the highest-harm open item in this document.** Its widest mouth is **not** the `/audit`
endpoint everyone looks at — it is the sync pull, which sends every NULL-farm audit row, payload
verbatim, to every device. Read §P0.2 in full before touching it.

> 🛑 **Blocking acceptance gates run against a FROZEN COMMIT on a stable tree** — founder instruction
> at P0.1 closure. Freeze → clean worktree → run → record the SHA → only then may another agent touch
> shared files. See the P0.1 closure block in §5.

**One superseded mechanism, recorded so it is not reinstated:** an early draft proposed inverting the
failing assertions so the gate could go green. What shipped instead is a **dedicated reproduction
suite** — excluded from the main gate, run by `npm run test:repro`, with graduation by rename. That
avoids every hazard reviewers found in the inversion approach. **The inversion plan is discarded.**

> 🛑 **RULING D9 LANDED ON THIS BRANCH AND REVERSES PART OF THIS PLAN.**
> **Voice recordings are kept FOREVER.** The 30-day sweeper is now a hard `return 0`.
> Five statements written before D9 rested on that sweeper working; each is corrected in place at
> §2, §8, §9 and §P0.8. **Encryption is now the NEXT item in that area, not a later one** — an
> unbounded archive of plaintext clips is the direct consequence of forever-retention.

> **Superseded §0 wording, recorded so it is not reinstated:** an early draft said "everything marked
> P0 is history, start reading at §6" and "the remaining failures are all deferrals". Both were false;
> the second was an instruction to add a database-delete call §P0.1 forbids. **Read §5 in full.**
> *(§P0.1 has since closed — see its closure block in §5. **§P0.2 is now the highest-harm open item.**)*

---

## 1. EXECUTIVE CONCLUSION

**The defect class.** Client capture, server persistence, read-back and reconstruction were built as
partially independent paths. That single cause produced ~50 verified defects: data disappearing, data
changing meaning, fabricated defaults, offline work vanishing, deletions resurrecting, money
corrections silently rejected, duplicate money events, business truth living only on one handset,
media queues wedging, and one farmer's data reachable by the next farmer on the same phone.

**Four were reproduced at runtime**, not merely read — each with a passing sanity anchor proving the
harness sound. **Current counts live in §0 only; measure, never cite.**

**What changed once specialists looked.** Five things the audit got wrong, all in the direction of
*less* to build:

| Belief | Reality |
|---|---|
| The sync lifecycle must be designed | It **exists and works** — six statuses, retry cap, crash recovery, durable rejection, conflict screen. F2 shrinks from a design to an adoption plus four gaps. |
| Concurrency must be built for D1 | Verification is **already** append-only events + FSM + role guard — exactly the C7 requirement, implemented. First real need is a cost amount, in D2. |
| The money-correction bug needs a string added to a list | The server **already classifies** every error and **drops the classification on the way out**. Carrying it removes the whole class. |
| The audit trail barely exists | It carries **8 of 9** required attributes as first-class columns, is append-only by privilege, and has ~60 write sites. Only the before-image is missing. |
| Old photos need measuring before backfill | Measured: `attachments/` holds **4 objects, 83 bytes**. There is nothing to backfill. Deferral closed. |

**The gating fact.** This branch sits on an **unmerged tower** that has never reached production, so
every fix below has nowhere to land until the founder gates it. The tower carries backend persistence,
so releasing it is a backend + web + APK deploy, not a static push. **Commit counts and branch state
live in §0 only — re-measure there, never here.**

**The end state, and the test:**

> **If an acknowledged farmer record can disappear, change meaning, leak to another farmer, or require
> the originating phone to reconstruct it, the migration is not finished.**

---

## 2. LOCKED ARCHITECTURE PRINCIPLES

Not open for discussion. An executor who believes one is wrong stops and produces evidence.

- **Server owns durable acknowledged farm truth.** `P10`: *no acknowledged business truth may depend on
  one device.* Test: **acknowledged = reconstructable without the originating device.**
- **The device holds five things only:** disposable cache · offline unsynchronized intent · temporary
  processing data · downloaded media · genuine device preferences. **There is no sixth category.**
- **Offline is pending intent, never competing canonical truth.** Capture must never be blocked (`P9`).
- **Unknown stays unknown.** Never reconstruct missing truth with convenient defaults (`P4`).
- **Provenance survives** where the distinction matters (`P8`). Stated and derived never impersonate
  each other (`P1`). Corrections never silently overwrite (`P3`).
- **Four axes stay orthogonal:** business truth · synchronization state · processing state · provenance.
  Never one status field.
- **Cloud object storage owns durable media.** Local media is disposable after acknowledgement.
- **Minimum concurrency, opt-in per entity. No CRDTs.** Real-time deferred.
- **Infrastructure configuration must be reproducible and version-controlled.**

**Rejected unless a proven requirement cannot be met otherwise:** microservices · Kafka ·
event-sourcing everything · rewriting all persistence · universal repository abstractions · CRDTs ·
Kubernetes · global real-time · universal versioning · another client database · another sync engine.

**Protect, do not redesign** (direction §7): the log-save honesty layer (*मी लिहून घेतलं* — it refuses
to claim server acknowledgement without one) · the no-multiply rule · auth/token storage · server
tenancy and RLS on farms/plots/crop cycles · ~~the voice 30-day sweeper~~ **(WITHDRAWN — ruling D9
keeps voice forever and disabled it)** · crash recovery on
`mutationQueue` · the structured labour round trip · verification's event-sourced FSM ·
`UploadQueueRetry`'s deliberately narrow scope · the field-operator erasure semantics.

---

## 3. FINAL DEPENDENCY GRAPH

```
GM  FOUNDER GATE — MERGE the tower to main       (source control; size in §0)
GR  FOUNDER GATE — RELEASE to production         (separate; heavy-tier, see §14)
        │   GM and GR are TWO decisions. If merging auto-deploys, GM waits on GR's
        │   preconditions. If it does not, GM may proceed on remote-green while
        │   production stays blocked.
        │
        ├─────────────── P0 CONTAINMENT (§5) ────────────────┐
        │   isolation · audit bypass · RLS · transcript      │
        │   destruction · money · offline trust              │
        │                                                    │
        ├─── INFRA LANE (§11) — parallel from day one ───────┤
        │   Glacier · IaC · raw-bucket · DR · compression    │
        │                                                    │
        └─── G1 contract-parity CI gate ─────────────────────┘
                     │
                F0 file splits  →  F1 contract semantics (DailyLog only)
                     │                    │
                     └──── F2 sync adoption + 4 gaps
                                          │
                        D1 DailyLog ──────┴──→ D2 Money (F3 opts in here)
                                                  │
                                          D3 Planned Tasks
                                                  │
                                        D4 Harvest · D5 Procurement
                                                  │
                                            D6 Geography
                                                  │
                                    X1 legacy cleanup · X2 scenarios A–J
```

**Three hard rules, each a data-loss or leak if inverted:**

1. **Isolation before any cleanup, eviction or sweeper.** Eviction running against the wrong database
   deletes the wrong farmer's data. Strongest constraint in the programme.
2. **Within a domain:** contract → server capability → durable persistence → server read-back →
   faithful reconstruction → migration → prove new-device recovery → **only then** remove the
   local-only path. **Stage 5 lands at least one deploy after stage 3 is prod-proven**, never in the
   same PR (directive §21; doctrine trap #3).
3. **Stable idempotency keys before the crash reconciler** — re-enqueue is safe only because duplicate
   keys collapse.

---

## 4. THE TWO FOUNDER GATES — GM (MERGE) AND GR (RELEASE)

> **These are two decisions, not one.** An earlier draft treated them as a single gate. The same
> document then established ten migrations, disabled startup migrations, no existing mechanism to
> apply a migration, a required pre-deploy snapshot, mandatory cache invalidation and a daily
> production stop schedule — none of which are merge concerns.

> 🛑 **Branch size and divergence are NOT stated here.** Four sections once carried four different
> numbers, all stale. **Measure at the moment of asking** and read the current state from §0.
> Presenting a merge sized by a stale number is the error this plan exists to end.

### GM — merge to `main` (source control)

Preconditions: remote green on the landed commit. **If merging to `main` auto-deploys, GM inherits
every GR precondition below and must wait for them. If it does not, GM may proceed while production
stays blocked at GR.** Establish which before asking.

- [ ] **GM decision recorded: (a) / (b) / (c)** — options below
- [ ] **Auto-deploy on merge? yes / no** — determines whether GM is independent of GR

### GR — release to production (separate, heavy tier)

Preconditions, all from §14: pre-deploy RDS snapshot · a proven mechanism to apply the migrations ·
the nap schedule suspended for the window · CloudFront invalidation planned · a new APK build.
**GR is blocked until every one is true.**

- [ ] 🛑 **RELEASE BLOCKER (founder-added 2026-08-15) — MEASURE THE PRODUCTION EXPORT PATH.**
      Establish whether the **production** migration/admin role carries `rolbypassrls`. `ExportWorker`
      reads `audit_events.json` for a DSAR through the admin context. Locally that role is superuser
      and bypasses RLS, so the subject receives their own rows. **If production does not bypass, the
      tightened §P0.2 policy makes a farmer's own audit export return EMPTY — silently, with no
      error.** That is a data-rights regression, not a sync bug.
      **Proof required: run the real export for a real subject against production-shaped roles and
      confirm the audit section is non-empty.** A role-catalog reading alone is not sufficient —
      §P0.2's own inspection showed the plan asserting opposite answers in two sections and verifying
      neither. **GR is blocked until this is measured, not reasoned about.**
- [ ] **GR decision recorded, separately from GM**

### The three GM options

- **(a) Merge the tower to `main` now**, then land containment on top. **Recommended.** It is green on remote, and holding a security containment behind an unrelated review is the worse risk.
- **(b) Cherry-pick containment onto a branch cut from `main`**, ship the security fix alone, merge the
  tower later. Costs a rebase and splits history; buys a smaller review.
- **(c) Hold both** until the labour work is founder-accepted. Leaves the shared-handset leak live.

**Deploy shape (GR, not GM):** backend + web + **a new APK build**. See §14 for the full precondition
list — prod is **not** hibernated and the framing that it is has been withdrawn.

---

## 5. PHASE P0 — CONTAINMENT

**Entry:** GM decided (§4). **P0 implementation does not wait on GR.**

> 🛑 **Exit criterion corrected — the draft's was impossible.** It required destructive-device phases
> 5 to 7, but **phase 5 asks harvest, procurement, machinery and financial semantics to reconstruct
> after a full wipe** — and those fields do not become server-authoritative until D1, D4 and D5.
> **P0 could never have passed it.**

**P0 proves CONTAINMENT, not reconstruction.** Exit when all five hold:

- [ ] **No same-device destruction** — a farmer's own sync does not reduce his own record
- [ ] **No cross-farmer exposure** — §16 phase 6, both directions
- [ ] **Honest money and rejection state** — a refused correction is visible; no duplicate entries
- [ ] **Offline intent survives a kill** — §16 phase 7
- [ ] **No new fabrication introduced**

**Full wipe-and-reconstruct (§16 phase 5) is proven per-domain as each lands, and finally at X2.**
It is not a P0 gate.

Ordered by farmer harm (direction §9). Every task is client-side or a single migration; **none creates
a temporary architecture Lane B must undo.**

### P0.0 — Gate hygiene

> 🛑 **HISTORICAL — DO NOT EXECUTE THIS SECTION.** Its premise ("the reproduction files sit inside the
> required check and block the merge") was **already resolved** by the shipped dedicated suite
> described in §0. Every task below is superseded. **The checkbox semantics are deliberately removed**
> so a subagent cannot pick one up. The reasoning is retained as scar tissue — the `it.fails` hazards
> in particular are why the shipped mechanism is correct — but nothing here is work.
>
> **What replaced it:** `vitest.config.ts` excludes `src/**/REPRO-*.test.ts`; `npm run test:repro` runs
> them; the file carries an instruction to rename a REPRO file back into the gate once it goes fully
> green. No inversion, no pass-on-any-failure, no green-on-revert.
>
> **The only live item from this section** is the lint threshold, now stated in §13.

~~(historical, do not execute)~~ 🛑 **COMMIT THE FOUR REPRODUCTION FILES FIRST. They are untracked.**
      An earlier draft asserted that 48 red assertions "currently block merge to `main`". **False** —
      the files are on no branch, so CI has never seen them, and no task committed them. Everything
      else in this section depends on them existing in the repo.
~~(historical, do not execute)~~ **The baseline is a RANGE plus a re-measurement, not a fixed tally.** A draft asserted
      `6 failed | 145 passed (151)` / `50 failed | 1449 passed (1499)`. A later unpiped run measured
      `4 failed | 147 passed (151)` / `48 failed | 1453 passed (1501)`: the two timeout files passed and
      the total moved. **An "exact tally" gate is a random variable and would have fired on task one.**
      Re-measure at the start, record the actual numbers, and gate on *"the four REPRO tallies match
      and no other file regresses"*.
~~(historical, do not execute)~~ **Own the two timeout tests — do not merely record them.** They pass in isolation and fail under
      load. Left unowned, the required check fails on any loaded run and the merge is blocked by nobody's
      task. Either raise the timeout or remove the real timer. **The draft asserted both that they are
      flaky and that the baseline is exact; those cannot both hold.**
~~(historical, do not execute)~~ **Convert every §17-deferred assertion to `it.fails(...)`** with a `// DEFERRED → §17 row N` tag,
      **and understand exactly what it does and does not buy.**
      > `it.fails` flips *any* non-pass into a pass — including a timeout, a fixture `TypeError`, or an
      > import error. So it **violates this plan's own flake rule** ("a test that cannot run must fail")
      > across the whole deferred set, and on a multi-assertion test a fix that repairs six of seven
      > assertions still reads green.
      > **Two consequences that must be written into the tasks:** convert only *single-assertion* tests;
      > and **run the mutation proof BEFORE converting**, because after conversion reverting the fix
      > makes the test *green* — G3 would silently pass for every converted test.
~~(historical, do not execute)~~ **Identify by name the sanity anchors that ASSERT THE DEFECT, and convert them too.** Several
      currently-*passing* tests encode the broken behaviour — that a wedged row stays wedged, that the
      delete erases the freshness marker. **The correct fixes turn them red**, and a gate that reads
      "an anchor turning red means the fix is wrong" would misdiagnose four correct fixes as
      regressions, on a blocking gate. List them explicitly; do not refer to "the 17 anchors" — the
      real count is 18 passing, 11 labelled, and 17 matches neither.
~~(historical, do not execute)~~ **Every verification command runs unpiped** (or `set -o pipefail`) and asserts `$?`.
      **Also assert the file count** — a vitest run that silently collects a subset is how a green gate
      becomes meaningless.
~~(historical, do not execute)~~ **Promote `check:storage-discipline` into `ci-gate.yml`** — but **not** as a proof of anything.
      > **Correction, found independently by two reviewers.** An earlier draft called this "a proof of
      > exhaustiveness for the isolation fix" and "the strongest structural guarantee in the codebase".
      > **Both claims are false.** It matches four literal method names on a bare `localStorage.` token,
      > so it misses bracket access, aliasing, `.key`/`.length`, **`sessionStorage` entirely**, **Cache
      > Storage**, and `indexedDB`; and it skips test directories. Worse, **all three named raw-key
      > stores already live inside `infrastructure/storage/`, so this gate is green today and green
      > after — namespaced or not.** It is a file-location gate, not a namespacing gate. Promote it for
      > what it does; do not let the isolation argument rest on it.

### P0.1 — Isolation (P0 security; no precondition; live today)

**Root cause, corrected:** not "two keys fall out of sync". **Unknown ownership resolves to the shared
database** — the routing fails *open* (`userDatabaseName.ts:126,147-161`). Clearing localStorage does
not corrupt the answer; it deletes the answer, and the fallback hands the incumbent's database to the
next person who asks.

**Severity is higher than farmer-vs-farmer:** the leaked rows carry third-party **worker names**
(`log.labour.types.ts:109,35`) — PII of people party to neither account.

- [ ] **Move the ownership claim inside the database it describes** — one `appMeta` row,
      `owner_user_id`, written in a `rw` transaction on first authenticated open. The claim and the data
      become the same mechanism, so **no partial browser-storage clearing can desynchronize them.**
      `appMeta` has existed since v1 — **no Dexie version bump.**
- [ ] **Fail closed — and the slot named in the draft does NOT enforce it.** Three corrections, each
      of which independently keeps the leak open:
      **(a)** The init effect wraps everything in a `try/catch` that only logs, and its `finally`
      **always** clears the loading flag — so if activation throws, children render anyway with no
      activated database. Fail-closed becomes fail-open plus a crash.
      **(b)** ✅ **CORRECTED BY EXECUTION.** The draft blamed `dataSource.initialize()` — that function
      has an **EMPTY BODY** and opens nothing. The hazard is real; the mechanism named for it was inert.
      **The actual unconditional openers are `MigrationService.migrate()` and
      `runLegacyLocalStorageMigration()`**, and then every later `getDatabase()`.
      **(c)** ✅ **MEASURED, and smaller than the draft claimed in the way that matters:**
      **314 call sites across 86 files, of which only 122 in 55 production files** — the other 192 are
      tests. Of the production sites, **26 swallow a throw inside a `try{}`** (a worker stops silently)
      and **96 are unguarded** (throw propagates). Heaviest unguarded: the log repository ×17 and the
      mutation queue ×14.
      🛑 **DO NOT make `getDatabase()` throw across those 96.** The unguarded set includes the log write
      path — a synchronous throw stops a farmer recording today's work (`P9`). **Fix the
      activation/ownership boundary, not 96 symptoms.**
- [ ] **Cache Storage: renaming does not isolate.** `caches` is **origin-scoped, not
      database-scoped** — `caches.open('agrisync-local-files-v1')` stays callable from any farmer's
      session, and "quarantine, never delete" guarantees the old cache survives holding every existing
      attachment's bytes. Renaming isolates only *future* writes, via exactly the "every read path must
      remember" model this codebase already rejected as invisible in testing.
      **And renaming without migrating orphans the incumbent's own photos** — their rows hold paths that
      miss in the new cache and the read throws. **Design the access boundary, not the name**, and carry
      the same non-destructive assertion the localStorage move gets.
- [ ] **Name from the authenticated identity**, not a localStorage mirror. Legacy `AgriLogDB` becomes a
      one-time migration *source*, never a routing *target*.
- [ ] **Extend isolation to Cache Storage.** `agrisync-local-files-v1` is **device-global** and holds
      every attachment's bytes — outside per-farmer isolation entirely. Per-farmer cache naming.
- [ ] **localStorage: scope per farmer, and MOVE, never delete.** `getKey()` reads
      `DemoModeStore.getActiveUserId()` **live** — not a `setUser()` mirror, which would re-introduce the
      boot-order race `userDatabaseName.ts:139-160` was written to avoid, and which the existing test
      does not exercise. On activation for a new user, **migrate the incumbent's un-namespaced keys into
      the incumbent's own namespace first.** Harvest, procurement and finance settings have **no server
      home**; clearing them is data loss wearing containment's clothes.
- [ ] **Three raw-key stores, not two:** `FinanceLegacyStore.ts:15`, `VocabStore.ts:10`,
      **`FarmInviteStore.ts:16`**. Harvest and procurement already route correctly.
- [ ] **Fix `LegacyLocalStorageMigrator`** in the same commit — it reads via `getKey`, so after scoping
      the read misses and it sets its once-only flag anyway, **silently losing the import**.
- [ ] **Clear the farm-context pointer on logout.** `SessionStore.clearCurrentFarmId()` exists with zero
      callers.
- [ ] **Previous farmer's database: quarantine, never delete.** Route nobody to it. Deletion is
      irreversible and the device may hold the only copy — `P10` is not yet true.
      🛑 **`REPRO-A2`'s `a_farmer_database_can_be_deleted_somewhere_in_production_code` is EXPECTED RED
      BY DESIGN and NON-GATING.** It goes green only when production gains a delete call, which this
      section forbids and §17 defers behind a founder retention ruling. **Nobody may "fix" it.**
- [ ] **The `appMeta` ownership claim row is COUNTED by the green gate.** `perUserDatabaseIsolation.test.ts`
      row-counts 21 tables including `appMeta`, so the mandated claim row collides with the
      all-one/all-empty expectations in nine proofs. Carry it in the expected counts **and** assert the
      claim *names the right farmer* — a stronger check than the count it replaces.
- [ ] **Verify — the assertions each dispatch owns, named.**
      **Ownership + fail-closed (LANDED `12e6fb4e`):** `farmer_B_cannot_read_farmer_A_records_after_localStorage_is_cleared_but_indexeddb_survives` ·
      `farmer_B_cannot_read_farmer_A_private_row_after_localStorage_is_cleared` ·
      `farmer_A_keeps_access_to_own_records_after_localStorage_is_cleared`. **These three were not
      listed in any earlier draft of this section.**
      **localStorage move:** the seven A2.2 assertions and the namespace assertion.
      Four sanity anchors stay green throughout. **Assert the orphaning is non-destructive:** old keys remain present and
      readable after the change.

> ## ✅ P0.1 — FOUNDER RULINGS, 2026-08-15
>
> **1. Keep the broader session teardown.** If authentication disappears for **any** reason — manual
> logout, failed refresh, expired session — the active farm context clears and is re-established after
> signing in again. **Re-picking a farm is acceptable friction; seeing the wrong farmer's farm is not.**
> The wiring landing in `clearAuthSession()` rather than the logout button is therefore **approved as
> the better seam**, not tolerated as a workaround.
>
> **2. The empty anonymous database shell is acceptable.** The rule was *anonymous state must not touch
> farmer business data*. An empty neutral shell holding no farmer data, never reused once identity
> resolves, satisfies it. **Do not spend effort chasing literal zero footprint.**
>
> **3. Do not expand P0.1 to the dead legacy stores.** `BackupService`, `LocalDB`, `IntegrityChecker`
> and the no-op audit writer have zero production importers. **Recorded as cleanup debt (X1). Do not
> reopen isolation because dead storage exists.**
>
> **4. The two flipped sanity anchors are correct.** They asserted the unsafe behaviour the ruling
> closes. **A test that says "this unsafe behaviour is expected" must fail when the defect is fixed.**
> Rewriting them to assert the new boundary is right.
>
> **P0.1 CLOSES on one real-browser check:** A logs in → records → logs out → B logs in → **B sees
> none of A's local information** → B logs out → A logs back in → **A's data intact.**
> **No cleanup and no architecture work between P0.1 and P0.2.**

> ## ✅ §P0.1 — **CLOSED. FOUNDER-ACCEPTED 2026-08-15.**
>
> **The real-browser check PASSED**, both halves. Two real accounts, both created through the actual
> sign-in UI — the anticipated "no second account" blocker did not apply, because local dev logs the
> OTP to the server console (`Msg91.UseDevStub: true`) rather than texting it. **No storage was
> hand-edited at any point.**
>
> Evidence: A recorded `FARMER-A-MARKER-P01EXIT` / ₹44,321 → logged out → B signed in via OTP into a
> **separate database with its own owner claim** → a programmatic scan of the DOM **and every object
> store in all three databases** found A's marker, A's amount and A's name **absent** → A signed back
> in and **both were present again**. The recovery half is the half a naive isolation fix breaks, and
> it holds precisely *because* nothing deletes a farmer's database.
>
> **The expected-red assertion stays red.** `a_farmer_database_can_be_deleted_somewhere_in_production_code`
> goes green only when production gains a delete call. **Nothing may be changed merely to make it
> green.**
>
> **Three founder instructions issued at closure:**
>
> **1. The attachment-byte boundary was NOT manually verified — record it, do not fake it, do not
> block on it.** No photo was captured during the run, so no per-farmer Cache Storage bucket was ever
> created and `localFileCache.ts`'s bucketing was never exercised in a browser. Code and tests cover
> it. **This is a remaining acceptance check owned by the media path (§8), not a P0.2 precondition.**
>
> **2. The local `42501` registration failure is separate pre-existing debt.** `/user/auth/register`
> fails locally on a memberships RLS violation (`RegisterUserHandler.cs:71`). The OTP path made it
> moot for this check. **Recorded; do not chase it inside this programme.**
>
> **3. 🛑 EVERY BLOCKING ACCEPTANCE GATE FROM HERE RUNS AGAINST A FROZEN COMMIT.**
> This run's evidence is usable — the concurrently-modified files did not touch the isolation
> boundary, and the proof was durable storage that survives a hot reload — but **the working tree was
> not stable while a blocking security proof was executing**, and that must not recur.
>
> ```text
> freeze commit → clean/stable worktree → run acceptance → record the exact SHA
>               → only then may another agent modify shared files
> ```
>
> Where parallel work is unavoidable, give agents **isolated worktrees or disjoint file ownership**.
> **No concurrent agent may change code underneath a running runtime proof.**

### P0.2 — Audit read-endpoint authorization bypass (new, security-found)

`AuditEndpoints.cs:33-37` filters `.Where(x => x.HasValue)` **before** the membership check, so
`farm_id IS NULL` rows return to any authenticated caller — and the RLS policy admits NULL-farm rows
for every tenant *by design*. **Both defences share the hole.** NULL-farm rows are exactly the
cross-farm ones: invites, joins, membership exits, admin elevations, DEK issue/resolve,
erasure/export/breach. `payload` is returned verbatim.

> ## 🔬 VERIFIED AGAINST THE REPO AT `b465fbd6` — two independent read-only inspectors, 2026-08-15
> **All four paths CONFIRMED at the named lines.** Three corrections and one addition follow. Where
> this block and the prose above disagree, **this block wins** — the prose predates the inspection.

**1. THE PLAN'S NULL-FARM EVENT LIST IS WRONG, AND IT INHERITED THE ERROR FROM A STALE COMMENT.**
Invites, joins and membership exits are **NOT** NULL-farm — all three pass a concrete farm id
(`IssueFarmInviteHandler.cs:117`, `ClaimJoinHandler.cs:137`, `ExitMembershipHandler.cs:151`). DEK
issue/resolve are non-NULL in practice. The list came from `HardenAuditIntegrity.cs:176-177`, true
when written, false since those handlers moved to `AuditEventFactory`. **The real set is 17 sites**;
the seven the plan never named include voice-clip retention, PII-review decisions, AI provider config,
price config, test protocols and schedule templates.

**2. WHAT ACTUALLY LEAKS IS NOT NAMES OR PHONES — IT IS WORSE IN A DIFFERENT WAY.** No phone numbers,
no emails, no worker names (those audits are farm-scoped). What every device receives:
**S3 object keys for other farmers' raw voice recordings** (kept forever under D9) ·
**other users' GUIDs**, including erasure subjects · **unbounded staff free text** — the PII-review
`note` describing detected PII is the highest-value payload in the set · admin elevation reasons ·
DEK handles. It is a **complete cross-tenant privacy-incident ledger plus join keys into other
subsystems.**

**3. 🛑 ON `/sync/pull` THE AUDIT STREAM IS 100% LEAK — RLS ADMITS NOTHING ELSE.**
`TenantConnectionInterceptor.cs:116-122` returns in user-scoped mode **before setting
`agrisync.farm_id`**, so the policy's equality disjunct is always NULL and only `farm_id IS NULL`
matches. There is no `p_user_select_audit_events`. So the pull is not "farm rows plus a NULL leak" —
**farmers have never received their own farm's audit rows at all**, and the application-layer
`farmIdSet.Contains(...)` branch is dead code on that path.

**4. A FIFTH MOUTH, NOT IN THE PLAN — and it is probably CORRECT.** `ExportWorker.cs:150-156` (DSAR)
reads audit events through the **RLS-bypassing admin context**, scoped only by a C# predicate
`ActorUserId == userId`. That is the same actor rule §P0.2 proposes, so it is not obviously a defect —
but it **gets zero depth from any RLS fix**, and any change to actor semantics must be mirrored here.

**5. NOTHING CONSUMES THE AUDIT STREAM. THERE IS NO SCREEN TO BLANK.** `GET /audit` has **zero
callers in `src/clients/`**. The pull's array is typed `auditEvents: unknown[]` (`dtos.ts:399`),
parsed by nothing, consumed by no reconciler. The client's own `db.auditEvents` is a different,
locally-written table. **The safest fix is also the most complete one.**
> 🛑 **BUT DO NOT DELETE THE FIELD FROM THE WIRE.** Old APKs are in farmers' hands and the field is
> non-optional in their bundled schema; removing it risks a parse failure that breaks sync entirely.
> **Stop populating it — send an empty array — and leave the field.** Removing it is a later,
> separate change gated on client rollout.

**6. THE PLATFORM-ADMIN "CLAIM" DOES NOT EXIST AND MUST NOT BE INVENTED.** It was **deliberately
removed** (`JwtTokenIssuer.cs:43-48` — *"tokens are identity, not authorization"*). The real mechanism
is `IEntitlementResolver` → `AdminScope.IsPlatformAdmin` (`EntitlementResolver.cs:87-96`), enforced
via `AdminScopeHelper`, which `AdminAuthGateTests.cs:85-95` already mandates. **A new `ModuleKey` for
the audit ledger must be added** — none exists.

**7. 🛑 STOP CONDITION — TIGHTEN `USING` ONLY. A SYMMETRIC `WITH CHECK` BREAKS EVERY ADMIN ACTION.**
`FORCE` applies policies to the owner, and the admin context sets **no GUCs at all**, so admin and
worker audit writes succeed **only** because `WITH CHECK` still carries `farm_id IS NULL`. Tightening
it symmetrically `42501`s the audit-first row written *before* the privileged context is handed
back — every admin elevation starts failing. **Before touching `WITH CHECK` at all, confirm the
production migration role's `rolbypassrls`** — local roles prove nothing, the local migration
connection is superuser.

**8. THE HOLE IS WRITTEN THREE TIMES, NOT ONE.** SQL (`ShramSafalRepository.cs:676`), handler
(`PullSyncChangesHandler.cs:131`), policy. **An implementor reading the old task text fixes one line.**

**9. NO PERMISSIVE SIBLING POLICIES EXIST** — exactly one policy on the table, so amending it is
genuinely sufficient on the database side. `actor_user_id` is `NOT NULL`, indexed, guarded at every
write site, and **0 of 12,022 rows are NULL** — a viable key. Note ~all NULL-farm rows carry system
sentinels (`SystemActor.cs:46-87`), so an actor rule correctly hides essentially all of them.

**10. NO `E3` PROOF OF AUDIT ISOLATION EXISTS.** Every current audit query in tests runs as
**superuser** and proves nothing. Nine suites carry the vacuity guard; none covers this table. The
exemplar `FieldOperatorRlsRealPostgresTests.cs` **was verified to carry the cited shape** — clone it.

### The tasks

- [ ] **Stop populating `auditEvents` in the pull response — send an empty array, keep the wire
      field.** Fix all three layers (`ShramSafalRepository.cs:676`, `PullSyncChangesHandler.cs:131`,
      the policy), not one. **Check the watermark**: `PullSyncChangesHandler.cs:510-512` derives
      `maxTimestamp` from these rows, so removing them changes the cursor — confirm it cannot skip data.
- [ ] **Endpoint rule via `AdminScopeHelper`, not a claim.** NULL-farm rows visible only to their own
      `actor_user_id`, or to a platform admin resolved through `IEntitlementResolver`. **Add the audit
      `ModuleKey` and its `EntitlementMatrix` row.** Do **not** touch the farm branch
      (`AuditEndpoints.cs:58-84`) — it is correctly gated.
- [ ] **Amend `p_tenant_audit_events`'s `USING` only** — farm equality, OR NULL-farm restricted to
      `actor_user_id = current_setting('agrisync.user_id')`. **Leave `WITH CHECK` as it stands** (§7).
- [ ] **Retire the fail-open default body** (`IShramSafalRepository.cs:135-136`). **~25 test doubles
      implement only the unscoped overload**, so deleting it is a suite-wide compile break and keeping
      it preserves the `F7` hazard. **Default to `throw new NotSupportedException()`** — fails loudly
      instead of open — unless the implementor finds a cheaper total override.
- [ ] **Assert the operator-hydration amplifier shrinks.** `PullSyncChangesHandler.cs:567-570` feeds
      leaked `ActorUserId`s into `CollectOperatorIds`, hydrating foreign operator records at `:153`.
      The audit fix shrinks this automatically — **assert it, do not assume it.**
- [ ] **`E3`-shaped proofs cloned from `FieldOperatorRlsRealPostgresTests.cs`**: vacuity guard at the
      top of every fact, FORCE/ENABLE catalog assertion, loadability probe, and a non-admin caller
      proven unable to read another actor's NULL-farm rows **through the endpoint AND a pull**.

> ## ✅ §P0.2 — LANDED ON FEATURE BRANCH `da48d05b`. NOT MERGED, NOT RELEASED.
>
> All three layers closed. First real `E3` audit-isolation proof in the codebase — 7 facts, vacuity
> guard on every one, FORCE/ENABLE catalog assertion, loadability probe before every rejection, and an
> assertion that **exactly one policy exists** (finding 9 holds only while it *is* the one).
> Mutation proof on five guards, each reverted → named assertion failed → restored by direct file hash.
> Backend suite baseline-differenced: same 58 pre-existing failures before and after, +7 new passes.
>
> **Watermark: cannot skip data.** `ComputeNextCursor` is a `Max` chain floored at the caller's
> `SinceUtc`; removing a term moves the result earlier or leaves it equal, never later, so at worst a
> window is re-read. Pinned by a fact that plants a NULL-farm row an hour ahead and fails if the cursor
> passes it. *(Analysis, not measurement: the **old** code could set the cursor from a foreign row
> later than the query moment — a skip hazard the new behaviour removes by construction.)*
>
> **The three layers are over-determined** — reverting the handler alone, or handler+policy, still
> yields an empty array. It takes all three to reproduce the leak. The plan's "written three times"
> is confirmed as a measured property.
>
> ### 🛑 TWO CONSEQUENCES THAT NEED A FOUNDER DECISION BEFORE RELEASE
>
> **1. ✅ FOUNDER-RULED 2026-08-15: KEEP PLATFORM-ADMIN AUDIT ACCESS CLOSED.** The branch returns ZERO
> rows on the app-role connection, and that is the accepted state — not a regression to fix. Reopening
> it is a *widening* requiring its own justification and design; **no executor may reopen it as a
> side effect of other work.** **Asserted as a fact so it cannot drift silently.** No product screen is
> affected — `GET /audit` has **zero callers in `src/clients/`**, confirmed. But the admin audit read
> is now closed until a deliberate widening is designed. *(Separately: that route establishes no tenant
> scope and is not on either interceptor list, so by code reading it **500s today** regardless. Not
> touched — wiring scope is its own change.)*
>
> **2. The DSAR export depends on a production role property that could not be measured.**
> `ExportWorker`'s `audit_events.json` reads through the admin context. **Locally that role is
> superuser and bypasses RLS; if the production migration role does NOT bypass, the subject's audit
> export goes from "their own NULL-farm rows" to EMPTY** — a data-rights regression, silent.
> **Establish the production role's `rolbypassrls` before GR.** The plan's §4 and §7 assumed opposite
> answers to this; neither was verified.
>
> **Dev-database note:** the migration is **not yet applied** to `agrisync_dev_v2`. `Program.cs:1185`
> auto-migrates on startup, so restarting the dev backend applies it. The backend was stopped during
> this work (it held the build output) and was not restarted.
>
> **Outstanding:** the DPDP/MeitY compliance check the repo's own hook requests on every migration
> write did not run — the skill was unavailable in the execution context. **Run it before GR.**

### Carried out of P0.2 — named, not silently dropped

- **The `WITH CHECK` write-side hole.** Any tenant able to INSERT can write a globally-readable
  NULL-farm row, and `UPDATE`/`DELETE` are revoked so a poisoned row is **permanent**. Closing it
  requires giving the admin write path its own identity — real scope. **Trigger: immediately after
  P0.2's `USING` fix is prod-proven. This is not deferred indefinitely.**
- ✅ **`TRUNCATE` — FOUNDER-APPROVED 2026-08-15, RIDES ALONG.** `HardenAuditIntegrity.cs:169` revoked
  `UPDATE`/`DELETE` to make the ledger append-only and **never revoked TRUNCATE**, which erases the
  whole ledger in one statement, bypassing RLS. **The append-only guarantee had a hole the size of the
  table.** Ruling: **revoke it from the normal application role, while preserving deliberate
  privileged maintenance access.** The capability is not deleted — it is moved behind a role a farmer
  request can never reach. **Do not widen this into a permissions review.**
- **`ResolveTenantDekHandler.cs:48` echoes a client-supplied `dekId` verbatim** into an append-only,
  everyone-readable payload — a stored-injection primitive. Out of P0.2's scope; recorded.
- **The two DEK sites are non-NULL only by co-assignment.** An explicit `FarmId` guard would stop a
  future `SetTenant` caller silently creating NULL-farm DEK rows.

### P0.3 — `ssf.farm_boundaries` RLS

**Corrected:** this is **not** an oversight. It is a documented allowlist exemption
(`RlsExemptionAllowlistTests.cs:176-184`) whose justification is conditional and **expires the moment
geometry read-back ships** (D6). Closing it means deliberately editing the allowlist — the control
working as designed.

> 🛑 **ORDER CORRECTED — reproduce the scope wiring FIRST, migrate second.** `PUT /farms/{id}/boundary`
      never establishes tenant scope; it takes the farm from the route and authorizes in the handler.
      **Landing the policy before the scope is wired means the setting is unset, the read filters to
      nothing (so the version silently resets to 1 and the prior boundary is never archived), and the
      write throws `42501`** — an availability *and* integrity break. The draft had these tasks in the
      wrong order.

> ## 🔬 REPRODUCED AT RUNTIME 2026-08-15 — six corrections. **This block outranks the prose above it.**
>
> **1. 🔴 SAVING A FARM BOUNDARY 500s FOR EVERY FARMER, TODAY. This is a LIVE availability defect,
> not a latent one, and it has nothing to do with RLS.** Measured against a real JWT for the farm's
> `PrimaryOwner`: `GET /farms/{id}` → **200**, `PUT /farms/{id}/boundary` → **500**, nothing written.
> ```
> InvalidOperationException: TenantConnectionInterceptor: no tenant claim set and not in admin scope.
>   TenantConnectionInterceptor.cs:125 ← ShramSafalRepository.GetFarmByIdAsync:45
>   ← UpdateFarmBoundaryAuthorizer:45 ← AuthorizationBehavior:38
> ```
> It dies on the **first DbCommand of the authorization stage** and never reaches the handler.
> **Attributable:** `69262b9f` (2026-06-09) added `EstablishForCallerAsync` to three `FarmEndpoints`
> routes — **all GETs**, per its own scope line *"farm **reads**"*. The PUT was missed, and has been
> dead since FORCE-RLS landed on `ssf.farms`. **Two live client call sites hit it:**
> `BackendFarmGeographyClient.ts:223` and `inviteApi.ts:254`.
> ⚠️ **Measured on dev.** The failing code path is environment-independent, so production is very
> likely identical — **but that is inference. Confirm against production before asserting it.**
>
> **2. 🛑 THE PLAN'S STATED FAILURE MODE IS NOT REACHABLE TODAY — and step two must not defend the
> wrong thing.** The route 500s at `ssf.farms` before `farm_boundaries` is ever queried, so landing
> the policy first is **inert, not destructive.** The ordering instruction is still right; the
> mechanism is different:
> > **The integrity break fires if someone "wires the scope" by adding `/shramsafal/farms` to
> > `SkipPathPrefixes` instead of injecting `ICallerFarmTenantScope`.** Admin elevation makes the
> > interceptor a no-op that sets **no GUC**, so with a policy in place the read filters to nothing →
> > `?? 0` gives version 1 → `?.Archive` no-ops → the insert fails. **The skip-list is the tempting
> > one-line shortcut, and it is the trap.**
>
> **3. Lines 77-79 of `UpdateFarmBoundaryHandler.cs` are the entire hazard.** `nextVersion` and
> `activeBoundary?.Archive(...)` both derive from **one RLS-filtered read**, and both degrade
> *silently* — `?? 0` and `?.` are the failure mode, not an exception. A partial unique index
> (`ux_farm_boundaries_active_farm_id`) is a second backstop that would raise `23505`.
> **The assertion that matters is the SECOND `PUT`:** version must reach `2` and the prior row must
> archive. **A single-write test passes trivially and proves nothing.**
>
> **4. `FORCE`'s real justification is TABLE OWNERSHIP, and the plan's "no such GRANT exists"
> sentence is WITHDRAWN as written.** `GRANT agrisync_owner TO agrisync_app` is not in migration code,
> but it **is** documented in-repo (`2026-07-19-labour-deploy-handoff.md:210,229,407`) and is **live in
> the database** (`pg_has_role → t`). The plan did not invent the relationship; it failed to find it.
> **The stronger fact it missed: `agrisync_app` directly OWNS the `ssf` tables** (`pg_class.relowner`),
> and **a table owner bypasses `ENABLE`-only RLS.** So `FORCE` is load-bearing on ownership alone —
> state that, verifiable in one `pg_class` query. Neither role attribute is the reason
> (`rolsuper=f`, `rolbypassrls=f`).
>
> **5. 🔴 UNFILED PRIVILEGE DEFECT — file it, do NOT fix it here.** Two independent measured routes to
> policy bypass: `agrisync_app` is a **member of `agrisync_owner`**, and `agrisync_app` **owns the
> tables**. Either lets the runtime role `DROP POLICY` or `ALTER TABLE … NO FORCE`, which `FORCE`
> cannot prevent. *(Dev-measured; prod is asserted-but-unverified by the handoff doc.)*
>
> **6. The allowlist justification is ALREADY FALSE and must be corrected, not deleted.** It claims
> `farm_boundaries` is *"accessed only via that join … no direct SELECT path exists"*. There **is** a
> direct `SELECT` (`ShramSafalRepository.cs:35-41`), and has been since the table shipped. The D6
> expiry condition is right; the prose defending it is wrong, **and the same wrong prose still covers
> `farm_invitations` and `farm_join_tokens` after `farm_boundaries` is removed.**
>
> ### 🛑 ENVIRONMENT FACT THAT INVALIDATES A BRIEFING PREMISE
> **The dev database is 11 migrations behind, and starting the backend does NOT apply them.**
> `Program.cs:944-985` gates every migration call on `!IsDevelopment()`. Measured: **91** migration
> files in the repo, **80** rows in `ssf.__ef_migrations`; neither P0.2 migration is applied.
> **Step two must run `dotnet ef database update` explicitly.** Any earlier statement that startup
> auto-migrates in Development is wrong.
>
> ### The sequence step two must follow
> 1. **Wire the scope via `ICallerFarmTenantScope` — NEVER via the skip-list.** Mirror
>    `FarmEndpoints.cs:52-70`. It is the only mechanism that sets both `agrisync.farm_id` and
>    `agrisync.owner_account_id` after an RLS-gated membership check.
>    **Authorization overlap to respect:** `CallerFarmTenantScope` forbids non-**members**;
>    `UpdateFarmBoundaryAuthorizer` requires **owner**. Scope runs first and **is not the ownership gate.**
> 2. **Prove it at runtime — the same `PUT` returns 200 and one row lands at `version = 1`.**
>    Baseline is a 500 and zero rows, so the delta is unambiguous.
> 3. **Then** the migration: `ENABLE` + `FORCE`, policy on the direct `farm_id` column, **house shape —
>    match, do not invent.**
> 4. **Prove versioning survives the policy on the SECOND write** (§3 above).
> 5. **Edit the allowlist deliberately**, and fix the surviving comment (§6 above).
- [ ] Migration: `ENABLE` + `FORCE` row level security; policy on the direct `farm_id` column.
      Doctrine `F8` does **not** apply — the tenant column already exists, so no `EXISTS` check is needed.
      > **Two justifications in the draft were wrong and are withdrawn.**
      > **`NULLIF` is hardening, not a fix for a throw.** `current_setting(name, true)` returns NULL when
      > unset; it does not throw. Fourteen existing tables use the bare form in production. Use `NULLIF`
      > if you want the extra guard, but **match the house shape** rather than making this the one
      > policy that differs on an invented rationale.
      > **The `FORCE` justification was unsupported.** No `GRANT agrisync_owner TO agrisync_app` exists
      > anywhere in the repo. **Establish whether it is true.** If it is, that is an unfiled P0 privilege
      > defect in its own right — an owner-capable role can `DROP POLICY` outright, which `FORCE` does
      > not prevent — and it must be filed, not papered over. If it is false, the draft invented a
      > justification, which breaks this plan's own repo-is-truth contract.
> **Do not add a permissive user-scoped SELECT policy** until read-back exists — permissive policies
      OR together (`E4`: visible ≠ authorised).
- [ ] Proof cloned from the existing exemplar `FieldOperatorRlsRealPostgresTests.cs`: the `E3` vacuity
      guard (`rolsuper OR rolbypassrls` asserted **false**, `current_user` asserted) at the top of every
      fact; the FORCE/ENABLE catalog assertion; `E4` **both directions** — foreign parent and forged
      tenant column, asserting SQLSTATE `42501`, with a same-shape control and a superuser recount
      proving zero rows landed.
- [ ] **Fix the allowlist regex** (`RlsExemptionAllowlistTests.cs:293-295`) — it matches only
      `migrationBuilder.CreateTable`, so raw `CREATE TABLE` is invisible. **Ten tables sit in neither
      set.** Cheaper than any single policy, and converts an unknown into a decision list.
- [ ] **Reproduce before treating as a defect:** `PUT /farms/{farmId}/boundary` does not inject
      `ICallerFarmTenantScope`. Either it 500s today at the interceptor's fail-closed throw, or a call
      path was missed. **Establish which before changing anything.**

### P0.4 — Strip the raw transcript from correction events

**The locked ruling is already violated, in two places.** `rawTranscript` is **required** on
`CorrectionEvent.ts:37` and stored in unencrypted IndexedDB; and `ssf.correction_events` persists
`OriginalParseRaw`/`CorrectedParse` containing `fullTranscript`, unredacted.
**Matrix line 72 ("no server copy exists") is wrong.**

- [ ] **Remove `rawTranscript` AND `sourceText`.** The draft named only the first. `sourceText` is *"the
      transcript chunk that produced this field"* — verbatim speech, and **worker names live in exactly
      those chunks**. Keep: field · AI value · farmer value · **originating operation reference** ·
      model version · prompt version.
- [ ] **Deal with the transcripts already persisted, or this is a bleed-stop mislabelled as a fix.**
      Rows exist in production **and** unencrypted on every handset today.
      **And §P0.8 currently lists `aiCorrectionEvents` as "protected, never auto-evicted" — the plan
      would be protecting the exact rows it says must not exist.** Reconcile the two sections: the
      *structured signal* is protected; the *transcript inside it* is removed.
- [ ] **This is a breaking client change and needs a migration.** `rawTranscript` is **required** on the
      client type, so removing it invalidates every stored correction row on farmers' phones. The draft
      had no migration task, no Dexie handling and no test.
- [ ] Stop persisting raw drafts server-side; store the structured signal only.
- [ ] **Preserve `promptContentHash`** — today it is discarded, and it is the only tamper-evident prompt
      identifier. Stop substituting a **fresh random UUID** for a non-UUID `sourceAiJobId`, which
      silently breaks the link to the originating job.
- [ ] **Ordering:** this lands **before** the correction bridge is made durable. The bridge is
      fire-and-forget today; making it reliable first would ship more raw transcript, more reliably.

### P0.5 — Stop the same-device destruction

- [ ] **Extend `preserveLocalOnlyFields`** from four fields to all fourteen, using the **same predicate
      the existing four use** — *"the response carried this field"*, **never** *"the value came back
      non-empty"*. The second form re-opens a data loss already caught once here.
- [ ] **Verification is the sharpest case:** the response carried **no** verification information and
      the client read that silence as `DRAFT`, overwriting the farmer's own `CONFIRMED`. Preserve local
      verification when the response makes no statement. **Do not change `mapVerificationStatus`** — the
      mapping is right; the caller is wrong to treat silence as a statement.
> 🛑 **DO NOT merge by `task.id`. An earlier draft specified this and it duplicates money.**
      > The client **mints a fresh UUID per payload build** for any non-UUID local id, and the
      > manual-entry surface produces exactly those (`act_global_daily`, `irr_{timestamp}`). So
      > merge-by-id finds no match and keeps **both** rows. Machinery compounds it: it is sent as a task
      > and rebuilt as a *crop activity*, so the merge adds a phantom "Machinery Tractor" beside the
      > preserved local machinery entry — the exact "two representations visible to the farmer" §9
      > forbids. Inputs carry `cost` and machinery carries rental and fuel: **this is duplicated rupees,
      > not duplicated rows.**
      ✅ **D1 RULED — the answer is neither "local wins" nor "server wins". It is honesty, and it is
      transitional.** The founder rejected both binary framings. The containment rule:
      > **1. Never overwrite richer local truth with a lossy or fabricated server reconstruction.**
      > **2. Never merge using unstable identities** — the mint-a-fresh-UUID path makes id joins
      >    duplicate money.
      > **3. On any other device, show only what the server genuinely knows**, and mark the rest
      >    **partial / unknown**. Never fabricate to fill the gap.
      >
      > So the originating device may temporarily hold richer information **until D1 gives those fields
      > a faithful server contract.** This exists only because `P10` is not yet true for them.
      > **It is explicitly transitional: once D1's round trip is proven, server authority wins and this
      > protection is deleted.** Do not let it harden into the permanent model.
      **Add this expiry to §17's trigger column: the protection ends when D1 stage 3 is prod-proven.**
- [ ] 🛑 **Fixing the blob is not enough — the INDEX columns are computed outside the guard.**
      `reconcileLogs` derives `verificationStatus` and `isDeleted` from the **incoming rebuilt log**,
      outside `preserveLocalOnlyFields`. `toDailyLog` never sets `deletion`, so `isDeleted` is written
      `0` regardless of what the guard preserves — **and every reader queries the index, not the blob.**
      Without this, after the full fourteen-field extension: the deletion **still resurrects**, and the
      farmer's `CONFIRMED` **still reads as `DRAFT`** in status queries. The task as drafted could not
      have passed its own acceptance column.
> **NOT WORK — do not tick, do not dispatch.** Ruling Q9's immediate neutralisation is satisfied by
> the preservation above. **The type-level fix waits for F1 (§17), and the `cropActivities` half is
> founder-blocked on D1.** As a live checkbox this sent a subagent straight at the blocked ruling.
- [ ] **`serverModifiedAtUtc` erasure is a bigger surface than `delete()` — corrected.** `save()`
      deliberately preserves it. **`batchSave()` does the same bare `put(toRecord(log))` with no
      preservation, and `batchSave` is the primary confirm-and-save path.** So the freshness guard is
      disarmed on **every log a farmer saves**, not only on deletes. An earlier draft named only
      `delete()` and would have left the larger surface live. Fix all three paths; `save()` is the model.
- [ ] **Add `REJECTED_USER_REVIEW` to the pull guard.** Today a pull overwrites the local record while
      the farmer still has an unresolved conflict holding the intent. It self-releases correctly:
      discarding sets `REJECTED_DROPPED`, editing sets `PENDING`, and both exit the list. **Verified —
      no record gets permanently guarded.**
- [ ] **But the guard FAILS OPEN, and that must be fixed in the same task.** `readPendingLogIds`
      catches any Dexie error, warns, and returns an **empty set** — silently disabling the whole guard
      and letting the pull overwrite every pending record. Adding a sixth status to a list that can
      silently evaluate to nothing is a guard with a bypass, and "prove each guard by mutation" would
      **not** catch it. Fail closed: on error, guard everything.
- [ ] **Prove each guard by mutation:** revert, watch the **named** assertion fail, restore
      byte-identically, **verify by hashing the named file directly** — not `git diff --stat`, which §13 G3
      forbids as an oracle. "23 failed" is not evidence;
      `machinery_survives_the_first_pull_after_acknowledgement` is.

### P0.6 — Money integrity

- [ ] **Carry `ErrorKind` on the wire.** `ToOutcome` (`PushSyncBatchHandler.cs:1900-1908`) **drops
      `result.Error.Kind`**, which already exists and is already tagged on every error (11 as `Conflict`).
      The client is reduced to string-sniffing a hand-written list. **This is the root cause of the
      correction defect, not the missing list entry** — adding a string fixes one mutation; carrying the
      kind removes the class.
- [ ] **Send the keys the server accepts:** `financeCorrectionId` (not `correctionId`), and **remove
      `originalAmount` entirely** — it was a hardcoded `0`, a fabricated previous value in a money
      ledger. The server reads the real previous amount from the entry itself.
- [ ] **The correction id must be a bare UUID.** `financeCorrectionId` is `ZGuid.optional()` and the
      current id is `madj_`-prefixed. Sending it as-is makes the validator **throw inside an unawaited
      promise**, so the correction would stop reaching the outbox at all — **strictly worse than today**,
      and the same file documents this exact failure ninety lines above. `REPRO-A3:144` catches it.
- [ ] **Stable idempotency keys — three corrections to an earlier draft of this plan, each of which
      would have shipped a defect:**
      - `add_cost_entry:{costEntryId}` · `correct_cost_entry:{financeCorrectionId}` ·
        `set_price_config:{configId}` — these are correct.
      - **`verify_log` keys on `verificationEventId`, the per-attempt id — NOT on
        `{dailyLogId}:{status}`.** The state machine **readmits prior states**: editing a confirmed log
        returns it to draft, and re-confirming is the ordinary flow. A key on the target status means
        the second confirm hits a spent key, the server answers `duplicate`, the client marks it
        applied, and **the log stays a draft on the server with no error shown.** An earlier draft said
        "no finer" — that was inverted.
      - **`targetStatus` is not a field the server accepts.** The allow-list is
        `{verificationEventId, dailyLogId, status, reason, verifiedByUserId}`; the client sends `status`
        and never sends `verificationEventId` at all. Naming a non-existent field as the key was the
        exact drift G1 exists to catch, inside the plan that proposes G1.
      - **`allocate_global_expense` gets NO composite hash. Leave it keyed on the cost entry.** The
        handler is **already idempotent on `costEntryId`**: if a ledger exists it returns the existing
        one as success and never applies the new split. Adding a set-hash lets a *different* allocation
        past the dedupe ledger into a handler that silently no-ops and reports `applied` — the client
        then records an edit the server never made. The earlier premise ("an edited split re-uses a
        spent key") was false: an edited split cannot land at all.
- [ ] **State the benefit accurately.** Replay and retry are **already** idempotent — `clientRequestId`
      is minted once at enqueue and persisted, so every retry re-sends the same key. Stable keys buy
      exactly one thing: **a key the crash reconciler can reconstruct without the queue row.** Do not
      sell them as fixing replay.
- [ ] **`DeviceIdStore` is a FOURTH raw-key store** — and **both** server dedupe layers key on
      `deviceId`. **This is a hard ordering constraint P0.1 must respect:** if the isolation work moves
      or re-mints the device id, every unsent mutation's dedupe key changes and the reconciler's
      re-enqueue fails as a store error, which classifies retryable, burns five charged retries, and
      lands permanently failed — **manufacturing the exact dead end P0.7 exists to clean up.**
- [ ] **Mint the entity id once at intent capture**, keyed to the logical action. **A stable key cannot
      fix an unstable identity** — the second tap already carries a different `costEntryId`, so the
      stable-key fix addresses replay and retry, **not** double-tap on non-deterministic paths. Do not
      claim otherwise.
- [ ] **Guard or delete the `ClientCommandId ?? ClientRequestId` collapse** (`SyncEndpoints.cs:44`).
      Today both are always equal so nothing breaks; the moment they are given distinct meanings, the
      echo returns the command id, the client's result map misses, and **a committed mutation is marked
      failed** and charged a retry.

### P0.7 — Offline trust

- [ ] **Reset all three wedged tables.** `uploadQueue.uploading` · `pendingAiJobs.processing` ·
      `attachments.status === 'uploading'` — the worker sets the attachment and queue rows together, so
      resetting only the queue leaves the attachment wedged.
      **Run at worker start only, never inside the cycle. Do NOT "mirror `resetInFlightMutations`" —
      that runs inside every cycle.** An executor told to mirror it would put the reset in the cycle,
      and the attachment worker runs on its own independent timer, so an in-cycle reset would clobber
      rows that worker has genuinely in flight and re-upload them. *(Corrected: an earlier draft said
      "mirrors the existing reset". It does not.)*
      **Do not widen `UploadQueueRetry` and do not change its test** — its narrow `failed`-only scope is
      deliberate and correct; the wedge is unowned, not defended.
- [ ] **Dependency-pending is a third failure class — and the terminal set must be enumerated
      explicitly, or it loops forever.** A child whose parent was rejected returns `DailyLogNotFound`,
      classifies retryable, burns five charged retries and strands with no remedy.
      **The naive rule loops:** "parent still open" is satisfied by a parent parked in
      `REJECTED_USER_REVIEW` — neither applied nor discarded — so the child stays retryable **and
      uncharged** and re-pushes every 15 seconds forever, never escalating. Cap-exhausted `FAILED` has
      the same shape.
      **Correct rule:** *parent in `PENDING` or `SENDING`, or `FAILED` below the cap →
      retryable, uncharged, backed off. Parent in `REJECTED_USER_REVIEW`, `REJECTED_DROPPED`,
      cap-exhausted `FAILED`, or absent → **rejected, naming the parent.*** Enumerate both sets in code;
      do not express it as "still open".
- [ ] **Bound the sibling lookup's cost.** It must match on payload content in **any** status, only
      `[deviceId+clientRequestId]` and `status` are indexed, and F2 blocks pruning applied rows — so the
      naive form is an unindexed scan over a monotonically growing table, per child, every cycle. Index
      it or key it, and say which.
- [ ] **Promote cap-exhausted `FAILED` into an actionable list.** The chip says `NEEDS_FIX` while the
      conflict screen reads only `REJECTED_USER_REVIEW` — it points at a door that is not there.
- [ ] **Backoff on the mutation queue.** Copy `AiJobWorker`'s shape. A non-indexed field needs **no
      Dexie bump**. Must respect the dependency-pending rule or it manufactures orphans every cycle.
- [ ] **Crash re-enqueue reconciler.** A death between the log write and the enqueue strands the record
      permanently and invisibly, and nothing ever re-scans. **A reconciler strictly dominates an atomic
      transaction**: it also fixes the "plot not yet pulled" skip case and recovers records **already
      stranded on farmers' phones today**. Predicate: a non-deleted log row with no `mutationQueue` row
      for `create_daily_log:{id}` in **any** status. Safe **only because keys are stable** — this task
      lands after the stable-key task, and it is why `APPLIED` rows must not be pruned yet.

### P0.8 — Device storage pressure (largest silent data-loss vector)

Finished AI jobs keep raw audio and image bytes **forever**; attachment bytes survive a successful
upload. With no compression this exhausts the origin quota, and **new captures then stop queueing** —
the farmer's next recording silently fails. Nothing in the client observes storage at all.

- [ ] **`QuotaExceededError` catch** with an explicit message naming cause and remedy, an entry in the
      honest-surface registry, and an emergency sweep-then-retry-once.
- [ ] **Delete finished voice-job blobs.** The same bytes exist twice — in the AI job **and** in
      `voiceClips`. Under ruling D9 the `voiceClips` copy is now **retained forever**, so dropping the
      duplicate job copy is still safe and still halves offline-voice storage. **The reason is
      duplication, not expiry.**
- [ ] **DECIDE and record: does receipt/patti media get a sweeper D9 permits, or does it stay
      unswept and say so?** 🛑 **The existing purge call is a no-op (`return 0`) under ruling D9 — do
      NOT schedule sweeping against it.** Receipt and patti jobs may carry an `expiresAtUtc`, but **nothing sweeps
      it today**. Either build a sweeper D9 permits, or leave the field unswept and say so. A task that
      completes while nothing is ever swept is worse than no task.
> 🛑 **DO NOT delete attachment bytes in P0. This task moves to §8, after server-side finalisation
      exists.**
      > **Why this was the most dangerous item in the draft.** An earlier version deleted local bytes on
      > a **client-side** `status === 'uploaded'` flag, while the `HeadObject` finalisation that actually
      > proves the bytes landed is sequenced **after F2** — several deploys later. The acceptance suite
      > only ever re-reads a *freshly captured* log, so the eviction path is invisible to it. Combined
      > with the gate defects corrected in §P0.0, every gate could read green, the founder gate could be
      > ticked, prod proof could show a matching SHA — **and farmers' photos would be being deleted
      > before the server ever confirmed it had them.**
      > **Rule: no local media is deleted until a server-verified confirmation exists for that object.**
      > Until then, media bytes are Tier-2 protected alongside unsent work.
- [ ] **Finished voice-job blobs may still be dropped in P0** — and only these — because the same bytes
      demonstrably exist in a second store **that retains them permanently under ruling D9**. State
      *that* reason in the code. 🛑 **Do NOT write "a working sweeper" — that justification is false
      since D9 and would put a lie in the source.**
- [ ] **Protected, never auto-evicted:** unsent mutations · unfinished uploads and their bytes ·
      **finished-but-server-UNVERIFIED attachment bytes** · unfinished AI jobs · `aiCorrectionEvents`
      (the structured signal; the transcript inside it is removed by §P0.4) · `appMeta` (holds GPS
      consent) · every localStorage business key · **and `logs`, until F1 lands** — 14 fields have no
      wire representation, so a log row is still the only copy.
      > 🛑 **The third item was missing from an earlier draft of this list**, while the rule above it
      > already said no media may be deleted without server verification. The rule was corrected and
      > **the checklist an executor actually ticks was not** — leaving exactly the deletion the rule
      > exists to prevent.
> 🛑 **The "emergency sweep" needs a defined target set before it can ship, and it must not ship
      before §P0.1.** §17 defers the eviction policy until *after* §P0.8, so as drafted the sweep ships
      before the policy that bounds it exists. And §3 hard rule 1 forbids any cleanup or sweeper before
      isolation lands — an unbounded sweep running against the fail-open shared database described in
      §P0.1 deletes the wrong farmer's data. **Sequence: §P0.1 → eviction policy → sweep.**

---

### P0.9 — Three security items that cannot wait for a domain

- [ ] **Disable or make real the fabricated export link.** `ExportWorker.cs:221` string-concatenates a
      URL with **no signature and no credential**, against a bucket that does not exist (404), and
      persists it as the download link for a **complete DPDP personal-data export**. The domain layer
      even validates the string is non-empty — guarding the *shape* of a value that carries no
      authority. Meanwhile the actual bundle lands in the **undocumented raw evidence bucket**.
      This is `P5` on the most sensitive artefact the system produces. Disable it or make it real;
      do not leave it.
- [ ] **Give raw blobs a subject linkage — before the next erasure request, not after.** The erasure
      cascade deletes the table where the only pointer lives, so the audio survives, unattributable,
      forever. **This is the one item where waiting makes the problem permanently unfixable rather
      than merely larger.** Either add a tenant dimension to the blob index, or preserve the pointer
      through erasure.
- [ ] **Bind additional authenticated data into the voice seal.** The sealing primitive binds nothing
      today, so a ciphertext could be moved between rows. Bind the clip id and owner account.
- [ ] **Fix the bare-cast RLS policy on `p_user_correction_events`** — it uses the form that **throws
      on every claimless request**, the same bug the boundary policy must avoid. Cheap, independent,
      currently live.

> **Correction to §8 of this plan:** "the storage interface has no delete method" is true of
> `IAttachmentStorageService` and **false** of `IRawBlobStore`, which exposes `DereferenceAsync` and
> has one live caller. The orphan reasoning still holds — production lacks the S3 permission — but
> state it accurately.

---

## 6. FOUNDATION

**Rule: build the smallest reusable primitive D1 requires.** Extend when D2 proves it insufficient.
No generic platform, no premature abstraction, no speculative infrastructure.

### G1 — Contract-parity CI gate *(the one piece of foundation that pays for itself before D1)*

The server allow-list is **hand-written** at 14 sites while the canonical shape is **generated**, and
nothing compiles them against each other. **That asymmetry is the entire mechanism of the correction
defect**, unguarded across all fourteen mutations. A second latent instance already exists
(`verify_log.zod.ts:12` permits a key the server refuses) — the client is correct there only because
someone wrote a comment. **The guard is a comment.**

- [ ] Test parsing the 14 `PayloadHasOnly` allow-lists and asserting each equals its Zod key set.
      Runs in CI, needs no database, fails the moment either side drifts. **In `ci-gate.yml`.**
- [ ] **Sequence: land the drift test first, fix the producers, then add `.strict()`.** Adding
      `.strict()` first converts server rejections into client-side silent throws inside unawaited
      promises — worse than today.

### F0 — File splits (blocking, mechanical)

`check:file-sizes` caps at 800. `log.types.ts` = 762, `dtos.ts` = 752, `DexieDatabase.ts` = 772 — the
exact three files F1 must widen.

- [ ] Pure splits, zero behaviour change, own commits, verified by line-count conservation in
      `git diff --stat` with nothing else in the diff.

### F1 — Contract semantics, **DailyLog only**

- [ ] **Generalise the existing predicate.** `serverStatedContext` (`logsReconciler.ts:58`) is already
      correct. Generalise that function. **Do not build a wrapper type.**
- [ ] **One provenance convention**, copied from the one that already exists
      (`create_daily_log.zod.ts:73` — *present means the farmer stated it; absent means the server
      applies its default and records `Assumed`*). **Not** a seven-field envelope on every value.
- [ ] **One business-truth completeness field:** `legacyPartial`. Nothing else.
- [ ] **`financialSummary` becomes expressible as "server stated nothing"** — today it is non-optional
      and dereferenced directly by display code, which is why the zeros cannot be fixed by omission.
> **Explicitly NOT in F1:** version tokens · `capturedAt`/`actor` on every field · a provenance
      envelope type · media state · processing state · sync state · any Dexie bump · any other domain.

### F2 — Sync adoption + four gaps *(not a design; the state model exists)*

- [ ] **Declare the six existing statuses canonical** in one file, with three pure adapters mapping the
      other two queues onto them, and an architecture test forbidding a seventh queue table. A
      declaration, not a build. **No status string changes, no worker rewrite, no Dexie bump.**
- [ ] **Consume the acknowledgement payload the server already sends.** `CreateAppliedResult` returns
      the canonical entity in `Data`; the client discards it. **Cheapest read-back in the system** — the
      server's own DTO at the moment of commit, without waiting for a pull. Makes scenario A provable
      per-record.
- [ ] **Per-mutation server logging.** The push handler is **1,921 lines with zero logging**; a batch
      where every mutation failed returns 200 and emits nothing. One structured line per result plus a
      batch summary, at the single choke point.
> **No new correlation id is needed.** `deviceId + clientRequestId` **is** the end-to-end key —
      durable on both sides, on the wire in both directions. The server simply never logged the key it
      already receives. Send the existing `syncCycleId` as `X-Request-Id` (**already in the CORS
      allow-list**) and prefer it over `TraceIdentifier`. Surface `deviceId` and queue counts in the
      existing status drawer, or "my entry vanished" still cannot be joined to a log line.
> **Explicitly NOT in F2:** a unified sync *function* · draining `db.outbox` (retire it instead —
      `DELETE_LOG` has **no server mutation type at all**, so a drainer would point at nothing) ·
      folding in analytics · storage-pressure policy · a `CONFLICT` status (zero producers until F3
      opts in an entity; it would ship as dead UI) · pruning `APPLIED` rows (**blocked** — the honesty
      chip and the crash reconciler both depend on them).

### F3 — Concurrency: **nothing in foundation**

- [ ] **Record the evidenced negative.** D1 needs no version token: `create_daily_log` is create-once
      with client-minted id and two dedupe layers; `add_log_task` is append, id-keyed; `verify_log` is an
      **append-only event stream with an FSM and role guard** — two devices produce two events, the
      illegal one is refused loudly, **both intents survive by construction**. That is already the C7
      requirement. There is no `update_daily_log` mutation at all.
- [ ] **First opt-in is a cost amount, in D2**, where a correction overwrites unconditionally and
      neither corrector is told. Second is labour corrections. **ADR required before F3 code.**

---

## 7. DOMAIN MIGRATION

Order: **D1 DailyLog → D2 Money → D3 Planned Tasks → D4 Harvest → D5 Procurement → D6 Geography.**

**D1 first** because the daily log already has a working contract and proven read-back — the labour
work walked this exact seam — so the first domain extends a pattern that works rather than inventing
one. **D2 second** because money is highest-harm but depends on F1's provenance envelope; building it
first means building that twice.

**Five commits per domain, cut by pipeline stage:**

| Stage | Commit | Reversible |
|---|---|---|
| 1 | contract: zod + regenerate C# + widen `PayloadHasOnly` + the parity test | yes, additive |
| 2 | server persistence + EF migration (**migration travels with the binary**) | yes, additive column |
| 3 | server read-back: DTO + query + client twin | yes |
| 4 | client reconstruction | yes |
| 5 | **remove the local-only path** | **NO — the only irreversible commit** |

- [ ] **D1** — machinery · activity expenses · observation detail · the fourteen fields · deletion as a
      real mutation (which then retires `db.outbox`)
- [ ] **D2** — money direction · the six dropped fields · stated vs derived · `financialSummary` ·
      **F3 opts in here**
- [ ] **D3** — planned tasks (founder-ruled durable truth, zero server presence today)
- [ ] **D4 / D5** — harvest and procurement: **new server domains.** First ask *is this product truth?*
- [ ] **D6** — plot geometry and farm configuration. **RLS must already be in place** (§P0.3), because
      this is what expires the exemption's justification.

---

## 8. MEDIA

**Device half is the urgent half** and is already in §P0.8. The rest:

- [ ] **Compression, three presets:** thumbnail 320 px q0.70 (~20 KB, deliberately under the 128 KB
      minimum-billable threshold) · field photo 1600 px q0.80 (~250 KB, ~12×) · receipt 2000 px q0.85
      (~510 KB, ~6×). `createImageBitmap` → `OffscreenCanvas` → `convertToBlob` **in a Worker**.
      **Add no imaging library.**
      **Honesty:** these are **derived from pixel budgets and standard rate curves, not measured.**
      Ship, then calibrate on ~20 real photos from the handsets farmers actually use, with an OCR
      accuracy delta against the golden set. Do not report them as measured until that runs.
- [ ] **EXIF trap — this is a provenance fix, not only a size fix.** Canvas re-encode **strips
      orientation and GPS**. A naive resize ships rotated photos and destroys capture location. Read
      orientation before encode and bake the rotation in; lift GPS and capture time into the
      **structured record**, where they are attributable.
- [ ] **Presigned upload** — after F2, because the `pending → committed` media state **is** a sync
      lifecycle state and must use F2's model or media becomes a sixth mechanism.
      Server mints the key (**client-chosen keys are a hard precondition to remove**); signed
      `Content-Type`, `Content-Length` and checksum; **300 s** expiry; **DB row committed `pending`
      before the object exists**; server-side finalisation via `HeadObject` verifying existence, size,
      type and checksum. **CORS does not exist on the bucket — a browser PUT fails preflight without it.**
- [ ] **Orphans: no reaper.** Production **has no `s3:DeleteObject`** on either media bucket, and that
      is a property worth keeping. The ordering inversion eliminates the class; the residual
      (presigned, uploaded, never finalised) is handled by a `state=pending` object tag plus a 7-day
      lifecycle rule. Requires only `s3:PutObjectTagging` — strictly smaller than a delete grant.
- [ ] **Presigned GET replaces `Results.File` proxying**, minted per request, **never persisted**. A
      stored URL is a bearer token with no revocation.
> **No CloudFront for media.** No multipart orchestration (8 MB cap ⇒ single PUT). No presigned
      DELETE. No wildcard CORS.
- [ ] **Voice sealing — three blocking defects before "just wire it up":**
      **(a)** the read path calls `resolveDek()` unconditionally, bypassing the cache — enabling sealing
      would make a farmer unable to replay their own clip **offline**;
      **(b)** the archive splits ciphertext and auth tag but the client rebuilds from ciphertext only,
      so **every cloud clip throws** — enabling the archive first ships one that can never play back;
      **(c)** the sealing writer awaits a network key fetch, which fails on the offline capture path
      (`P9`, C5).
      Also: **seal inside the existing writer** — the dead one does a bare `put(row)` and would silently
      drop status, job link and timestamps.
      🛑 **The "v18 re-seal cascade is NOT NEEDED" scope deletion is WITHDRAWN.** It rested on the
      30-day sweeper ageing plaintext rows out. **Ruling D9 keeps voice forever and disabled that
      sweeper**, so plaintext clips now persist indefinitely and grow. The D9 commit says it directly:
      encryption is the **next** item in this area, not a later one.
- [ ] **The device is the smaller half of the plaintext window.** Every voice parse uploads raw audio to
      the server, which writes it under SSE-only encryption with no lifecycle. **A plan that seals the
      device and stops has not implemented the ruling.**

---

## 9. LEGACY-DATA STRATEGY

Directive §14: **never silently rewrite history.**

| Class | Strategy |
|---|---|
| Flattened machinery already on the server | **Preserve as legacy.** Do not parse uncertain text into authoritative data. **Only one representation visible to the farmer**; preserve the underlying evidence; **never delete uncertain evidence to deduplicate** |
| Fabricated irrigation/input/observation values | **In scope.** Merge-preserve in P0.5 now; type-level neutralisation at F1. **Unknown must never render as known** |
| Local-only harvest, procurement, geometry, planned tasks | Migrate **only after** the founder confirms each is product truth. Then migrate with provenance marking it legacy-imported |
| Un-namespaced localStorage keys | **Move into the incumbent's namespace on activation.** Never clear |
| Pre-Dexie stale copies | Remove after the owning domain completes its pipeline |
| Six dead stores, zero writers | **Delete.** Two separate Dexie bumps — additive first, destructive second, **never one**. To delete a store you must set it to `null`; omission is a silent no-op |
| Raw voice audio | 🛑 **RULING D9: KEPT FOREVER.** The ~30-day deletion written here is **withdrawn** — it destroyed farmer truth. **Plaintext-during-retention is now unbounded, so encryption is urgent, not deferred** |
| The device-local audit table | **Debt, not a domain to reproduce.** Stop writing, then drop, after the server before-image exists |
| `aiCorrectionEvents` | **Split.** Migrate the structured learning signal; **do not** duplicate the transcript |

**Every Dexie upgrade runs once per farmer database, lazily** — a device with three farmer databases
runs it three times. No existing version file accounts for this. Upgrades must be idempotent
per-database. **Upgrade callbacks must not fabricate**; the v18 file is the model — it *marks* rows and
invents nothing, and wraps every row in try/catch because one bad row aborting an upgrade blocks the
database from opening at all.

**A Dexie bump is one-way for APK users** — an older build opening a newer database throws and the app
is unusable for that farmer. Ship bumps alone, never bundled with a risky behavioural change.

---

## 10. SECURITY AND PRIVACY

Beyond §P0.1–P0.4:

- [ ] **A worker-erasure door.** `AnonymizeFieldOperatorAsync` is correct, tested, P6-compliant — and has
      **zero production callers**. A worker's erasure request can today be satisfied only by an engineer
      running SQL by hand. `P6` requires the capability before real names ship. Blocked on policy, not
      engineering.
- [ ] **Erasure destroys its own evidence.** The worker deletes the table where the raw-object pointer
      lives, so the object survives, unreachable by anything, with no way to identify whose it was.
      **Complying with one erasure request makes future compliance impossible.** Preserve the linkage
      through erasure, or add a subject dimension.
- [ ] **Carry verbatim, do not resolve:** the third-party worker notice/consent note and the
      retention-policy sign-off note in `ErasureWorker.cs:141-142,177-182`.
- [ ] **For counsel, not for us:** whether raw audio under a content-addressed key with no
      controller-side subject linkage is retained personal data · what notice is owed when a recording
      captures workers who never interacted with the app · the audit retention period · whether the
      dead export link is a portability failure.

---

## 11. AWS AND STORAGE CORRECTIONS *(parallel from day one; shares no files)*

> 🛑🛑 **READ BEFORE TOUCHING ANY LIFECYCLE TASK IN THIS SECTION.**
>
> **This section contains THREE separate tasks that each rewrite the SAME single S3 lifecycle
> document, on a lane declared "parallel from day one", with no ordering between them.**
> `put-bucket-lifecycle-configuration` **replaces the whole document** — so the last writer silently
> reverts the other two. **Land them as ONE change, or sequence them explicitly.**
>
> **And "remove the Glacier transition" is not a separate edit.** The live configuration is a
> **single rule** carrying **both** the transition **and** the 7-year expiration at a bucket-wide
> prefix. Removing the transition therefore means rewriting the rule that carries the farmer-evidence
> retention. No task said so. Capture the existing document verbatim first; treat that capture as the
> rollback.
>
> **The 180-day deploy-prefix expiry is a second uncovered data-destroying path.** The 🛑🛑 further
> down covers only *noncurrent* versions; this is a **current-version** expiry, and it is unenumerated
> — the bucket has **four** deploy-ish prefixes, none of them named here. Manual RDS snapshots never
> expire, so a 180-day artifact expiry manufactures database rollback points **with no matching
> binary**, while §15 promises "redeploy the previous SHA" with no horizon. **Enumerate every prefix,
> and tie the horizon to the oldest retained manual RDS snapshot, not to a round number.**
>
> ### ▶ THE RULE: ONE DESIRED-STATE TRANSACTION PER BUCKET
> **Do not execute "remove Glacier", "scope by prefix" and "write it through the script" as separate
> tasks.** One specialist produces **one complete desired lifecycle document per bucket**, covering
> every prefix, then:
> 1. **Capture the live policy verbatim** — that capture is the rollback, recorded in the commit.
> 2. **Apply once.**
> 3. **Diff live against desired** and confirm they match.
>
> **Intent to preserve, so the transaction is unambiguous:** remove the 365-day Glacier transition,
> **keep the seven-year evidence expiry**, and leave the **raw bucket's noncurrent versions
> untouched** until the evidence-retention decision is settled — this plan established they may be
> the only surviving copies.

- [ ] **THE ONE LIFECYCLE TASK — this replaces the separate lifecycle bullets below.**
      Produce **one complete desired lifecycle document per bucket**, covering every prefix, then:
      **capture the live policy verbatim** (that capture is the rollback, recorded in the commit) →
      **apply once** → **diff live against desired**. The bullets that follow are **inputs to that one
      document, not separate executions.**

> The three bullets below are **INPUTS to the single task above.** Do not execute them independently —
> each `put-bucket-lifecycle-configuration` replaces the whole document, so the last writer silently
> reverts the others.

- **INPUT — remove the Glacier transition. No replacement.** The class is Flexible Retrieval: an object in
      it **cannot be read** without a restore step — 3–5 hours, or $0.012 per expedited request.
      **One "show me last season" tap costs 13× that photo's entire annual storage bill** (164× after
      compression); a 30-photo album is ~₹30 in retrieval fees. The rule saves **$0.53/month**.
      **Nothing has ever transitioned** (34/34 objects still standard; first transition fires
      **2027-05-03**), so this is a pure config replace — no restore, no copy, no cost. **That window
      closes.** Capture the current policy verbatim in the commit message as the rollback.
      **Do not substitute Standard-IA** — its 128 KB minimum billable size would make thumbnails *more*
      expensive. **Defer `GLACIER_IR`** (millisecond access, no restore, cheaper than IA) with a numeric
      trigger: `attachments/` exceeds 100 GB.
> 🛑🛑 **STOP. THE DRAFT OF THIS TASK WOULD HAVE DESTROYED 123 MB OF RAW FARMER VOICE EVIDENCE,
      IRRECOVERABLY. DO NOT APPLY A BUCKET-WIDE NONCURRENT RULE TO THE RAW BUCKET.**
      > The draft said "79 MB of noncurrent versions exist right now" and applied the rule to **both**
      > buckets. **That figure was measured on the uploads bucket and generalised without measuring the
      > raw one.** Measured: the raw bucket holds **41 current objects (943 KB)** and **129 MB
      > noncurrent across 178 objects**, and **all 178 delete markers are the latest version** — so
      > those bytes, raw farmer voice recordings and complete personal-data export ZIPs, **exist only as
      > noncurrent versions.** `NoncurrentVersionExpiration` + `ExpiredObjectDeleteMarker` destroys
      > **99.3% of that bucket**, and this same section establishes those objects are **in no backup at
      > all.**
      > **Two further casualties of the same rule:** on the uploads bucket it deletes the deploy
      > artifact for the exact SHA whose pre-deploy RDS snapshot is the newest one retained — removing
      > the binary half of the rollback pair. And §15's CMK rollback **is** those noncurrent versions,
      > so landing both makes that rollback impossible.
      **Correct approach:** measure each bucket separately. Apply noncurrent rules **only** to prefixes
      proven to hold nothing but reproducible artifacts. Treat the raw bucket's noncurrent versions as
      **farmer evidence requiring a retention decision**, not as garbage. `AbortIncompleteMultipartUpload`
      is safe on both and can proceed.
- **INPUT — scope rules by prefix.** 618 MB of deploy artifacts sit under a 7-year farmer-evidence policy.
      `attachments/` keeps retention; deploy prefixes expire at **the oldest retained manual RDS snapshot's age, not a round number** —
      a fixed horizon manufactures database rollback points with no matching binary; `apk/` gets **no expiry** — expiring it breaks live download
      links.
- [ ] **Infrastructure as code — do not introduce CDK or Terraform.** 🛑 **This is the SAME single
      transaction as the lifecycle task above, not a second write.** Author the script FIRST, then the
      one capture→apply→diff runs *through* it. Do not apply by CLI and then re-apply by script. The repo already has a
      production-proven pattern (`aws/voice-retained/`, `aws/snapshot/`), verified **live and
      drift-free**; two buckets were simply skipped. Create `aws/uploads/` and `aws/raw/` on the same
      shape, plus bucket policies (neither bucket has one) and CORS. **Write the corrected lifecycle
      *through* the new script**, so the first change to that bucket is already reproducible.
      *(This is the same single transaction, not a third execution.)*
- [ ] **Drift detection needs no new CI.** `prod-hygiene-audit.yml` already runs weekly via OIDC with
      SNS alerts and contains **zero S3 checks**. Add a config-diff block.
- [ ] **Raw bucket — and the order within this task is mandatory.**
      **1. Unswallow the failure first.** Log with the **configured** bucket, not the hardcoded constant
      that can lie; add a metric and alarm.
      **2. Then bind** an explicit `RawBlobStore` section in production config and change `.Bind()` to
      **`ValidateOnStart`**, so a missing section becomes a **boot failure** rather than a silent
      fallback.
      **3. Only then add the deny rail** requiring the dedicated CMK.
      > **Ordering trap, stated because getting it wrong is silent:** adding the encryption rail while
      > the key is still unbound makes every PUT fail — and the write path **swallows the exception**.
      > The symptom would be farmers receiving 200s while their evidence silently stops being retained:
      > the exact failure class this programme exists to end. **Unswallow → bind → rail.**
      Re-encrypt the 41 existing objects in place afterwards.
- [ ] **The DR snapshot inventories the wrong bucket.** A founder-locked value names the attachment
      bucket as the raw store. **41 objects of raw farmer evidence are in no backup at all.** Correct it,
      and tell the founder the lock was made against a mis-identified bucket.
- [ ] **The exports bucket does not exist (404).** Every data-rights export link ever issued is dead,
      and the sweeper meant to clean them **deletes the wrong key** — issuing deletes into the raw
      evidence namespace.
- [ ] **The retained-voice bucket is empty and unconfigured in production** — that path has never
      written. Bind it, then get the retention right **before** data exists.
- [ ] **Remove `@capacitor/camera`** — declared, zero imports.
> **CLOSED — no work. Do not tick.** Q23 backfill: Measured: `attachments/` holds 4 objects, 83 bytes.
      There is nothing to backfill.

---

## 12. OBSERVABILITY

- [ ] One structured log line per mutation result plus a batch summary (§F2).
- [ ] `X-Request-Id` from the existing cycle id; server prefers inbound over its own.
- [ ] `deviceId` and queue counts surfaced in the existing drawer.
- [ ] `raw_blob_write_failures` metric and alarm via the existing CloudWatch → SNS path.
- **`DO LATER`:** a diagnostics endpoint · a durable server-side failure table · client log shipping.
  All strictly more expensive and answer nothing extra for D1.

---

## 13. RUNTIME VERIFICATION GATES

| # | Gate | Blocks? |
|---|---|---|
**Gates key on NAMED TESTS, never on magic counts.** Earlier drafts locked "exact tallies" and "the
17 sanity anchors"; tallies are a random variable and the anchor count matched nothing real. Three
oracles only: **the named test** · **that the run collected the files it should** (a run that silently
collects a subset is how a green gate becomes meaningless) · **no unrelated regression**.
Note the REPRO file count **legitimately shrinks** as reproductions graduate into the main gate by
rename — treat a smaller count as progress and confirm it against the rename history, never as a
missing-file failure.

| # | Gate | Blocks? |
|---|---|---|
| G0 | Baseline — re-measure and record; gate on *named REPRO tests + files collected as expected + no unrelated regression*. **Never a fixed tally** | **BLOCKS** |
| G1 | Per-task red→green on the **named** assertion in the named REPRO file | **BLOCKS** that task |
| G2 | Named sanity anchors stay green — **listed by name in the task, not by count.** Anchors that deliberately assert the defect are named as expected-to-flip, so a correct fix is not misread as a regression | **BLOCKS** |
| G3 | Mutation proof — **hash the named file directly.** Not `git diff --stat` (empty by construction for untracked files) and not `git stash` (whole-tree; concurrent agents strand work in a conflict). *(The `it.fails` sequencing note is withdrawn — see §0.)* | **BLOCKS** |
| G4 | Contract-parity drift | **BLOCKS** |
| G5 | Backend `Category=Contract` | **reports only** — it locks *names*, not fields; it would pass identically before and after, and naming that honestly matters |
| G6 | Real-Postgres money and tenancy | **BLOCKS** |
| G7 | Full frontend + typecheck + lint + file sizes, **unpiped, file count asserted** | **BLOCKS** |
| G8 | `gate` on the PR | **BLOCKS** |
| G9 | Founder acceptance — the destructive-device suite, §16 | **BLOCKS** |
| G10 | Prod proof — `/version` SHA + status + tracker row | **BLOCKS** close-out |

**Lint has three different thresholds and the plan must name the right one.** `npm run lint` is
`--max-warnings 9999` (decoration). The pre-commit hook is `--max-warnings 0`, **but only on staged
files** — the clean tree currently has **358 warnings**, so a tree-wide run at `0` blocks everything.
**CI actually enforces `600`**, a number an earlier draft never mentioned. Verify against **600**;
the hook's `0` applies to your staged diff only.

**Flake discipline.** *"Flake" is a conclusion, never an assumption.* A failing test is a defect until
a **recorded** isolated re-run on the same commit proves otherwise, with command and exit code. Three
consecutive failures ends the discussion. **A test that cannot run must fail, never skip and never
pass** — this codebase already shipped a suite that reported "Passed" while asserting nothing, on
every CI run, for months.

---

## 14. DEPLOYMENT SEQUENCE

> **Steps 1-2 belong to GM (merge). Steps 3 onward belong to GR (release).** An earlier draft called
> step 1 "G0", which §13 defines as the baseline test gate — two different things under one name.

**GM — merge**

1. Founder decides **GM** and merges. **Merge to `main` is founder-gated, never autonomous.**
2. `REMOTE_GREEN` on the landed commit. Local green is not evidence.

**GR — release. Every item below is a GR precondition, not a merge concern.**

3. 🛑 **Prod is NOT hibernated — that framing is wrong and it hides a real hazard.** RDS and EC2 are
   **running right now**. What exists is a **daily nap cycle**: an enabled schedule stops production
   every day at **19:30 UTC (01:00 IST)** and wakes it at 00:00 UTC, **regardless of any manual wake**.
   A heavy-tier deploy plus the multi-hour manual acceptance suite in §16 — run by a founder who works
   late IST — **will straddle that boundary and lose the database and the host mid-flight.**
   **Disable both schedule rules for the window and re-enable after G10.**
4. 🛑 **This is a HEAVY-tier deploy: the branch carries EF migrations — **count them yourself**: `git diff main...HEAD --name-only -- '*/Migrations/*.cs'`.** **§15 now splits change-level from release-level rollback; read it before proceeding.** Required and missing
   from the draft: a **pre-deploy RDS snapshot** (the database is single-AZ with 7-day automated
   backups, so a manual snapshot is the only rollback floor) and the deploy plugin's migration
   dry-run stage. Also missing: **any mechanism to apply a ShramSafal migration at all** — startup
   migrations are disabled in production and no deployment step in the repo applies one.
5. 🛑 **CloudFront invalidation is mandatory and was missing.** `index.html` carries no cache header and
   inherits a 24-hour TTL. Without invalidation, **returning web users stay on the vulnerable shell for
   up to a day** after a cross-farmer exposure fix. Smoke checks must assert **`Content-Type`**, not
   status — that distribution serves `index.html` at HTTP 200 for paths that do not exist.
6. Deploy via the `/deploy` plugin. **Never hand-rolled.**
7. **Backend + web + a new APK build.** The APK bundles web assets at build time, so a web deploy does
   not reach APK users. **For a cross-farmer exposure fix the APK is a gate item, not a conditional.**
8. Prod proof: `/version` SHA and HTTP status. **Written ≠ live.**
9. `DEPLOYMENT_TRACKER.md` rows — one for the tower merge, one for containment.
10. Infra lane deploys independently — AWS config only, no code.

---

## 15. ROLLBACK STRATEGY

> 🛑 **Rollback is TWO things and the draft conflated them.**
> **Change-level rollback** = undo one commit's behaviour. **Release-level rollback** = undo what
> actually reached production. For the combined tower release those are completely different
> problems, and the draft's first row was only ever true of an isolated client-only release.

**Release-level rollback for the combined tower** requires, before it ships: a **pre-deploy RDS
snapshot** (single-AZ, 7-day automated backups — the snapshot is the only floor) · a **proven
migration-application procedure** · **schema compatibility analysis** (can the previous binary read
the new schema?) · **previous-binary compatibility confirmed**. **Absent these, there is no release
rollback — only forward fixes.** Say so plainly rather than implying a SHA revert suffices.

| Change | Change-level rollback |
|---|---|
| P0 client fixes **as an isolated client-only release** | Redeploy the previous SHA. No schema change. **This row does NOT apply to the combined tower release** — see above |
| `farm_boundaries` RLS | **Capture the exact pre-change RLS state first and restore that.** `DROP POLICY` + `NO FORCE` is **wrong if the table began with RLS disabled** — it would leave RLS enabled with no policy, making every boundary invisible and unwritable to the application role. If disabled was the original state, **disable it** |
| Glacier removal | Re-apply the captured prior policy. Instantaneous and lossless **before 2027-05-03** |
| Raw-bucket CMK | Re-encryption is copy-in-place; the prior objects are versioned |
| Domain stages 1–4 | Additive; old clients unaffected |
| **Domain stage 5** | **NONE. The only irreversible commit.** Lands at least one deploy after stage 3 is prod-proven |
| Dexie bump | **One-way for APK users.** Ship alone |

---

## 16. DESTRUCTIVE-DEVICE ACCEPTANCE SUITE

Executable by one person with one phone. **Write everything on paper — the paper is the oracle. Do not
screenshot the app; that compares the app to itself.**

**1 · Capture.** Log in. Record one log containing **all of**: machinery (tractor, 3 h, ₹2400 rental,
₹600 fuel) · an activity expense with vendor and line item · a "Total Paid" figure · a spoken note ·
confirm it. Then one **income** event and one **expense** event of the same amount. Then a harvest
entry and a procurement receipt. Attach one photo.

**2 · Acknowledge.** Wait for server acknowledgement. **If it never acknowledges, stop — that is the
finding.**

**3 · Same-device check (before any wipe).** Force a pull. Re-read the log against the paper. **On
today's build the failure appears here, before the wipe.** This is the highest-value fifteen minutes
available.

**4 · Destroy.** Android: Settings → Apps → Storage → **Clear storage** (not cache). Reopen — you must
land on login. If not, the wipe did not happen.

**5 · Reconstruct.** Log in. Compare field by field against the paper: machinery hours/rental/fuel ·
expense vendor, qty, unit, unit price · **Total Paid (stated) vs summary total (derived)** · transcript
· phase and day number · verification status · **is the income still income, or is it now spend?** ·
harvest · procurement · photo.
**"Same meaning?" is the only column that counts.** A wrong value is worse than a missing one —
missing is honest, wrong is fabrication.

**6 · Shared handset.** Log out. Log in as a **second** farmer. Check harvest, procurement, finance
settings, vocabulary, and which farm you land in. **Any of farmer A's data visible outranks everything
else in this document.** Then log back in as A — **A's data must still be there.**

**7 · Rural.** Aeroplane mode. Record a log. **Force-kill** the app. Reopen — the intent must exist and
be visibly pending. Restore network, wait for acknowledgement, then confirm the server has **exactly
one**, not two.

**Pass condition — re-keyed to match §5's split.**

- **P0 exit (gate G9 at P0):** phases **3, 6 and 7** clean. That is containment: no same-device
  destruction, no cross-farmer exposure, offline intent survives a kill.
- **Phase 5 (full wipe-and-reconstruct) is NOT a P0 gate.** It asks harvest, procurement and
  machinery to return after a wipe, and those have no server domain until D1, D4 and D5. **Run it
  per-domain as each lands, scoped to that domain's fields, and in full at X2.**
  An earlier draft made it a P0 pass condition, which P0 could never have satisfied.

**Scenarios A–J** map to: A per-domain at each completion · B F2 · C F1 completeness + media · D F3 in
D2 · E F1 + D1 reconstruction · F P0.1 · G bounded hydration (**not testable until the capability
exists — pull is currently unbounded**) · H D2 · I P0.6 + P0.7 · J the infra lane.

---

## 17. EXPLICIT DEFERRALS

Each named, with the trigger that un-defers it. **Nothing is a "future consideration".**

| Deferred | Trigger |
|---|---|
| **Real-browser proof of the per-farmer ATTACHMENT-BYTE boundary** | **§8 media work.** P0.1's browser run captured no photo, so no per-farmer Cache Storage bucket was created and `localFileCache.ts`'s bucketing was never exercised outside jsdom. Code and tests cover it; **the manual proof does not exist and must not be described as if it does** |
| Local `/user/auth/register` failing `42501` on memberships RLS | **Separate pre-existing local-environment debt** (`RegisterUserHandler.cs:71`). Surfaced during P0.1 acceptance; the OTP path made it moot. **Not in this programme's scope** |
| **The D1 transitional local-preservation rule (§P0.5)** | **D1 stage 3 prod-proven. Then server authority wins and the protection is DELETED** — it must not harden into the permanent model |
| F3 concurrency primitive | D2 creates a second write path onto cost entries |
| Type-level neutralisation of the fabricated constants | F1 makes the fields optional |
| `db.outbox` removal | D1 gives deletion a real mutation type |
| Six dead stores | X1, as a destructive bump separate from any additive one |
| Live updates / real-time | A second device becomes a shipped workflow (ruling Q33) |
| `GLACIER_IR` | `attachments/` exceeds 100 GB |
| WebP/AVIF | After preset calibration measures the real gain |
| Server-side derivative pipeline | A screen needs a size neither artefact covers |
| `deleteDatabase` on a shared handset | Founder retention ruling **and** `P10` being true |
| Storage-pressure eviction policy | Quota pressure becomes measurable after §P0.8 |
| Server queue pruning | Ruling Q34. **`sync_mutations` is load-bearing for dedupe** and cannot be truncated like `outbox_messages` |
| Weather reader | A screen consumes it (ruling Q4). Documented as intentional |
| Audit before-image | After P0; scoped to a closed list of state *changes*, never creates |
| Audit retention period | Founder + counsel |
| Raw-audio retention and erasure design | Counsel |
| Worker-erasure surface | Policy sign-off, not engineering |
| The other RLS gaps (10 unclassified tables) | Fix the **regex** now; schedule policies separately — do not bundle them into the boundary change |
| Harvest/procurement/vocabulary migration | Founder ruling on product truth |
| sessionStorage route params surviving logout in-tab | X1 |
| Bounded hydration mechanism | F1/F2 design picks the simplest option; **not doctrine** |

---

## 18. DEFINITION OF DONE

**Not** done because: localStorage shrank · more endpoints exist · more columns reach PostgreSQL ·
tests are green.

**Every scenario carries an evidence owner and an ACTIVATION POINT.** Before its activation point a
scenario is **expected red** and must not be read as programme failure; from that point it **blocks**.
Without this an executor cannot tell an expected red from a real one.

| # | Scenario | Evidence | Activates (blocks from) |
|---|---|---|---|
| **A** | Online → acknowledge → wipe → login → **same semantic record** | §16 phases 4-5, manual, per domain | **Per domain as each lands**, for that domain's fields only. Global at X2 |
| **B** | Offline → kill → reopen → intent survives → **exactly-once** commit | §16 phase 7 + automated queue tests | **P0 exit** |
| **C** | Work commits while the image fails → work valid, image **honestly pending** | Automated, fault-injected | **F1 completeness + media finalisation** |
| **D** | Two devices change a protected fact → neither silently destroys the other | Real-Postgres test | **D2 / F3.** Cannot block before then — no entity is versioned |
| **E** | Partial history returns **partial, never fabricated** | The named REPRO fabrication assertions | **F1 + D1 reconstruction** |
| **F** | A logs out, B logs in → **no A data exposed**, and **A's data still there** | §16 phase 6, both directions | **P0 exit** — this is §P0.1 |
| **G** | Years of history → useful quickly without downloading the archive | **No oracle exists yet** — pull is unbounded | **Bounded hydration.** Explicitly **not blocking** before it |
| **H** | Stated money, derived money, income and expense **stay distinct** | §16 phase 5 money rows + contract tests | **D2** |
| **I** | Server rejects → content survives, rejection **resolvable** | Automated rejection tests | **P0 exit** |
| **J** | Storage, encryption, lifecycle in **version-controlled config** | The weekly config-diff audit | **Infra lane completion** |

**Blocking at P0 exit: A-CONTAINMENT, B, F, I.**

| **A-CONTAINMENT** | Same-device check: a farmer's own sync does not reduce his own record | **§16 phase 3** | **P0 exit** |

> Scenario **A** (full wipe-and-reconstruct) activates **per domain**, not at P0 — it needs server
> homes that do not exist yet. **A-CONTAINMENT is its P0-scoped half** and owns §16 phase 3, which
> §5's first exit criterion requires. Without this row the P0 exit set and §5/§16 disagreed.

Everything else activates later and is **expected red** until it does.

Plus, per the cofounder Definition of Done: spec referenced · tests added · architecture tests pass ·
**Founder Acceptance Gate cleared before any deployment step** · **deployed and prod-proven** with a
`/version` SHA and a `DEPLOYMENT_TRACKER.md` row.

> **The one-line test:** if an acknowledged farmer record can disappear, change meaning, leak to
> another farmer, or require the originating phone to reconstruct it — **the migration is not
> finished.**
