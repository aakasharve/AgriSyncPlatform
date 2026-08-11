# AgriSync Doctrine

**Status:** Canonical · **Owner:** Founder · **Last updated:** 2026-08-11 (Labour V1 architecture session)

This document defines **how AgriSync reasons**. It is the constitution: it outranks any feature plan on matters of principle, and it is deliberately short so it stays readable.

> **Scope.** This is not a feature specification. Entities, schemas, endpoints, UI decisions and acceptance tests belong in a feature's locked plan and execution handoff. **When a feature plan and this doctrine conflict, a LOCKED PRINCIPLE wins; otherwise verify intent before changing either.** Do not grow this document every time a subsystem is built.

Every rule carries a **Born from** line naming the incident that produced it. A principle without its scar tissue gets argued away by the next clever idea — and six months later someone "cleans it up" and recreates the original failure.

---

## §0. What AgriSync optimises for

In this order. When two pull against each other, the higher number yields.

1. **Truth before intelligence.**
2. **Farmer trust before feature breadth.**
3. **Explainability before impressive automation.**
4. **Durable history before convenient mutation.**
5. **Low-friction capture before data completeness.**
6. **Human confirmation before consequential AI action.**
7. **Delivery evidence before scale.**

---

## §1. Authority

Three levels. The prefix on every rule tells you which.

| Level | Prefix | Meaning |
|---|---|---|
| **LOCKED PRINCIPLE** | `P` | Founder/product invariant. **An agent may not reopen it.** Changes only by founder decision. |
| **ENGINEERING RULE** | `E` · `W` | Default architectural or working rule. May be departed from **only** with explicit evidence and documented reasoning. |
| **OBSERVED REPO FACT** | `F` | A current implementation observation. **Re-verify before relying on it.** |

### The decision hierarchy

```
Founder / Product Principles          ← §2, the P rules
        ↓
AgriSync Doctrine                     ← this document
        ↓
Locked Feature Specification          ← e.g. the Labour V1 plan
        ↓
Execution Handoff                     ← construction instructions
        ↓
Repository Truth                      ← what actually exists
        ↓
Tests / Runtime Evidence              ← what actually happens
```

**The one nuance that matters:** repo truth determines *what exists* — it does **not** automatically override a locked product invariant. If the repo contradicts a `P` rule, **the code is what needs reconciliation**, not the principle. Raise it; do not silently conform the principle to the code.

---

## §2. LOCKED PRINCIPLES — data truth

### P1. The Phase Rule *(founder, 2026-08-11)*

> **Phase 1 stores what the farmer confirmed. Phase 2 derives what the system inferred. Neither may impersonate the other.**

A voice-originated record is **not** automatically "AI data." Once the farmer confirms it, it is farmer-asserted truth and belongs in the durable write path beside its parent. Inferred and enriched data may be best-effort.

**Corollary — canonical data must never live in a best-effort side-car.** Of every new child record ask: *is this the farmer's own assertion, or something we inferred?* That answer picks the phase.

**Born from:** `CreateDailyLogHandler`'s two-phase design. Phase 2 catches every exception, logs a warning and returns success — correct for weather and AI derivation. Putting canonical labour there would have made failure **silent and unrecoverable**: the log commits, the child rows vanish, and the duplicate-key early return then returns the existing log on every retry, so the side-car is never reached again. There is no backfill job anywhere in the system.

### P2. Fast entry, forgiving correction, trustworthy history *(founder, 2026-08-11)*

> **Record now → inspect later → correct → trust the final record.**

The first record creates habit. The correction flow creates confidence. The audit trail creates trust. **All three are required.**

A farmer learning the app will record 8 when it was 6, forget someone, or pick the wrong worker. *"Once saved you cannot correct it"* makes people afraid to log at all — fatal for a habit-forming product. **Correction is an adoption safety net, not an advanced feature.**

Target mental state: *"पहिले नोंद करतो. चूक झाली तर तपासून दुरुस्त करता येईल."*

### P3. Correction is never silent mutation

> **Easy to correct. Hard to falsify history.**

A correction states this **was** X and, after verification, **is now** Y. Always name which entity holds *current truth* and which holds *history* — never leave that for an implementer to invent. Do not overwrite a recorded value with no trace. Do not hard-delete something history should still be able to explain.

### P4. No fabricated numbers reach a farmer *(founder, 2026-08-10)*

> **No score, metric or derived figure may exist unless its underlying evidence exists and is explainable.**

**Born from two live, shipped examples:** a reliability score rendered beside a **named real person** that returned **100 for every worker, always** — its metrics source returned zeros and the scorer treated zero logs as a perfect ratio. And "तास: ८ तास", computed as `defaultHours || 8` inside a loop that ignored every event — the maximum of a constant, with no settings UI behind it. Both were constants wearing the costume of a measurement.

