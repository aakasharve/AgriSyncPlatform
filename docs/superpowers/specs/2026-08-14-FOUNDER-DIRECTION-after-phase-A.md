# Founder Direction After Phase A

**Status:** LOCKED. Rulings, not suggestions. Read the ruling; never infer it (`E1`).
**Date:** 2026-08-14 · **Author:** Founder · **Recorded by:** Claude (cofounder mode)
**Branch:** `feat/server-authoritative-architecture`

**Supersedes on conflict:** the triage ordering and two capability claims in
`2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md`. Everything else in that document stands as accepted
ground truth.

---

## 0. Phase A is accepted, with one qualification

> Static evidence is sufficient for **architecture planning**. Any claim that will trigger an
> **urgent production hotfix must first be reproduced at runtime.**

**Discovery is closed.** Do not expand the inventory further unless implementation planning exposes a
specific unknown. We know enough to move from discovery into structured planning.

---

## 1. Fifty findings are one defect class. Plan the cause, not the symptoms.

**Client capture, server persistence, read-back and reconstruction were developed as partially
independent paths.** That single cause produces: data disappearing · data changing meaning · fake
defaults · offline work vanishing · deletions resurrecting · money corrections rejected · duplicate
money events · local-only business truth · stuck media queues · cross-user local leakage.

**Do not create fifty unrelated repair tasks.** Every domain must eventually pass through one
contract:

```text
Capture → Durable intent → Canonical server mutation → Authoritative storage
       → Canonical server read → Faithful reconstruction → Disposable local representation
```

---

## 2. Two lanes

### Lane A — Immediate Trust Containment

Only defects that are **(1) reproducible, (2) currently live, (3) capable of destroying, falsifying or
exposing farmer data.** Not architectural cleanup. **Reproduce before fixing.**

**Revised priority — the founder moved shared-device exposure to the top:**

| Probe | What | Why first |
|---|---|---|
| **A2** | §4.8 shared-device farmer isolation | **Security.** If one farmer can inherit another's local data, this is a security containment issue, not a convenience defect. Ranks above harvest and money. |
| **A1** | §4.1 same-device destruction | Save a log with machinery, expense, manual total, understanding, transcript → sync → pull → compare original vs reconstructed |
| **A3** | Money integrity | cost corrections rejected · income returning as expenditure · duplicate cost on repeated submission |
| **A4** | Offline capture | offline voice result disappears · deletion resurrects · interrupted upload/AI job permanently wedged |

### Lane A constraint — containment must not fight Lane B

A hotfix is acceptable **only** if it directly fits the target architecture, or safely contains the
problem until the target architecture replaces it. **A containment fix must not increase migration
debt.**

Forbidden in Lane A:
- another synchronization mechanism
- another permanent local truth store
- another handwritten domain reconstruction rule
- another inferred default
- another feature-specific offline queue

### Lane B — The architecture programme

Organised around **capabilities**, not the fifty symptoms.

---

## 3. Capability sequence for Lane B

**C1 — Truth contracts.** Per durable domain object: canonical server shape · write contract · read
contract · provenance · timestamps · actor · identity · version where required · completeness.
*The same semantic information that enters must be capable of returning.*

**C2 — Authoritative persistence.** Give durable business information a real server home. Includes
currently-missing server domains **where they are genuinely part of the product**: planned tasks ·
harvest · procurement · relevant farm configuration · plot and farm geometry where required ·
farmer-entered financial facts · durable AI-approved vocabulary if retained as product data.
**Do not preserve a feature merely because a local table exists.** First ask: *is this actually
product truth that deserves server persistence?* Dead or experimental stores may simply disappear.

**C3 — Canonical reconstruction.** Remove the class of code that reconstructs missing truth by
guessing. Unknown remains unknown. Legacy partial remains partial. Derived remains derived.

**C4 — One synchronization architecture.** Not one giant function — **one set of semantics**
governing `Pending · Transmitting · Committed · Rejected · Conflict · Retryable`. Domain mutations and
media may use different transport mechanics but must share the same lifecycle and honesty model.
**Do not create a sixth synchronization path during migration.**

**C5 — Offline intent.** Offline state is *an action waiting for server authority*, never *a second
authoritative database*. Keep offline capture extremely reliable. Once acknowledged, the server
representation is canonical and local state is disposable.

**C6 — Media lifecycle.** `capture → local temporary copy → authorized cloud upload → server metadata
finalization → acknowledgement → local copy eligible for cleanup`. Plan compression · thumbnails ·
presigned/direct uploads · authorization · checksums · retries · crash recovery · orphan cleanup ·
lifecycle policies · deletion · CDN read strategy. **Do not force all media bytes through API memory.**

**C7 — Multi-device concurrency.** In scope, **resized**. No CRDTs, no collaborative merge engine, no
complicated distributed reconciliation. The minimum acceptable model:

```text
Client edits v5 → server has v5 → accept → v6
Client edits v5 → server has v6 → do NOT silently overwrite → return conflict/reconciliation state
```

Introduce version protection **only where competing edits matter**. The planning agent determines
which entities actually need it. Expand only when real workflows prove they require more.

---

## 4. Corrections to the Phase A matrix

### 4.1 Per-entity sync cursors are NOT mandatory doctrine

The matrix listed them as a required capability. **Downgraded.** The founder requirement is only:

