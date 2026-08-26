# Lane B — Server-Authoritative Architecture Programme

**Status:** Target architecture and sequencing. **Not an executable plan.** Each phase gets its own
plan through `superpowers:writing-plans` as its predecessor lands.
**Date:** 2026-08-15 · **Branch:** `feat/server-authoritative-architecture`

**Reads with:**
`2026-08-14-PLANNING-DIRECTIVE-server-authoritative-trust-architecture.md` (the mandate) ·
`2026-08-14-FOUNDER-DECISIONS-server-authoritative-architecture.md` (34 rulings) ·
`2026-08-14-FOUNDER-DIRECTION-after-phase-A.md` (post-audit rulings, C1–C7, scenarios A–G) ·
`2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md` (current state + violations) ·
`../plans/2026-08-15-lane-a-trust-containment.md` (runs in parallel) ·
`../../AGRISYNC-DOCTRINE.md` (constitution)

> **Why this is not one big plan.** The founder direction §13 says the code ordering must come from
> dependency analysis, not the conceptual phase list. Writing bite-sized tasks for phases that depend
> on decisions not yet made would be a placeholder farm, which the plan-authoring rules forbid. §4 of
> this document does the dependency analysis; §5 turns it into the real sequence; Phase 1 gets an
> executable plan immediately.

---

## 1. The target, in one paragraph

The server is the permanent authority for durable farm truth. The device holds four things and only
four: a disposable cache, an outbox of intent the server has not yet accepted, downloaded media, and
genuine device preferences. Offline capture stays extremely reliable — but offline capability never
becomes a second database. **A farmer can throw his phone into a well after synchronisation, buy
another, log in, and continue working without losing or falsifying his farm history.**

---

## 2. The contract every domain must pass through

Phase A found one defect class with fifty faces: **capture, persistence, read-back and reconstruction
were built as partially independent paths.** The cure is that every domain traverses one pipeline, and
no domain is finished until it has traversed all of it.

```text
Capture
   ↓
Durable intent            (outbox — survives crash, expiry-free, never a second database)
   ↓
Canonical server mutation (one contract, idempotent, versioned where it matters)
   ↓
Authoritative storage     (a real server home, in the durable write path, not a side-car)
   ↓
Canonical server read     (the same semantics come back)
   ↓
Faithful reconstruction   (unknown stays unknown; nothing is invented)
   ↓
Disposable local copy     (safe to destroy)
```

**The pipeline is the unit of correctness. The domain is the unit of delivery.** That is the single
most important sequencing decision in this document, and §5 explains why.

### The three truths that must stop being one flag

Founder direction §8. Every confusing thing Phase A found was these three collapsed together.

| Truth | Question | Owner |
|---|---|---|
| **Business truth** | What happened on the farm | Server, permanently |
| **Synchronization truth** | Whether the server has accepted it | The sync lifecycle |
| **Processing truth** | Whether AI, media or background work finished | Per-subsystem, independently |

This must be a representable state:

```text
Farm work captured      = YES
Server committed        = YES
Photo uploaded          = NO
AI extraction completed = NO
```

**One incomplete subsystem must never invalidate the others.** Today a pending photo and an unsent log
share the same indicator, which is why the honesty chip can shout about a permanently dead row.

---

## 3. The five ownership categories, and the sixth that must not exist

| Cat | Meaning | Destroyable? |
|---|---|---|
| **A** | Server domain truth | Yes — reconstructable from the server |
| **B** | Cloud media | Yes — bytes live in object storage |
| **C** | Disposable client cache | Yes, by definition |
| **D** | Offline outbox | **No** — until the server acknowledges it |
| **E** | Device preference | Yes — genuinely device-specific |

> There is no category for *"important information that exists permanently only on this phone."*
> Phase A found it holding the farmer's harvest book, his purchase book, his plot boundaries and his
> planned work. Eliminating that category is what this programme is for.

**Founder ruling (direction §5) — do not preserve a feature merely because a local table exists.**
For each store, first ask: *is this actually product truth that deserves server persistence?* Dead and
experimental stores may simply disappear. Phase A found six with zero writers.

---

## 4. Dependency analysis

