# AgriSync Engineering Doctrine

**Durable directives extracted from founder decisions. These outlive any single plan or feature.**

Every rule below has a **Born from** line naming the real incident that produced it — because a principle without its scar tissue gets argued away by the next clever idea. Rules marked **[LOCKED]** were frozen by explicit founder decision and may not be reopened by an agent; they change only when the founder changes them.

Last updated 2026-08-11 (Labour V1 architecture session).

---

## A. Data truth — what the product is allowed to claim

### A1. THE PHASE RULE  **[LOCKED — founder, 2026-08-11]**

> **Phase 1 stores what the farmer confirmed. Phase 2 derives what the system inferred. Neither may impersonate the other.**

A voice-originated record is **not** automatically "AI data." Once the farmer confirms it, it is farmer-asserted truth and belongs in the durable write path beside its parent. Inferred and enriched data may be best-effort.

**Operational corollary — canonical data must never live in a best-effort side-car.** Ask of every new child record: *is this the farmer's own assertion, or something we inferred?* That answer picks the phase.

**Born from:** `CreateDailyLogHandler`'s two-phase design. Phase 2 catches every exception, logs a warning, and returns success — correct for weather and AI derivation. Putting canonical labour there would have made the failure **silent and unrecoverable**: the log commits, the child rows vanish, and the duplicate-key early return then hands back the existing log on every retry, so the side-car is never reached again. There is no backfill job anywhere in the system.

### A2. Fast entry, forgiving correction, trustworthy history  **[LOCKED — founder, 2026-08-11]**

> **Record now → inspect later → correct → trust the final record.**

The first record creates habit. The correction flow creates confidence. The audit trail creates trust. **All three are required.**

A farmer learning the app will record 8 when it was 6, forget someone, or pick the wrong worker. A system that says *"once saved you cannot correct it"* makes people afraid to log at all — fatal for a habit-forming product. **Correction is an adoption safety net, not an advanced feature.**

Target mental state: *"पहिले नोंद करतो. चूक झाली तर तपासून दुरुस्त करता येईल."*

### A3. Correction is never silent mutation

> **Easy to correct. Hard to falsify history.**

A correction states that this **was** X and, after verification, **is now** Y. Always name which entity holds *current truth* and which holds *history* — never leave that for an implementer to invent.

Do not overwrite a recorded value with no trace. Do not hard-delete an attribution that history should still be able to explain.

### A4. No fabricated numbers reach a farmer  **[LOCKED — founder frozen invariant, 2026-08-10]**

> **No score, metric, or derived figure may exist unless its underlying evidence exists and is explainable.**

**Born from two live examples, both shipped and both hidden this session:**
- A reliability score rendered beside a **named real person** that returned **100 for every worker, always** — its metrics source returned zeros and the scorer treated zero logs as a perfect ratio. A constant wearing the costume of a measurement.
- "तास: ८ तास" on the labour screen, computed as `settings.labour.defaultHours || 8` inside a loop that ignored every event — the maximum of a constant, with no settings UI and no persistence behind it.

### A5. A truthful missing feature beats a fake working one

If a control cannot yet do what it appears to do, **disable it or make it real** — never leave it looking functional. Applies equally to a button that doesn't persist and a number that isn't measured.

### A6. Creator ≠ data subject  **[LOCKED — founder]**

The person who *typed* a third party's name is not that third party's data subject. Account erasure by the creator must not automatically erase the named worker.

**But the capability to erase the worker must exist** before real names ship. Anonymize the person; **never** the work — preserve the identity's id, its relationships, dates, and all non-identifying execution history.

### A7. Attribution never changes reported quantity  **[LOCKED — founder]**

`WorkerCount = 8` with 3 people named is still **8**. Identifying people is an *overlay* on a reported quantity, never a replacement for it. Naming people must never shrink the number — that would punish the farmer for being helpful.

### A8. Provenance over precision

