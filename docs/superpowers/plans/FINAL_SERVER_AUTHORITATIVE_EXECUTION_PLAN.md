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

## 1. EXECUTIVE CONCLUSION

**The defect class.** Client capture, server persistence, read-back and reconstruction were built as
partially independent paths. That single cause produced ~50 verified defects: data disappearing, data
changing meaning, fabricated defaults, offline work vanishing, deletions resurrecting, money
corrections silently rejected, duplicate money events, business truth living only on one handset,
media queues wedging, and one farmer's data reachable by the next farmer on the same phone.

**Four were reproduced at runtime**, not merely read: 48 failing assertions across four test files,
each with a passing sanity anchor proving the harness sound.

**What changed once specialists looked.** Five things the audit got wrong, all in the direction of
*less* to build:

| Belief | Reality |
|---|---|
| The sync lifecycle must be designed | It **exists and works** — six statuses, retry cap, crash recovery, durable rejection, conflict screen. F2 shrinks from a design to an adoption plus four gaps. |
| Concurrency must be built for D1 | Verification is **already** append-only events + FSM + role guard — exactly the C7 requirement, implemented. First real need is a cost amount, in D2. |
| The money-correction bug needs a string added to a list | The server **already classifies** every error and **drops the classification on the way out**. Carrying it removes the whole class. |
| The audit trail barely exists | It carries **8 of 9** required attributes as first-class columns, is append-only by privilege, and has ~60 write sites. Only the before-image is missing. |
| Old photos need measuring before backfill | Measured: `attachments/` holds **4 objects, 83 bytes**. There is nothing to backfill. Deferral closed. |

**The gating fact.** This branch is the labour branch plus one docs commit — **145 commits ahead of
`main`, none merged**. Every fix below becomes commit 146 on a tower that has never reached
production. The P0 security fix has nowhere to land until that merge happens, and because the tower
carries backend Labour Phase 2 persistence, the merge is a backend + web + APK deploy on hibernated
prod, not a static push.

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
tenancy and RLS on farms/plots/crop cycles · the voice 30-day sweeper · crash recovery on
`mutationQueue` · the structured labour round trip · verification's event-sourced FSM ·
`UploadQueueRetry`'s deliberately narrow scope · the field-operator erasure semantics.

---

## 3. FINAL DEPENDENCY GRAPH