### P5. A truthful missing feature beats a fake working one

If a control cannot yet do what it appears to do, **disable it or make it real** — never leave it looking functional. Applies equally to a button that doesn't persist and a number that isn't measured.

### P6. Creator ≠ data subject *(founder)*

The person who *typed* a third party's name is not that third party's data subject. Account erasure by the creator must not automatically erase the named worker. **But the capability to erase the worker must exist** before real names ship. Anonymize the person; **never** the work — preserve the identity's id, its relationships, dates and all non-identifying execution history.

### P7. Attribution never changes reported quantity *(founder)*

`WorkerCount = 8` with 3 people named is still **8**. Identifying people is an *overlay* on a reported quantity, never a replacement. Naming people must never shrink the number — that punishes the farmer for being helpful.

### P8. Provenance over precision

When a value may be either stated or assumed, **record which**, as one atomic fact alongside the value. `DurationHours` alone is a lie; `DurationHours + TimeBasis` is a record.

> Five years from now the system must be able to say what the farmer actually told us, without pretending inferred information was observed information.

### P9. Low-friction capture is sacred *(founder)*

The simplest real utterance — *"आज ८ मजूर होते"* — must complete its record with **zero** names, warnings, wizards, completion percentages or nags. **No optional field may ever reject a record.** Enrichment is always optional; the closure loop is never subordinate to it.

---

## §3. ENGINEERING RULES — how we build

### E1. Repo is truth. Verify before asserting.

Never state a file path, line number, behaviour or past decision without opening it. A plan built on unverified claims fails review no matter how good its architecture.

**Born from:** three revisions of one plan blocked, overwhelmingly for asserting untrue things about the codebase — invented test helpers, a contract field that didn't exist, an un-run baseline, an RLS proof that ran as superuser. In the same session a *founder decision document was cited as ruling the opposite of what it says*, twice, in opposite directions. **Reading the source is cheaper than one review cycle.**

### E2. Layer boundaries are enforced by the build, not by good manners

Check what a project actually references before writing code for it. Database-specific error handling stays in Infrastructure; Application asks for an outcome (`Try…Async → bool`), never a SQLSTATE. *(See `F6`.)*

### E3. Security proofs must run as the real role

An RLS proof executed as a superuser or any `BYPASSRLS` role proves **nothing**. Connect as the application role and assert `rolsuper OR rolbypassrls` is false **before** any other assertion, or the suite is vacuous.

### E4. The database is not the whole defence

**Postgres FK checks bypass RLS.** A foreign key proves a row exists — not that the caller may see it. Multi-tenant writes must assert tenancy on **both** sides in application code, and be tested in **both** directions (foreign parent *and* foreign child). A permissive `SELECT` policy OR-ed with a tenant policy means "visible" ≠ "authorised."

### E5. Never destroy real data to make a test or a seed convenient

If a lifecycle guard blocks a teardown, **the guard is the protection, not the defect.** Scope cleanup to what the seeder itself created, identified deterministically, and **throw loudly** on anything real rather than deleting it. Rehearse migrations and security proofs against a throwaway database; never migrate the working database from a test.

### E6. Measure; never predict

Record **baseline → change → actual result**. A predicted test total is an assertion about the future and it will be wrong. Evidence beats arithmetic.

### E7. Reuse the pattern, not the wrong table