When a value may be either stated or assumed, **record which** — as one atomic fact with the value itself. `DurationHours` alone is a lie; `DurationHours + TimeBasis` is a record.

**Five years from now the system must be able to answer: what did the farmer actually tell us, without pretending inferred information was observed information.**

### A9. Low-friction capture is sacred  **[LOCKED — founder]**

The simplest real utterance — *"आज ८ मजूर होते"* — must complete its record with **zero** names, warnings, wizards, completion percentages, or nags. No optional field may ever reject a record. Enrichment is always optional; the closure loop is never subordinate to it.

---

## B. Engineering — how we build it

### B1. Repo is truth. Verify before asserting.

Never state a file path, line number, behaviour, or past decision without opening it. A plan built on unverified claims fails review no matter how good its architecture.

**Born from:** three separate revisions of one plan were blocked, overwhelmingly for asserting untrue things about the codebase — invented test helpers, a contract field that didn't exist, an un-run baseline, an RLS proof that ran as superuser. In the same session a *founder decision document was cited as ruling the opposite of what it says*, twice, in opposite directions. **Reading the source is cheaper than one review cycle.**

### B2. Layer boundaries are enforced by the build, not by good manners

Check what a project actually references before writing code for it. In this repo `catch (PostgresException)` in an Application handler **does not compile** — Npgsql is referenced only by Infrastructure. Database-specific error handling stays in Infrastructure; Application asks for an outcome (`Try…Async → bool`), never a SQLSTATE.

### B3. Security proofs must run as the real role

An RLS proof executed as `postgres` (or any `BYPASSRLS` role) proves **nothing**. Connect as the application role and assert `rolsuper OR rolbypassrls` is false **before** any other assertion, or the whole suite is vacuous.

### B4. The database is not the whole defence

**Postgres FK checks bypass RLS.** A foreign key proves a row exists — not that the caller may see it. Multi-tenant writes must assert tenancy on **both** sides in application code, and be tested in **both** directions (foreign parent *and* foreign child).

Likewise, a permissive `SELECT` policy OR-ed with a tenant policy means "visible" ≠ "authorised."

### B5. Never destroy real data to make a test or a seed convenient

If a lifecycle guard blocks a teardown, the guard is the protection — not the defect. Scope cleanup to what the seeder itself created, identified deterministically, and **throw loudly** on anything real rather than deleting it.

Rehearse migrations and security proofs against a **throwaway database**. Never migrate the working database from a test.

### B6. Measure; never predict

Record **baseline → change → actual result**. A predicted test total is an assertion about the future, and it will be wrong. Evidence beats arithmetic.

### B7. Reuse the pattern, not the wrong table