```
G0  FOUNDER GATE — merge the 145-commit tower to main            ← blocks all delivery
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

## 4. GATE G0 — THE FOUNDER DECISION THAT BLOCKS DELIVERY

```
main...HEAD  =  0 behind, 147 ahead        ← re-measure before presenting; it moves
feat/labour-management-ui..HEAD  =  EMPTY  ← this branch is IDENTICAL to the labour branch
```

> **Corrected.** An earlier draft said "145 ahead" and "the labour branch plus one docs commit". The
> count is 147 and the branches are **identical** — every planning document written in this session is
> still untracked. **Re-measure both figures immediately before putting this decision to the founder.**
> Asking someone to approve a merge sized by a stale number is the same error this plan exists to end.

Nothing below reaches a farmer until this merges. Three options:

- **(a) Merge the tower to `main` now**, then land containment on top. **Recommended.** It is green
  (997 tests), and holding a security containment behind an unrelated review is the worse risk.
- **(b) Cherry-pick containment onto a branch cut from `main`**, ship the security fix alone, merge the
  tower later. Costs a rebase and splits history; buys a smaller review.
- **(c) Hold both** until the labour work is founder-accepted. Leaves the shared-handset leak live.

**Deploy shape either way:** backend (`agrisync-deploy`) + web + **a new APK build**, on hibernated
prod (`bash aws/hibernate/wake.sh`). Wake once for the tower and containment together. `DEPLOYMENT_TRACKER.md`
gets one row for the merge and one for containment on the same wake.

- [ ] **Founder decision recorded: (a) / (b) / (c)**

---

## 5. PHASE P0 — CONTAINMENT

**Entry:** G0 decided. **Exit:** all P0 acceptance items green, destructive-device suite Phases 5–7 clean.

Ordered by farmer harm (direction §9). Every task is client-side or a single migration; **none creates
a temporary architecture Lane B must undo.**

### P0.0 — Gate hygiene (must precede every other task)

**Why now:** the four reproduction files sit inside `ci-gate.yml`'s `npm test`, which is the single
required check. 48 red assertions currently **block merge to `main`**. And the plan's own verification
command cannot fail.

- [ ] 🛑 **COMMIT THE FOUR REPRODUCTION FILES FIRST. They are untracked.**
      An earlier draft asserted that 48 red assertions "currently block merge to `main`". **False** —
      the files are on no branch, so CI has never seen them, and no task committed them. Everything
      else in this section depends on them existing in the repo.
- [ ] **The baseline is a RANGE plus a re-measurement, not a fixed tally.** A draft asserted
      `6 failed | 145 passed (151)` / `50 failed | 1449 passed (1499)`. A later unpiped run measured
      `4 failed | 147 passed (151)` / `48 failed | 1453 passed (1501)`: the two timeout files passed and
      the total moved. **An "exact tally" gate is a random variable and would have fired on task one.**
      Re-measure at the start, record the actual numbers, and gate on *"the four REPRO tallies match
      and no other file regresses"*.
- [ ] **Own the two timeout tests — do not merely record them.** They pass in isolation and fail under
      load. Left unowned, the required check fails on any loaded run and the merge is blocked by nobody's
      task. Either raise the timeout or remove the real timer. **The draft asserted both that they are
      flaky and that the baseline is exact; those cannot both hold.**
- [ ] **Convert every §17-deferred assertion to `it.fails(...)`** with a `// DEFERRED → §17 row N` tag,
      **and understand exactly what it does and does not buy.**
      > `it.fails` flips *any* non-pass into a pass — including a timeout, a fixture `TypeError`, or an
      > import error. So it **violates this plan's own flake rule** ("a test that cannot run must fail")
      > across the whole deferred set, and on a multi-assertion test a fix that repairs six of seven
      > assertions still reads green.
      > **Two consequences that must be written into the tasks:** convert only *single-assertion* tests;
      > and **run the mutation proof BEFORE converting**, because after conversion reverting the fix
      > makes the test *green* — G3 would silently pass for every converted test.
- [ ] **Identify by name the sanity anchors that ASSERT THE DEFECT, and convert them too.** Several
      currently-*passing* tests encode the broken behaviour — that a wedged row stays wedged, that the
      delete erases the freshness marker. **The correct fixes turn them red**, and a gate that reads
      "an anchor turning red means the fix is wrong" would misdiagnose four correct fixes as
      regressions, on a blocking gate. List them explicitly; do not refer to "the 17 anchors" — the
      real count is 18 passing, 11 labelled, and 17 matches neither.
- [ ] **Every verification command runs unpiped** (or `set -o pipefail`) and asserts `$?`.
      **Also assert the file count** — a vitest run that silently collects a subset is how a green gate
      becomes meaningless.
- [ ] **Promote `check:storage-discipline` into `ci-gate.yml`** — but **not** as a proof of anything.
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
      **(b)** Activation is **conditional** (`if (!isDemoMode && session?.userId)`) while
      `dataSource.initialize()` on the next line is **unconditional**. Demo mode, and any render where
      the session id is not yet hydrated, still open the **incumbent's** database. The draft never
      mentioned demo mode at all.
      **(c)** The blast radius is ~3× the draft's figure: **299 `getDatabase()` calls across 84 files**,
      not the ~104 quoted from a stale in-file comment. Produce an inventory of which sites swallow a
      throw (a worker stops silently) versus which crash boot, **before** making it throw.
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
- [ ] **Verify:** `REPRO-A2` — all seven A2.2 assertions and the namespace assertion flip green; four
      sanity anchors stay green. **Assert the orphaning is non-destructive:** old keys remain present and
      readable after the change.

### P0.2 — Audit read-endpoint authorization bypass (new, security-found)

`AuditEndpoints.cs:33-37` filters `.Where(x => x.HasValue)` **before** the membership check, so
`farm_id IS NULL` rows return to any authenticated caller — and the RLS policy admits NULL-farm rows
for every tenant *by design*. **Both defences share the hole.** NULL-farm rows are exactly the
cross-farm ones: invites, joins, membership exits, admin elevations, DEK issue/resolve,
erasure/export/breach. `payload` is returned verbatim.

**The hole has three mouths, not one. An earlier draft patched one and would have left the widest open.**