What actually blocks what. This is what §5's ordering is derived from.

| Capability | Hard dependencies | Can start before its dependency? |
|---|---|---|
| **C1 Truth contracts** | none | — it is the root |
| **C2 Authoritative persistence** | C1 for the domain in question | No. Storage without a contract is how side-cars happen |
| **C3 Faithful reconstruction** | C2 **read-back working** for that domain | No. This is doctrine trap #3: read-back must precede any change to what the client sends |
| **C4 One sync lifecycle** | C1 for the state model only | **Yes, partly.** The lifecycle semantics can be designed and unified before every domain contract exists |
| **C5 Offline intent** | C4 | It is C4's client half; not separable in practice |
| **C6 Media lifecycle** | Nothing in C1–C5 | **Yes, fully parallel.** Different transport, different storage, different failure modes |
| **C7 Concurrency** | C1 (a version on the contract) + C2 (somewhere to store it) | No, and it applies only to entities where competing edits actually matter |

### Three ordering rules that fall out

1. **Within a domain, the pipeline order is mandatory and non-negotiable:**
   `contract → server storage → server read-back → client reconstruction → only then remove the local-only path`.
   Founder directive §21 states this; doctrine trap #3 is the scar from breaking it.
2. **C6 media runs in parallel from day one.** It shares no files with the domain work.
3. **C4's state model comes early, its per-domain application comes with each domain.** Designing the
   lifecycle late means every domain invents its own — which is exactly how five sync mechanisms
   happened.

---

## 5. The real sequence: pipeline as unit, domain as increment

**Not eight global phases.** Eight global phases means nothing is durable until phase 3 completes for
everything, and the farmer gets no benefit until the end.

Instead: build the pipeline once, then walk domains through it. **Each domain that completes the
pipeline is independently valuable and independently shippable**, and every one of them permanently
removes a piece of the sixth category.

```text
FOUNDATION  ──────────────────────────────────────────────
  F1  Contract shape + provenance + completeness envelope   (C1, once)
  F2  Sync lifecycle state model + honesty semantics        (C4, once)
  F3  Version/concurrency primitive, opt-in per entity      (C7, once)
       ↓
DOMAIN INCREMENTS  ── each walks the full pipeline ────────
  D1  DailyLog completion    machinery · activity expenses · observations detail
  D2  Money truth            direction · provenance · stated-vs-derived · summary
  D3  Planned tasks          founder-ruled durable truth, zero server presence today
  D4  Harvest                zero server presence; live product capability
  D5  Procurement            zero server presence
  D6  Farm geography         plot polygons, baselines, irrigation config
       ↓
PARALLEL FROM DAY ONE  ───────────────────────────────────
  M1  Media lifecycle        compression · presigned upload · thumbnails · orphan reaping · CDN read
                             · DEVICE-SIDE cleanup after successful upload  ← largest silent
                               data-loss vector on the phone; see below
       ↓
CLOSE-OUT  ───────────────────────────────────────────────
  X1  Legacy migration + dead-store removal
  X2  Destructive-device and rural failure testing (scenarios A–G)
```

### Why this domain order

| # | Domain | Why here |
|---|---|---|
| **D1** | DailyLog completion | The daily log is the product's spine, it already has a working contract and read-back to extend (labour proved the pattern), and it is where the same-device destruction bites. Highest value, lowest new-ground. |
| **D2** | Money | Highest harm per defect. Depends on D1's provenance envelope, so it cannot go first without duplicating that work. |
| **D3** | Planned tasks | Founder-ruled durable truth with **zero** server presence. Small domain, complete pipeline, good proof the pattern works on new ground. |
| **D4/D5** | Harvest, procurement | Entirely new server domains. Largest build. Both currently hold real farmer records with no server copy, so they are the biggest remaining sixth-category holdings. |
| **D6** | Farm geography | Real work a farmer does (drawing his plots) with no server home. Lower frequency than the others, so last. |

**Every domain increment ends the same way:** the local-only path is removed **only after** its
read-back is proven, and the legacy data for that domain is handled per §7.

---

## 6. What each foundation piece delivers

### F1 — Contract shape (C1)

Per durable domain object, a canonical server shape carrying: **value · origin · captured-at · actor ·
identity · version where required · completeness**.