Prefer an existing repository convention — but verify it actually *fits*. Two things named "correction" in this repo mean entirely different things: one captures AI parse corrections (keyed on a parse id a manual entry doesn't have), the other records a domain-record correction. Copying the *shape* of the right one beats forcing the wrong one.

---

## C. How sessions and agents operate

### C1. Design here. Execute fresh.  **[LOCKED — founder, 2026-08-11]**

Architecture and implementation are **separate sessions**. Mixing them causes forgotten constraints, scope creep, stale assumptions, and context drift. An architecture session ends with a handoff document complete enough that the next agent never needs the conversation that produced it.

### C2. Someone must have authority to close findings

**Born from a verification recursion loop:** four independent agents, each rewarded for finding defects, each with veto power, produced 37 findings across two runs — many duplicates. One bad test assertion was counted as four separate blockers. Reported as "3 CRITICAL, 18 BLOCK," it read as product risk when it measured review volume.

**Fix:** one decision authority. Deduplicate before counting. Then classify every finding into exactly one bucket:

| Bucket | Meaning |
|---|---|
| **LAUNCH BLOCKER** | Loses, duplicates, corrupts, or cross-tenant exposes real user data — or breaks an advertised journey |
| **SAFE DEFER** | Real, but fixing it later needs no migration or reinterpretation of existing data |
| **EXISTING DEBT** | Predates this work and this work doesn't worsen it |
| **PLAN DEFECT** | Wrong path, wrong line, impossible test, contradiction — fix the instruction, don't reopen the design |
| **OUT OF SCOPE** | Belongs to a future phase |

### C3. The acceptance standard is journeys, not bug counts

> **Zero unresolved launch blockers against the approved user journeys.**

Plan-writing mistakes don't veto launch. Pre-existing bugs on unreachable paths don't veto launch. Missing future features don't veto launch. **Real users losing or corrupting real data does.**

### C4. Scope follows the actual journey, not every reachable code path

Before treating a broken capability as a blocker, ask: **can a user actually reach it in the shipping UI?** If not, it is existing debt. Do not let an unreachable path force an architecture project.

**Born from:** a code path that stamps AI provenance turned out to have no caller in the shipped app at all — while "Entire Farm," which *is* the first card on the log page, silently dropped every record. One was debt; the other was a genuine blocker. Only tracing the real UI told them apart.

### C5. Architecture locks; documents get patched in place

Once frozen, a decision reopens only on **evidence that implementing it is impossible** — never because another design seems cleaner. Patch the authoritative document; do not fork a new version. Repeatedly re-litigating settled decisions reduces delivery quality rather than improving it.

> **Do not ask whether the architecture can be improved. Ask whether the next acceptance test passes.**

### C6. Report faithfully

State what was measured, what was skipped, and what failed. Own errors plainly and move on — no accumulating apology. If a subagent or verifier is wrong, say so with evidence rather than deferring to it; if it is right, correct course without ceremony.

---

## D. Recurring technical facts about this repo

Verified 2026-08-11. These have cost real time more than once.

| Fact | Consequence |
|---|---|
| A running dev `AgriSync.Bootstrapper` locks its Debug output | Use `--configuration Release` for ArchitectureTests / BuildingBlocks.Tests / Sync.IntegrationTests **and `dotnet ef`**, where the failure is disguised as a bare *"Build failed."* |
| Multiple `DbContext` types are reachable from the startup project | `dotnet ef` **requires** `--context`; several tracked docs omit it and are known-broken |
| `make boot` swallows migration failure | It reports success on a failed migration. Do not trust it as verification. |
| `ssf.farms` and `ssf.daily_logs` are keyed on quoted `"Id"` | Case-sensitive; unquoted `id` fails at runtime, not compile time |
| The `/sync/push` payload check is a strict **allow-list** | Adding a field to a payload without adding it to the allow-list rejects the **entire** mutation |
| `IShramSafalRepository` uses default interface implementations deliberately | It has 28 implementors; a new **abstract** member produces ~135 compile errors |
| An EXISTS-based `WITH CHECK` on a child table fails `42501` | EF batches parent+child in one `SaveChanges`; this was tried and reverted. Give new tables a direct tenant column instead. |
| vitest 4 removed `--reporter=basic` | Passing it kills the run before any test executes |
| Env vars for the Postgres suites are **User-scope** | A shell started earlier silently falls back to a config whose role lacks `CREATEDB`; the probe succeeds and `CREATE DATABASE` then fails |

---

## Cross-references

- **Agent operating rules:** `CLAUDE.md` (repo root) — hard rules, commit conventions, Definition of Done
- **Locked Labour V1 plan:** `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md`
- **Labour V1 execution handoff:** `docs/superpowers/plans/2026-08-11-labour-v1-EXECUTION-HANDOFF.md`
- **Founder locked decisions:** `docs/superpowers/handoffs/2026-07-19-LOCKED-DECISIONS.md`

**Candidates for promotion into `CLAUDE.md`** (they bind every agent on every task, not just AgriSync features): **A1** the Phase Rule · **A4** no fabricated numbers · **B1** repo is truth · **B3** security proofs as the real role · **B5** never destroy real data for convenience · **B6** measure, never predict.