- [ ] **The sync pull applies the identical whitelist** (`PullSyncChangesHandler.cs:130`), so **every
      device pulls every NULL-farm audit row, payload verbatim, on every sync** — invites, joins,
      membership exits, admin elevations, DEK issue and resolve, erasure, export, breach. This is far
      wider than the `/audit` endpoint and must be fixed in the same task.
- [ ] **The repository port has a fail-open default body** (`IShramSafalRepository.cs:135-136`) that
      **discards `farmIds` and calls the unscoped overload.** Any implementor that does not override it
      returns every farm's audit events. Doctrine `F7` warns that default interface bodies let a test
      double answer the default and pass for the wrong reason — this is that hazard, live.
- [ ] **Fix the RLS policy too.** The draft said "both defences share the hole" and then filed a task
      against one. `p_tenant_audit_events` still admits NULL-farm rows to every tenant, so patching only
      the application layer turns two broken defences into one working one with **zero depth**.
- [ ] Endpoint rule: NULL-farm rows visible only to their own `actor_user_id`, or to a platform-admin
      claim.
- [ ] Tests proving a non-admin caller cannot read another actor's NULL-farm rows **through either the
      endpoint or a sync pull**.

### P0.3 — `ssf.farm_boundaries` RLS

**Corrected:** this is **not** an oversight. It is a documented allowlist exemption
(`RlsExemptionAllowlistTests.cs:176-184`) whose justification is conditional and **expires the moment
geometry read-back ships** (D6). Closing it means deliberately editing the allowlist — the control
working as designed.

- [ ] 🛑 **ORDER CORRECTED — reproduce the scope wiring FIRST, migrate second.** `PUT /farms/{id}/boundary`
      never establishes tenant scope; it takes the farm from the route and authorizes in the handler.
      **Landing the policy before the scope is wired means the setting is unset, the read filters to
      nothing (so the version silently resets to 1 and the prior boundary is never archived), and the
      write throws `42501`** — an availability *and* integrity break. The draft had these tasks in the
      wrong order.
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
- [ ] **Do not add a permissive user-scoped SELECT policy** until read-back exists — permissive policies
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
- [ ] 🛑 **DO NOT merge by `task.id`. An earlier draft specified this and it duplicates money.**
      > The client **mints a fresh UUID per payload build** for any non-UUID local id, and the
      > manual-entry surface produces exactly those (`act_global_daily`, `irr_{timestamp}`). So
      > merge-by-id finds no match and keeps **both** rows. Machinery compounds it: it is sent as a task
      > and rebuilt as a *crop activity*, so the merge adds a phantom "Machinery Tractor" beside the
      > preserved local machinery entry — the exact "two representations visible to the farmer" §9
      > forbids. Inputs carry `cost` and machinery carries rental and fuel: **this is duplicated rupees,
      > not duplicated rows.**
      **Instead: preserve the local collection wholesale when the device has one**, and take the
      rebuilt collection only when the device has nothing. Same predicate as the rest of the task —
      "did the response state this", never a per-item identity join.
- [ ] 🛑 **Fixing the blob is not enough — the INDEX columns are computed outside the guard.**
      `reconcileLogs` derives `verificationStatus` and `isDeleted` from the **incoming rebuilt log**,
      outside `preserveLocalOnlyFields`. `toDailyLog` never sets `deletion`, so `isDeleted` is written
      `0` regardless of what the guard preserves — **and every reader queries the index, not the blob.**
      Without this, after the full fourteen-field extension: the deletion **still resurrects**, and the
      farmer's `CONFIRMED` **still reads as `DRAFT`** in status queries. The task as drafted could not
      have passed its own acceptance column.
- [ ] Ruling Q9's immediate neutralisation of fabricated values is satisfied by the wholesale
      preservation above; the type-level fix waits for F1 (§17).
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
      byte-identically, verify by `git diff --stat` empty and hash equality. "23 failed" is not evidence;
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
      `voiceClips`, which has the working 30-day sweeper. Dropping the job copy is safe today and halves
      offline-voice storage.
- [ ] **Receipt and patti jobs get a written `expiresAtUtc`**, swept on the existing purge call — not
      "delete on complete", because the result is not yet delivered to the farmer.