Three things it must make representable, because Phase A proved their absence causes falsification:

1. **"The server states nothing"** — distinct from "the server states none". The `financialSummary`
   zeros and the `verification` downgrade both came from silence being read as a statement.
2. **Stated versus derived** (`P1`, ruling Q2). A farmer's typed total and a computed total must never
   collapse into one field, in either direction.
3. **Provenance** (`P8`, directive §6). Typed, voice-inferred and job-card-generated must remain
   distinguishable after a device wipe.

**Completeness — corrected by founder ruling 2026-08-15 §6.** An earlier draft listed
`Complete · Legacy partial · Pending synchronization · Media pending · Reconstructed/inferred` as one
enum. **That was wrong, and it repeated the exact mistake §2 warns against** — collapsing the three
truths back into one magical `status` field, two pages after separating them.

These are four orthogonal facts and must be modelled orthogonally:

| Fact | Belongs to | Example values |
|---|---|---|
| **Record completeness** | business truth | `complete` · `legacy partial` |
| **Synchronization state** | sync truth (F2) | `pending` · `committed` · `rejected` |
| **Processing state** | processing truth, **per subsystem** | media pending · AI extraction pending |
| **Provenance** | the value itself (`P8`) | farmer-stated · AI-inferred · derived · legacy-imported |

A record can be `complete`, `committed`, `media pending` and carry an `AI-inferred` field **all at
once**, and every combination must be representable. One field cannot carry four independent axes
without lying about at least three of them.

Architecture makes honesty *possible*; farmer-facing wording is decided separately and authored by the
founder.

> **F1/F2/F3 are primitives, not a platform rewrite (founder ruling §1).** Build only enough
> foundation to support **D1** correctly. Expand each when another domain proves it necessary.
> Otherwise "foundation" becomes a six-week architecture project of its own — the exact failure mode
> this sequencing exists to avoid.

### F2 — Sync lifecycle (C4)

**One set of semantics**, not one function: `Pending · Transmitting · Committed · Rejected · Conflict ·
Retryable`. Domain mutations and media may use different transport; they must share this lifecycle and
the honesty model.

Must define: retries **with backoff** (there is none today) · stable idempotency keys · duplicate
handling · ordering · acknowledgement · **rejection that reaches the farmer** (ruling Q15) ·
outbox lifetime with **no automatic expiry for valid unsent work** (ruling Q16) · storage-pressure
behaviour (evict cache first, protect unsent work, never silently delete evidence) · auth expiry
during retry · app termination mid-sync.

**The reference implementation already exists:** the log-save honesty layer refuses to claim server
acknowledgement without one. Extend that; do not redesign it.

**Also in F2's scope, found late in Phase A:** the server opens one transaction *per mutation*, not
per batch, so a parent can fail while its children commit. Partial-batch reconciliation belongs here.

### M1's device half — why it is not just a server-side pipeline

Phase A found the largest silent data-loss vector on the phone, and it is not on the server.

Finished AI jobs keep their raw audio and image bytes **forever** — no sweeper, no expiry, no delete
call anywhere. Attachment rows and their cached bytes are never deleted either, even after a
successful upload; the delete function exists and is never called on that path. With no compression,
this fills the browser's storage quota, and **when the quota is exhausted new captures stop
queueing.** The farmer's next recording silently fails to save.

So M1 is two halves, and the device half is the more urgent one:

```text
server half   compression targets · presigned upload · thumbnails · orphan reaping · lifecycle · CDN
device half   delete the local copy once the server acknowledges it — the C5 rule applied to bytes
```

The device half is simply C5's principle applied to media: **once the server has acknowledged it, the
local copy is disposable.** Today it is treated as permanent, which is the sixth category again,
wearing a different costume.

**Retention interacts here.** Ruling Q24 sets voice audio at ~30 days after confirmed transcription,
and that sweeper genuinely works — but what it sweeps is plaintext, because the sealing writer has
zero callers (direction §4.3). Fixing the encryption and fixing the cleanup are the same piece of work.

### F3 — Concurrency primitive (C7)

Resized per founder direction §7. **No CRDTs, no merge engine.** The minimum:

