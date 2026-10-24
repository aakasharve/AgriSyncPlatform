# Architectural Constraint — Source Evidence vs Derived Truth

**Status:** BINDING on Stage A1 and Stage B. Recorded 2026-08-31, Stage A0 Task 8.
**Origin:** Founder rulings R2 / R6 (`docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md`) + IDEA 4 §4.6.
**Spec:** `2026-08-30-shared-farm-foundation-stage-a0`

---

## The rule

> **Derived structured facts may be shared at a narrower scope than the source evidence that
> produced them.**

## Why it exists

A farmer says once:

> *"Plot A la XYZ 5 litre takla ani Plot B la 8 litre takla. Plot A madhe disease jasta aahe."*

An agronomist scoped to Plot B may safely receive the derived fact
`Plot B / XYZ / 8 litres / sprayed today`. He must **not** automatically receive the original
recording, because it also describes Plot A — including a disease observation the farmer may have
no wish to share outside his own team.

The same applies to worker confirmation (IDEA 4): Ramesh confirming his own Plot A work must not
see Santosh's wage, Plot B, or unrelated workers.

## What this forbids

- Attaching source evidence **only** to a record whose scope is wider than the evidence's safe
  audience.
- Any design where showing a plot-scoped fact **requires** dereferencing the capture it came from.
- Collapsing *"who may see the fact"* and *"who may see the evidence"* into one permission.

## What it does not require

No policy engine, no redaction pipeline, no evidence-visibility UI. **Stage A0 builds none of that.**
This document exists so that Stage A1 does not make it impossible.

## How to satisfy it

Structured facts must be addressable and readable **without** dereferencing the source capture. The
capture stays linked for provenance; that link must be traversable **by permission**, not by
construction.

---

## Current state — verified 2026-08-31 at `a7784b18`

| Fact | Evidence |
|---|---|
| The evidence pointer is `DailyLog.EvidenceSourcesJson` | `ShramSafal.Domain/Logs/DailyLog.cs:101` |
| It maps to a `jsonb` column `evidence_sources` | `Persistence/Configurations/DailyLogConfiguration.cs:139` |
| Its shape today is `[{type:'voice', voice_capture_id: …}]` | `DailyLog.cs:96` (comment) |
| A `MultiPlot` log is ONE row carrying `plot_ids >= 2` | `DailyLog.cs:284` (`cardinality(plot_ids) >= 2`) |
| Derived operations for a MultiPlot log get **no plot at all** | `LedgerDerivationService.cs:487` returns `null` |

⚠️ **There is no identifier `EvidenceRefs` anywhere in this repository.** An earlier revision of the
Stage A0 plan asserted one. Verified 2026-08-31: `grep -rn "EvidenceRefs" --include="*.cs" src/`
returns zero hits. Recorded because a document about truthfulness must not itself contain an
invented name.

## The consequence, stated plainly

`EvidenceSourcesJson` hangs off the **DailyLog row**. For a `MultiPlot` log — one row covering two
or more plots — there is today **no way to expose one plot's fact without exposing the row the
evidence is attached to.**

> **This constraint is currently UNSATISFIABLE for multi-plot logs. Stage A1 is what makes it
> satisfiable.**

That is not a defect introduced by Stage A0; it is the pre-existing shape Stage A1 was scoped to
correct, under founder ruling R2:

> *One real-world operation may produce multiple independently plot-addressable execution facts,
> while all of those facts remain provably connected to the same original operation/capture.*

## Test for a future design

Before Stage A1's model is accepted, it must answer this concretely:

1. Can a reader with access to Plot B alone obtain `Plot B / XYZ / 8 litres` **without** reading any
   row or column that also describes Plot A?
2. Is the link back to the source capture still present for someone entitled to it?
3. Does answering (1) require a redaction step at read time? **If yes, the model has failed** — the
   scope belongs in the storage grain, not in a filter applied afterwards.

Redaction-at-read is the failure mode this constraint exists to prevent: it is where privacy leaks
come from, because every new reader is one forgotten filter away from seeing everything.