- [ ] 🛑 **DO NOT delete attachment bytes in P0. This task moves to §8, after server-side finalisation
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
      demonstrably exist in a second store that has a working sweeper. State that reason in the code.
- [ ] **Protected, never auto-evicted:** unsent mutations · unfinished uploads and their bytes ·
      unfinished AI jobs · `aiCorrectionEvents` · `appMeta` (holds GPS consent) · every localStorage
      business key · **and `logs`, until F1 lands** — 14 fields have no wire representation, so a log row
      is still the only copy.

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
- [ ] **Explicitly NOT in F1:** version tokens · `capturedAt`/`actor` on every field · a provenance
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
- [ ] **No new correlation id is needed.** `deviceId + clientRequestId` **is** the end-to-end key —
      durable on both sides, on the wire in both directions. The server simply never logged the key it
      already receives. Send the existing `syncCycleId` as `X-Request-Id` (**already in the CORS
      allow-list**) and prefer it over `TraceIdentifier`. Surface `deviceId` and queue counts in the
      existing status drawer, or "my entry vanished" still cannot be joined to a log line.
- [ ] **Explicitly NOT in F2:** a unified sync *function* · draining `db.outbox` (retire it instead —
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
- [ ] **No CloudFront for media.** No multipart orchestration (8 MB cap ⇒ single PUT). No presigned
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
      **The v18 re-seal cascade is NOT NEEDED** — the working 30-day sweeper ages every plaintext row
      out within one retention period. Genuine scope deletion.
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
| Raw voice audio | ~30 days after confirmed transcription, **and not plaintext during the window** |
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

- [ ] **Remove the Glacier transition. No replacement.** The class is Flexible Retrieval: an object in
      it **cannot be read** without a restore step — 3–5 hours, or $0.012 per expedited request.
      **One "show me last season" tap costs 13× that photo's entire annual storage bill** (164× after
      compression); a 30-photo album is ~₹30 in retrieval fees. The rule saves **$0.53/month**.
      **Nothing has ever transitioned** (34/34 objects still standard; first transition fires
      **2027-05-03**), so this is a pure config replace — no restore, no copy, no cost. **That window
      closes.** Capture the current policy verbatim in the commit message as the rollback.
      **Do not substitute Standard-IA** — its 128 KB minimum billable size would make thumbnails *more*
      expensive. **Defer `GLACIER_IR`** (millisecond access, no restore, cheaper than IA) with a numeric
      trigger: `attachments/` exceeds 100 GB.
- [ ] 🛑🛑 **STOP. THE DRAFT OF THIS TASK WOULD HAVE DESTROYED 123 MB OF RAW FARMER VOICE EVIDENCE,
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
- [ ] **Scope rules by prefix.** 618 MB of deploy artifacts sit under a 7-year farmer-evidence policy.
      `attachments/` keeps retention; deploy prefixes expire at **180 days** (confirm the rollback
      horizon with the deploy owner first); `apk/` gets **no expiry** — expiring it breaks live download
      links.
- [ ] **Infrastructure as code — do not introduce CDK or Terraform.** The repo already has a
      production-proven pattern (`aws/voice-retained/`, `aws/snapshot/`), verified **live and
      drift-free**; two buckets were simply skipped. Create `aws/uploads/` and `aws/raw/` on the same
      shape, plus bucket policies (neither bucket has one) and CORS. **Write the corrected lifecycle
      *through* the new script**, so the first change to that bucket is already reproducible.
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
- [ ] **Q23 backfill: closed, not deferred.** Measured: `attachments/` holds 4 objects, 83 bytes.
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
| G0 | Baseline lock — exact tallies, unpiped, exit code recorded | **BLOCKS** |
| G1 | Per-task red→green on the named REPRO file | **BLOCKS** that task |
| G2 | The 17 sanity anchors stay green | **BLOCKS** — an anchor turning red means the fix is wrong |
| G3 | Mutation proof — **hash the named file directly.** Do **not** use `git diff --stat` as the oracle (it is empty by construction for untracked files, and the tree already has unrelated modifications) and do **not** use `git stash` (it takes the whole tree; with parallel agents a concurrent write turns `stash pop` into a conflict with work stranded). **Run before any `it.fails` conversion** | **BLOCKS** |
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