Prefer an existing convention — but verify it actually *fits*. Two things named "correction" in this repo mean entirely different things: one captures AI parse corrections (keyed on a parse id a manual entry doesn't have), the other records a domain-record correction. Copying the *shape* of the right one beats forcing the wrong one.

---

## §4. WORKING RULES — how sessions and agents operate

### W1. Design here. Execute fresh. *(founder, 2026-08-11)*

Architecture and implementation are **separate sessions**. Mixing them causes forgotten constraints, scope creep, stale assumptions and context drift. An architecture session ends with a handoff complete enough that the next agent never needs the conversation that produced it.

### W2. Someone must have authority to close findings

**Born from a verification recursion loop:** four independent agents, each rewarded for finding defects and each holding veto power, produced 37 findings across two runs — many duplicates. One bad test assertion counted as four separate blockers. Reported as "3 CRITICAL, 18 BLOCK," it read as product risk when it measured review volume.

**Fix:** one decision authority. Deduplicate before counting. Then classify every finding into exactly one bucket:

| Bucket | Meaning |
|---|---|
| **LAUNCH BLOCKER** | Loses, duplicates, corrupts or cross-tenant exposes real user data — or breaks an advertised journey |
| **SAFE DEFER** | Real, but fixing it later needs no migration or reinterpretation of existing data |
| **EXISTING DEBT** | Predates this work and this work doesn't worsen it |
| **PLAN DEFECT** | Wrong path, wrong line, impossible test, contradiction — fix the instruction, don't reopen the design |
| **OUT OF SCOPE** | Belongs to a future phase |

### W3. The acceptance standard is journeys, not bug counts

> **Zero unresolved launch blockers against the approved user journeys.**

Plan-writing mistakes don't veto launch. Pre-existing bugs on unreachable paths don't veto launch. Missing future features don't veto launch. **Real users losing or corrupting real data does.**

### W4. Scope follows the actual journey, not every reachable code path

Before treating a broken capability as a blocker, ask: **can a user actually reach it in the shipping UI?** If not, it is existing debt. Do not let an unreachable path force an architecture project.

**Born from:** a code path stamping AI provenance turned out to have no caller in the shipped app at all — while "Entire Farm," the *first card* on the log page, silently dropped every record. One was debt, the other a genuine blocker. Only tracing the real UI told them apart.

### W5. Architecture locks; documents get patched in place

Once frozen, a decision reopens only on **evidence that implementing it is impossible** — never because another design seems cleaner. Patch the authoritative document; do not fork a new version.

> **Do not ask whether the architecture can be improved. Ask whether the next acceptance test passes.**

Not because architecture should never improve — but because after a decision has survived enough reasoning, endless optimisation becomes a delivery failure.

### W6. Report faithfully

State what was measured, what was skipped and what failed. Own errors plainly and move on — no accumulating apology. If a subagent or verifier is wrong, say so with evidence rather than deferring to it; if it is right, correct course without ceremony.

---

## §5. OBSERVED REPO FACTS — verify before relying

> ⚠️ **These are observations, not architecture locks.** **Last verified 2026-08-11.** If the code contradicts this section, **current repo truth wins** and this section is what gets updated — per `E1`. Do not treat an entry here as authority.

| # | Fact | Consequence |
|---|---|---|
| **F1** | A running dev `AgriSync.Bootstrapper` locks its Debug output | Use `--configuration Release` for ArchitectureTests / BuildingBlocks.Tests / Sync.IntegrationTests **and `dotnet ef`**, where the failure is disguised as a bare *"Build failed."* |
| **F2** | Multiple `DbContext` types are reachable from the startup project | `dotnet ef` **requires** `--context`; several tracked docs omit it and are known-broken |
| **F3** | `make boot` swallows migration failure | Reports success on a failed migration. Not verification. |
| **F4** | `ssf.farms` and `ssf.daily_logs` are keyed on quoted `"Id"` | Case-sensitive; unquoted `id` fails at runtime, not compile time |
| **F5** | The `/sync/push` payload check is a strict **allow-list** | Adding a payload field without adding it to the allow-list rejects the **entire** mutation |
| **F6** | `ShramSafal.Application` has no Npgsql reference | `catch (PostgresException)` there **does not compile** — this is what makes `E2` structural rather than stylistic |
| **F7** | `IShramSafalRepository` uses default interface implementations deliberately | 28 implementors; a new **abstract** member produces ~135 compile errors |
| **F8** | An EXISTS-based `WITH CHECK` on a child table fails `42501` | EF batches parent+child in one `SaveChanges`; tried and reverted. Give new tables a direct tenant column. |
| **F9** | vitest 4 removed `--reporter=basic`; Postgres-suite env vars are User-scope | Passing the reporter kills the run before any test; a stale shell falls back to a config whose role lacks `CREATEDB`, so the probe succeeds and `CREATE DATABASE` then fails |

---

## §6. Required reading — Labour, trust-ledger, correction, provenance work

**When cofounder mode activates for any of this work, read in this order before proposing anything.** This is the domain where the expensive lessons were learned, and where re-deriving from first principles has already cost five plan revisions.

| Order | Document | What it is |
|---|---|---|
| 1 | **This doctrine** | How we reason. `P` rules bind. |
| 2 | `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md` | The **locked** Labour V1 specification — architecture frozen, patched in place, no V6 |
| 3 | `docs/superpowers/plans/2026-08-11-labour-v1-EXECUTION-HANDOFF.md` | Baseline SHA, task contracts, launch gates, the implementation agent's starting prompt |
| 4 | `docs/superpowers/handoffs/2026-07-19-LOCKED-DECISIONS.md` | Founder decisions predating the above — **read the ruling, never infer it** (`E1`) |

**Applies to:** labour identity and attribution · the work anchor · headcount semantics · time provenance · correction and approval flows · worker PII and erasure · any trust-ledger surface.

**The three that get violated most often, so check them explicitly:** `P1` (Phase Rule), `P7` (attribution never changes quantity), `P4` (no fabricated numbers).

---

## Cross-references

- **Agent operating rules:** `CLAUDE.md` (repo root) — hard rules, commit conventions, Definition of Done. It **points** here; it does not duplicate this content.
- **Cofounder OS boot:** `_COFOUNDER/CLAUDE.md`