```text
client edits v5 → server has v5 → accept → v6
client edits v5 → server has v6 → do NOT silently overwrite → return conflict state, preserve both intents
```

**Opt-in per entity.** The planning agent determines which entities have genuinely competing edits.
Today zero entities carry a version token, so this is a build, not a fix.

---

## 7. Legacy-data strategy

Directive §14: **never silently rewrite history.** Per legacy class, choose consciously.

| Legacy class | Strategy | Ruling |
|---|---|---|
| Flattened machinery already on the server | **Preserve as legacy.** Do not parse uncertain text into authoritative data | Q3 |
| The duplicate that appears when old flattened rows meet the new structure | Only **one** representation visible to the farmer; preserve the underlying legacy evidence; **never delete uncertain evidence merely to deduplicate** | Q3 |
| Irrigation/input values fabricated on return | **In scope.** Neutralise immediately if the full repair cannot land in the same step. **Unknown must never render as known** | Q9 |
| Local-only harvest, procurement, plot geometry, planned tasks | Migrate **if** the founder confirms each is product truth (§3 rule). Then migrate with provenance marking it as legacy-imported | Q10, direction §5 |
| Pre-Dexie stale copies left behind by both migrations | Remove after the domain that owns them completes its pipeline | — |
| Six dead stores with zero writers | **Delete.** Do not preserve a feature because a table exists | direction §5 |
| Raw voice audio | Finite retention, ~30 days after confirmed transcription, **and it must not be plaintext during that window** | Q24, direction §4.3 |
| The device-local audit table | **Architectural debt, not a domain to reproduce.** Server-side audit for committed trust-sensitive actions instead | direction §4.2 |
| `aiCorrectionEvents` | **RULED 2026-08-15 — split it; do not classify the whole object as one thing.** It carries two different classes of information and they get different lifecycles. **(a) The structured correction signal** — *AI predicted `spraying`, farmer corrected to `pruning`, field, model version, prompt version* — is **durable server-side quality intelligence**. It must survive the device, because otherwise every phone learns independently and the system never improves. Collect only what is necessary. **(b) The raw transcript** is **not** preserved merely because it accompanied the correction. It is sensitive temporary evidence under policy control. Where possible the correction event **references the originating log or AI operation rather than duplicating the transcript.** Ruling in one line: *migrate the correction signal, not the whole current local object blindly.* | direction §5, ruling 2026-08-15 §3 |

---

## 8. Failure-mode strategy

Directive §18: design the failure path alongside the happy path. Phase A confirmed each of these is
currently unhandled.

| Failure | Required behaviour |
|---|---|
| Log saved, image upload failed | Log stays valid; attachment **visibly pending**. Never one invalidating the other |
| Image uploaded, commit failed | Orphan is reaped. Today the storage interface has **no delete method at all** |
| Server committed, acknowledgement lost | Retry does not duplicate. Needs stable keys (Lane A) plus failed-mutation handling |
| App killed mid-flight | Deterministic recovery. Today `uploading` and `processing` are unowned |
| Auth expires with unsent work | Outbox preserved **and the farmer told** — today it freezes silently |
| Two devices, same fact | Neither silently destroys the other (F3) |
| Server unavailable | Cached information stays usable where safe |
| Crash between local write and enqueue | Currently strands the record permanently and invisibly. Needs atomicity or a reconciler |
| Parent mutation fails, children commit | Partial-batch reconciliation (F2) |

---

## 9. Observability

Directive §19. Production must be able to answer: did the farmer act · did it enter the outbox · was
it sent · did the API receive it · did validation fail · was it committed · was media uploaded · what
came back · what was rendered.

Today: the client generates a correlation id and **never sends it**; the server sets one and **never
reads an inbound one**; the 1,921-line push handler contains **no logging at all**; there is no sync
diagnostics endpoint. Without this, a farmer saying "my entry vanished" cannot be answered.

Belongs with F2 — a lifecycle nobody can observe cannot be operated.

---

## 10. Acceptance standard

**Not** success: less localStorage · more endpoints · more columns · green tests.