1. Founder decides G0 and merges. **Merge to `main` is founder-gated, never autonomous.**
2. `REMOTE_GREEN` on the landed commit. Local green is not evidence.
3. 🛑 **Prod is NOT hibernated — that framing is wrong and it hides a real hazard.** RDS and EC2 are
   **running right now**. What exists is a **daily nap cycle**: an enabled schedule stops production
   every day at **19:30 UTC (01:00 IST)** and wakes it at 00:00 UTC, **regardless of any manual wake**.
   A heavy-tier deploy plus the multi-hour manual acceptance suite in §16 — run by a founder who works
   late IST — **will straddle that boundary and lose the database and the host mid-flight.**
   **Disable both schedule rules for the window and re-enable after G10.**
4. 🛑 **This is a HEAVY-tier deploy: the branch carries 10 EF migrations.** §15's first row claiming
   "no schema change, nothing to reverse" is **false** for the combined merge. Required and missing
   from the draft: a **pre-deploy RDS snapshot** (the database is single-AZ with 7-day automated
   backups, so a manual snapshot is the only rollback floor) and the deploy plugin's migration
   dry-run stage. Also missing: **any mechanism to apply a ShramSafal migration at all** — startup
   migrations are disabled in production and no deployment step in the repo applies one.
5. 🛑 **CloudFront invalidation is mandatory and was missing.** `index.html` carries no cache header and
   inherits a 24-hour TTL. Without invalidation, **returning web users stay on the vulnerable shell for
   up to a day** after a cross-farmer exposure fix. Smoke checks must assert **`Content-Type`**, not
   status — that distribution serves `index.html` at HTTP 200 for paths that do not exist.
4. Deploy via the `/deploy` plugin. **Never hand-rolled.**
5. **Backend + web + a new APK build.** The APK bundles web assets at build time, so a web deploy does
   not reach APK users. **For a cross-farmer exposure fix the APK is a gate item, not a conditional.**
6. Prod proof: `/version` SHA and HTTP status. **Written ≠ live.**
7. `DEPLOYMENT_TRACKER.md` rows — one for the tower merge, one for containment.
8. Infra lane deploys independently — AWS config only, no code.

---

## 15. ROLLBACK STRATEGY

| Change | Rollback |
|---|---|
| P0 client fixes | Redeploy the previous SHA. No schema change, nothing to reverse |
| `farm_boundaries` RLS | `DROP POLICY` + `NO FORCE`. Additive, reversible |
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

**Pass condition:** phases 5, 6 and 7 clean. Phase 3 is diagnostic and must be clean after P0.

**Scenarios A–J** map to: A per-domain at each completion · B F2 · C F1 completeness + media · D F3 in
D2 · E F1 + D1 reconstruction · F P0.1 · G bounded hydration (**not testable until the capability
exists — pull is currently unbounded**) · H D2 · I P0.6 + P0.7 · J the infra lane.

---

## 17. EXPLICIT DEFERRALS

Each named, with the trigger that un-defers it. **Nothing is a "future consideration".**

| Deferred | Trigger |
|---|---|
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

**Done when all ten hold:**

- [ ] **A** — record online → acknowledge → wipe client storage → login → **the same semantic record**
- [ ] **B** — record offline → kill app → reopen → intent survives → reconnect → **exactly-once** commit
- [ ] **C** — work committed while the image fails → **work valid, image honestly pending**
- [ ] **D** — two devices change a protected fact → **neither silently destroys the other**
- [ ] **E** — partial history returns **partial, never fabricated**
- [ ] **F** — farmer A logs out, B logs in → **no A information exposed**, and **A's data is still there**
- [ ] **G** — years of history → **useful quickly** without downloading the archive
- [ ] **H** — stated money, derived money, income and expense **remain distinct** after the round trip
- [ ] **I** — server rejects an offline mutation → **content survives, rejection is resolvable**
- [ ] **J** — storage, encryption and lifecycle live in **version-controlled config**, not console state

Plus, per the cofounder Definition of Done: spec referenced · tests added · architecture tests pass ·
**Founder Acceptance Gate cleared before any deployment step** · **deployed and prod-proven** with a
`/version` SHA and a `DEPLOYMENT_TRACKER.md` row.

> **The one-line test:** if an acknowledged farmer record can disappear, change meaning, leak to
> another farmer, or require the originating phone to reconstruct it — **the migration is not
> finished.**
