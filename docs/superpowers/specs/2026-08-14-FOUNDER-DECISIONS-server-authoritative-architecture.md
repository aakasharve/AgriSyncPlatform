# Founder Decisions — Server-Authoritative Trust Architecture

**Status:** LOCKED. These are rulings, not suggestions. Read the ruling; never infer it (`E1`).
**Date:** 2026-08-14 · **Author:** Founder · **Recorded by:** Claude (cofounder mode)
**Branch:** `feat/server-authoritative-architecture`

**Governs:** `2026-08-14-PLANNING-DIRECTIVE-server-authoritative-trust-architecture.md` (the mandate) ·
`2026-08-14-server-authoritative-cloud-architecture.md` (the model) ·
`2026-08-14-server-authoritative-architecture-OPEN-QUESTIONS.md` (the questions these answer)

> **On authority.** The founder decides truth, risk, retention, UX promises and product behaviour.
> The planning agent decides mechanics. A question that does not change *what truth we preserve, who
> can change it, what may be lost, what the farmer sees, or what privacy/storage promise we are
> making* is not a founder question. It gets designed, justified and presented in the plan.

---

## The three corrections that outrank the individual answers

### Correction 1 — offline action and authoritative state are different things

A user may **act** offline. That does not grant the device authority to declare `VERIFIED`,
`DISPUTED`, "latest version" or "conflict winner".

```
The phone records INTENT.
The server commits TRUTH.
```

This is central to the architecture and it governs Q12 and Q17 directly.

### Correction 2 — "keep forever" applies to durable farm history, not blindly to every byte

Server-authoritative does **not** mean retaining every original audio file, cache object, intermediate
AI output and duplicate binary forever. Six distinct lifecycles:

```
Durable farm truth
Historical / audit truth
Provenance
Evidence
Temporary processing artifact
Cache
```

Each gets its own retention rule.

### Correction 3 — not every edge case is a founder decision

Stop returning questions about cursor structure, idempotency implementation, thumbnail dimensions,
retry intervals, table layout, storage key naming, or cache eviction algorithms. Those are
architecture and planning judgment.

**Escalate only when the answer changes one of these five:**

> What truth do we preserve? · Who can change it? · What may be lost? · What does the farmer see? ·
> What privacy or storage promise are we making?

---

## The rulings