| # | Scenario | Proven by |
|---|---|---|
| **A** | Records online → commits → storage wiped → login → **same semantic record returns** | Each domain increment, at its own completion |
| **B** | Records offline → app dies → reopens → **intent survives** → server accepts **exactly once** | F2 |
| **C** | Work committed, attachment upload failed → **work valid, attachment visibly pending** | F1 completeness + M1 |
| **D** | Two devices edit the same trust-sensitive fact → **neither silently destroys the other** | F3 |
| **E** | Historical partial data returns **as partial, not reconstructed fiction** | F1 completeness + C3 |
| **F** | Logout, another farmer logs in → **no previous farmer information exposed** | Lane A tasks 1–2, re-proven in X2 |
| **G** | Ten years of history → **operational quickly** without downloading ten years | Bounded hydration, mechanism TBD |

**Scenario A is per-domain, not global.** A domain is not done until A holds for it. That is what makes
each increment independently valuable.

---

## 11. Explicit deferrals

Named rather than silently ignored, per directive §26.J.

| Deferred | Why | Revisit when |
|---|---|---|
| **Live updates between devices** | Founder ruling Q33: not now. Cursor and delta refresh on login and foreground is enough initially | Operational behaviour actually requires push |
| **Per-entity sync cursors as a mandated mechanism** | Direction §4.1: bounded hydration is the requirement; the mechanism is an engineering choice | F1/F2 design picks the simplest compatible option |
| **Weather reader** | Ruling Q4: keep server-side for future intelligence; build no reader until something consumes it. **Document as intentional** so nobody "fixes" it | A screen needs it |
| **Backfill of existing uncompressed photos** | Ruling Q23: measure first. **Requires a live AWS call** — the repo cannot measure it | M1, after measurement |
| **Database deletion on shared handsets** | Code is cheap (the primitive ships in every bundle); the **retention ruling** is missing. Irreversible, so not an agent's call | Founder rules on when and with what warning |
| **A2.1 database adoption** | Blocked on a real-device question: which browsers clear localStorage without clearing IndexedDB. Also must keep first-boot adoption working | Device test answers it |
| **Prod raw-blob bucket** | Config resolves to an undocumented bucket with the intended encryption key unbound. **Separate small production-risk task, read-only first** (ruling Q32) | Now, outside this programme |
| **Server queue pruning** | Ruling Q34: fix but isolate. `sync_mutations` is load-bearing for dedupe and cannot be truncated like `outbox_messages` | Its own small task |

---

## 12. Change surface, by foundation piece

Per-domain surfaces are stated in each domain's own plan. This is the foundation only.

**F1 — DB:** likely additive columns for provenance, version and completeness on existing tables; no
destructive change. **Backend:** contract shapes, DTOs, mapping. **Frontend:** the twin payload types
and reconstruction. **Cross-cutting:** the generated-payload contract gate must cover the hand-written
C# copy, which today it does not.

**F2 — DB:** none expected. **Backend:** logging in the push handler; inbound correlation; partial-batch
reconciliation. **Frontend:** unified lifecycle, backoff, rejection surfacing. **Cross-cutting:**
observability.

**F3 — DB:** a version column on the entities that opt in; migration per entity. **Backend:**
concurrency check and conflict response. **Frontend:** conflict state and preserved intents.
**Cross-cutting:** ADR required — this is an irreversible data-honesty decision.

---

## 13. What happens next

1. **Lane A executes** once the founder approves it. Independent of everything here.
2. **F1 gets an executable plan** through `superpowers:writing-plans` — the contract shape, the
   provenance envelope, the completeness concept, and the "server stated nothing" representation.
   It is the root dependency; nothing else starts without it.
3. **M1 media can start in parallel** at any time; it shares no files with the domain work.
4. **Each subsequent phase is planned as its predecessor lands**, so the plan reflects the repo as it
   actually is rather than as it was imagined.

**ADRs required** before their work begins: legacy machinery handling · fabricated-legacy
reconstruction · rejection semantics · the concurrency primitive. All four are irreversible
data-honesty decisions (ruling Q31).

**Doctrine change pending founder approval:** `P10` — *"No successful business mutation may
permanently exist only on one client device."* Ruling Q30 approved it; the text is not yet drafted
into the doctrine.