> Progressive, bounded synchronization without downloading the entire account.

Acceptable mechanisms include scoped cursors · collection cursors · query pagination · revision
streams · server checkpoints · any other justified mechanism. **Choose the simplest one compatible
with existing infrastructure. Do not turn an implementation idea into doctrine.**

### 4.2 The local audit table is architectural debt, not a server domain to reproduce

The device-local `auditEvents` table is **not itself canonical durable farm truth.** Do not simply
upload it to preserve it.

The correct principle:

> **Committed trust-sensitive actions require a durable server-side audit trail.**

Carrying: who · what · when · farm · actor · previous version · new version · origin/provenance ·
correlation or operation identity.

Local audit data may exist temporarily for diagnostics, pending-operation evidence and
troubleshooting. **Durable audit authority belongs on the server.** Classify the current local table
as debt.

### 4.3 Voice retention — the earlier ruling holds, with a constraint

Confirmed voice audio may be retained ~30 days then removed, unless an explicit evidence, dispute or
legal retention reason requires otherwise.

**But during that window, audio must not remain plaintext merely because the encryption
implementation is currently disconnected.** Distinguish:

```text
confirmed structured record  = durable
confirmed transcript/provenance = per product policy
raw audio                    = temporary evidence
```

**Do not create an indefinite voice archive by accident. Do not make the broken existing archive
behaviour the specification.**

---

## 5. Matrix correction rule — who owns classification

**The founder is not expected to manually validate 33 Dexie stores against implementation details.**
The architecture team owns technical classification. Founder correction is required **only when
classification changes product meaning.**

Product rulings given:

| Question | Ruling |
|---|---|
| Is planned work durable truth? | **Yes** |
| Is harvest durable truth? | **Yes, if it is a live product capability** |
| Is selected farm a device preference? | **Yes** |
| Is raw voice permanent farm history? | **No** |
| Is server audit durable? | **Yes, for trust-sensitive actions** |

Which Dexie table currently holds an object is **engineering evidence, not a founder decision.**
Proceed unless a genuine product-semantics ambiguity appears.

---

## 6. Do not block planning on reproducing all fifty

Runtime reproduction has exactly two purposes:

1. **Hotfix evidence** — any urgent production repair must be reproduced first.
2. **Architectural scenario tests** — the plan must include runtime acceptance tests covering the
   discovered failure classes.

**Do not spend weeks reproducing every dead store and implementation smell before designing.** The
architectural class is already evidenced.

---

## 7. Protect what already works

Do not casually redesign: server-acknowledgement honesty · no invented labour cost · clean auth and
token storage · existing server tenancy boundaries · the working voice retention sweeper · crash
recovery on the paths where it exists · the structured labour round trip.

**Use them as reference implementations.** Especially the principle behind *मी लिहून घेतलं*:

> The product should communicate what it actually knows, not what it hopes happened.

---

## 8. Three concepts currently being mixed, which the architecture must separate

| Concept | Question it answers |
|---|---|
| **Business truth** | What happened on the farm |
| **Synchronization truth** | Whether the server has accepted it |
| **Processing truth** | Whether AI, media or background processing has completed |

This is a valid state and must be representable:

```text
Farm work captured       = YES
Server committed         = YES
Photo uploaded           = NO
AI extraction completed  = NO
```

**One incomplete subsystem must not invalidate everything else.**

---

## 9. Programme shape

```text
PHASE 0   Runtime confirmation of highest-harm defects
             ↓
SMALL CONTAINMENT PLAN — only confirmed live trust failures
             ↓
PHASE 1   Canonical domain contracts
PHASE 2   Server durable storage + read-back
PHASE 3   Faithful client reconstruction
PHASE 4   Unified offline/sync lifecycle
PHASE 5   Media cloud-authority pipeline
PHASE 6   Concurrency + multi-device correctness
PHASE 7   Legacy migration / cleanup
PHASE 8   Destructive-device + rural failure testing
```

**Exact code ordering comes from dependency analysis, not from this conceptual list.**

---

## 10. Acceptance standard

**Not** success: localStorage usage decreased · more endpoints exist · more fields reach PostgreSQL ·
tests are green.

**Success** is these seven scenarios working:

| # | Scenario |
|---|---|
| **A** | Records online → server commits → device storage wiped → login → **same semantic record returns** |
| **B** | Records offline → app dies → reopens → **intent survives** → reconnects → server accepts **exactly once** |
| **C** | Server accepted work but attachment upload failed → **work remains valid, attachment visibly pending** |
| **D** | Two authorized devices modify the same trust-sensitive fact → **neither silently destroys the other** |
| **E** | Historical partial data returns **as partial, not reconstructed fiction** |
| **F** | Farmer logs out, another logs in on the same handset → **no previous farmer information exposed** |
| **G** | Ten years of server history → app **operational quickly** without downloading ten years |

---

## 11. What the agent returns next

Three things, and **not another giant discovery report**:

1. **Runtime reproduction of the small number of highest-harm claims** (A2 first, then A1, A3, A4).
2. **A tightly bounded containment plan** for confirmed live trust and security failures.
3. **The full server-authoritative architecture plan**, based on the Data Ownership Matrix.

> The goal is not to make every existing local mechanism work better. The goal is to reach the point
> where **local mechanisms are temporary and replaceable, while farm truth, provenance, security and
> history remain intact independently of the device.**