| Q | Topic | Ruling |
|---|---|---|
| **Q1** | First-login behaviour | Progressive bootstrap. Recent and current state first, history on demand. *(Already in the planning directive §9.)* |
| **Q2** | Financial summary | **(a)** Server calculates the derived financial summary. **`P1` accepted.** Farmer-entered `manualTotalCost` stays separately stored and identifiable as farmer-stated. **Never merge the two concepts.** |
| **Q3** | Legacy mangled machinery | **(a)** Preserve old mangled records as legacy. **`P3` accepted.** Do not parse uncertain text back into authoritative machinery data. **Duplicate handling:** only one representation may be visible to the farmer. Preserve the underlying legacy evidence, but the reconciliation design must prevent the old local structured copy and the server legacy copy from appearing as two separate works. **Never delete uncertain evidence merely to deduplicate.** |
| **Q4** | Weather | **(b) for now.** Keep weather server-side for future intelligence. Do not build a reader until something consumes it. **Document that this is intentional.** |
| **Q5a** | Device sync window | Bounded operational window; older history fetched on demand. |
| **Q5b** | Server retention | Durable farm history kept unless explicitly deleted under the applicable product/data rules. **Performance must never be solved by deleting history.** |
| **Q6** | Marathi | **English placeholders during architecture and design.** Founder-authored Marathi is required before farmer-facing release. Copy must not block architectural planning. **Agents must not invent final Marathi.** |
| **Q7** | Project shape | **(c) with separate execution gates.** Source-of-truth and media belong to the same architectural programme because both establish cloud authority. They do **not** ship atomically. **Live updates are deferred.** |
| **Q8** | Phase A gate | **(a)** The Data Ownership Matrix is a **hard gate** before implementation planning. |
| **Q9** | Irrigation / input fabrication | **(a) In scope.** It is the same architectural defect, not unrelated debt. Also **neutralise fabricated values immediately** if the full repair cannot land in the same step. **Unknown must never be rendered as known.** |
| **Q10** | Never-sent fields | Manual total cost = **durable farmer truth**. Transcript = **capture provenance**, survives where policy permits. Phase and day number = **derive, do not duplicate**, if deterministic. Understanding Meter = **derived**; recompute from its versioned logic, never treat an old score as farmer truth. |
| **Q11** | Unconfirmed voice draft | **(a)** Unconfirmed drafts are not durable farm truth and may stay device-local. Audio may be processed transiently after consent if required, but **do not durably archive it merely because the farmer spoke before confirming.** **Confirmation is the durable-truth boundary.** |
| **Q12** | Offline trust-ladder | **Neither (a) nor (b).** The farmer or owner may perform the action offline, but it is a **pending transition intent**, not a canonical `VERIFIED` / `DISPUTED`. The server performs the authoritative role and version check on reconnect. Rural usability survives without creating two competing trust ladders. |
| **Q13** | Planned tasks | **Durable farm truth.** Losing future work because the phone changed is unacceptable. |
| **Q14** | Selected farm | **Device preference.** Do not synchronise across devices. |
| **Q15** | Server rejects a pending action | **(a)** Preserve the rejected content and surface that it needs attention. **Never silently discard**, and **never retry a permanently invalid mutation forever.** |
| **Q16** | Outbox lifetime | **No automatic expiry for valid unsent business work.** Keep until committed, explicitly discarded by the user, or moved into a resolvable rejected state. **When storage is tight:** evict disposable cache first · protect unsent structured work · reduce or limit new media capture · clearly tell the user. **Never silently delete unsynced evidence.** |
| **Q17** | Two devices, same record | **Do not use blind last-write-wins.** Use server version and concurrency rules. Non-conflicting changes may merge when deterministic. **Conflicting changes to the same fact must preserve both submitted intents and surface a resolution** rather than silently destroying one person's update. |
| **Q18** | Correcting before first sync | **Agreed.** Before the server has accepted any version, local corrections collapse into one final pending mutation. **Do not manufacture server history for edits the server never saw.** |
| **Q19** | Photo vs log ordering | **Agreed.** Structured log first; media follows independently. The record must clearly know its attachment upload is pending. **A weak photo connection must not hold today's farm work hostage.** |
| **Q20** | Reuse existing sync | **Reuse the existing channel if it can satisfy the new invariants. Do not build a parallel sync system.** But existing code is **not sacred** — harden or restructure `/sync/push` and `/sync/pull` where required. |
| **Q21** | Thumbnails | **(c)** Device produces an immediate lightweight representation; the server or object pipeline creates canonical derivatives later. **Successful capture must never depend on server thumbnail processing.** |
| **Q22** | Compression | **Agreed.** Purpose-specific, not one global quality number. Receipt and evidence images need different fidelity from ordinary field photos. **Planning agent determines the measured presets.** |
| **Q23** | Existing uncompressed photos | **Measure first.** No historical rewrite before knowing count, storage, cost and actual benefit. |
| **Q24** | Voice audio retention | **(b) Finite retention. Default: 30 days after confirmed transcription**, then remove the audio while retaining the confirmed structured record and transcript as policy allows. **Audio in an active dispute or evidence workflow may need a different lifecycle.** Do not retain all voice forever by default. |
| **Q25** | Presigned upload | **Accepted.** Presigned direct object upload is correct. The agent designs strict authorization, short expiry, object-specific scope, ownership, content and size constraints, and **server-side finalisation and verification**. |
| **Q26** | Bootstrap contents | Per the planning directive §9. **Recent logs window = 7 days** as the planning default. Active crop-cycle identity and summary present without downloading the whole cycle's history. Older records on demand. **Adjust only if measurement proves 7 days harms the farmer workflow.** |
| **Q27** | Multi-farm bootstrap | **Agreed.** All memberships visible; hydrate operational data for the current farm. Switching farm hydrates that farm. |
| **Q28** | Half-finished first sync | Recording today's work stays available. Unavailable historical state shows as **loading or partial**, never falsely rendered as empty or zero. |
| **Q29** | Sync-invisible vs `P5` | **(a) with a constraint.** Healthy synchronisation stays unobtrusive. **The product may never label a locally pending mutation as server-committed.** Sync becomes prominent when intervention is required; ordinary pending state may be subtle but must be truthful. |
| **Q30** | New locked principle | **Yes. Add `P10`:** *"No successful business mutation may permanently exist only on one client device."* A foundational invariant, not a temporary implementation preference. |
| **Q31** | ADR | **Required.** Legacy machinery handling, fabricated legacy reconstruction, rejection semantics and similar irreversible data-honesty decisions get permanent reasoning. |
| **Q32** | Prod raw-blob bucket | **Check now as a separate small production-risk task. Start read-only.** Do not couple it to the architecture project unless it reveals a genuine security or data-loss dependency. |
| **Q33** | Live updates | **Not now.** Correct multi-device consistency first. Cursor and delta refresh on login, foreground and sensible refresh points is enough initially. Real-time push comes when operational behaviour requires it. |
| **Q34** | Unpruned message table | **Fix it, but isolate it.** Establish a safe pruning and retention mechanism because the new architecture increases event volume. **Do not let this housekeeping enlarge or block the source-of-truth migration.** |

---

## What these rulings changed about the plan

1. **`P10` enters the doctrine.** Draft it, founder approves, then it binds every future agent.
2. **Irrigation and inputs are in scope.** The defect class, not the four named fields.
3. **Media is inside the programme, not a separate project**, but ships on its own gate.
4. **Live updates are out.** Not deferred vaguely; deferred by decision.
5. **The device never holds trust-ladder authority.** Offline transitions become pending intents.
6. **Conflict is never resolved by destroying a submission.** Both intents survive.
7. **Voice audio has a 30-day default lifetime**, with a dispute exception.
8. **Phase A is a hard gate.** No implementation planning until the matrix exists and the founder has
   corrected it.

---

## Still owed by the founder, before farmer-facing release

Not blocking architecture. Blocking release.

- **Marathi copy** for: partial record · saved on phone not yet sent · sending · saved on the farm ·
  could not be sent (anti-ego wording) · older records still loading · value inferred from a legacy
  entry.
- **Merge of `feat/labour-management-ui` into `main`.** Founder-gated, never autonomous.
