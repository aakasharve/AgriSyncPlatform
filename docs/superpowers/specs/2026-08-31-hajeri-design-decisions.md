# हजेरी — Founder Design Decisions

**Status:** BINDING on the attendance build. Recorded 2026-08-31 from the founder's choices across
three review artifacts. Nothing here is built yet — attendance has no table, no save path and no
sync mutation.

**Why this document exists.** These decisions were made one at a time, in chat, against interactive
mockups. They are the requirements for the attendance data model, and several of them constrain the
schema rather than the screen. Losing them would mean rebuilding the table.

---

## D-H1 — The roster groups by मुकादम

**Chosen: crew rows that open on tap.** 80 workers become 6 rows; tapping a crew reveals its people.

Rejected: a flat list (≈14 phone-screens, ordered by join date, which means nothing to a farmer);
search-first (a soft keyboard is the hardest control on the screen for a low-literacy user).

**Why it matters beyond layout:** the farmer thinks *"रोकडेची टीम"*, not "worker #47". Crew is the
unit he reasons in, so it should be the unit the app presents.

---

## D-H2 — The register separates by मुकादम, weekly and monthly

**Chosen: crew-separated blocks, day headings and the name column both pinned. Both a week view and
a month view.**

**Verified by mockup at 390px:** at 80 names without pinning, the day headings scroll away by row 12
— a farmer is then reading marks with no idea which column is which day. Pinning is the minimum that
makes 80 names honest.

**A month is ~4 screens wide and always will be.** It works with horizontal scrolling, but this is
the strongest argument that the month's natural home is the PDF and the phone's is the week.

**Implication:** one crew is the natural unit of a PDF page.

---

## D-H3 🔴 — The cell splits: day on top, night below

**Chosen: option (c). Each cell is two independently-markable halves.**

Rejected: a corner badge (crowds at 26px, and two badges collide); a colour for night (**cannot
express day AND night in one cell** — the decisive failure); numbers instead of ticks (trades away
the tick, the most familiar thing about a paper register).

### 🔴 THIS IS A SCHEMA DECISION, NOT A VISUAL ONE

The current shape — one `PresenceStatus` per person per day — **cannot hold this**. The model must be:

| Per person, per farm-day | Values |
|---|---|
| **Day mark** | full · half · absent · **unmarked** |
| **Night mark** | worked · not worked · **unmarked** |

- A day's value is therefore **0, 0.5, 1, 1.5 or 2** — the grid can no longer count to 1.
- **Row totals and column totals must both carry it.** A day+night Thursday makes a week `६.५`,
  not `५.५`, and Thursday's column total must say so.
- **`unmarked` is a fourth state, not a synonym for absent.** On paper they look alike; on screen and
  in the data they must not. Nobody marking a night is not the same as a night not worked, and the
  app may never assert the second from the first (`P4`).

Anyone designing `attendance_marks` must start from this table, not from present/half/absent.

---

## D-H4 — The same worker under two मुकादम

**Chosen: point at it, ask once, never decide.**

रमेश works Monday under रोकडे and Thursday under धनाजी. Three behaviours are possible and only one
is honest:

- ❌ **Auto-merge** — रमेश जाधव in two crews may be **two different men**. Merging pays one and
  erases the other. The app would have decided something nobody told it.
- ❌ **Silently keep apart** — if it *is* one man he is owed one total and the farmer is looking at
  two halves, with nothing suggesting he check.
- ✅ **Flag it and ask once.** Both entries stand. The worker carries a mark — `२ टीममध्ये` — and
  tapping it asks `हाच रमेश आहे का?`. Answered once, remembered. Where a mobile number exists the
  app already knows and never asks.

### 🔴 AND THE CREW TOTALS NEVER CHANGE (`P7`)

रोकडे said **१२**. धनाजी said **८**. If रमेश is one man the farm had **१९ people** — but रोकडे still
said 12 and धनाजी still said 8.

**The app must never rewrite what a मुकादम reported to make its own arithmetic tidy.** It shows both,
labelled: *what each man said* (२०) and *how many people that is* (१९), with a line explaining the
difference. Both true, neither invented. This is `P7` — attribution never changes reported quantity —
applied to the crew-overlap case.

---

## D-H5 — The end goal is a downloadable record

From [[attendance-endgoal-is-a-downloadable-record]]:

> reality == what the UI shows == what the PDF contains

Three equalities, not approximations. Every truth rule extends to the PDF: an unknown prints an
em-dash there too, never a zero. **Export must shape the table from the first migration** — a record
that cannot be reproduced exactly cannot be exported honestly.

The app **never settles**; it provides the UI for a human to mark something **settled** and
**verified**. Those are claims *by a person* and need an actor, a timestamp and a correction path.

---

## D-H6 🔴 — The register IS the wage book

**Asked:** on the farms he knows, is the हजेरी book the same book as the payment record, or two
different books? **Answered: the same book.**

**Consequence, which is larger than the layout:** the PDF is a **proof of payment**, not a proof of
attendance. That is a different document with different weight — and a different audience.

## D-H7 — Money appears only where the day was unusual

**Chosen: layout 3.** Normal days show only the attendance marks. A day paid differently from the
standard rate shows its amount. **Every row ends in the week's money, and so does the bottom line.**

Rejected: an amount in *every* cell — it renders at **8.5px**, smaller than anything else in the app,
on the screen a man reads in sunlight to check his own pay. Verified by mockup, not asserted.
Rejected: money only at the row end — loses which day the difference happened.

**Why this shape works:** the grid stays readable, the exceptions are the thing that jumps out (which
is what a farmer actually scans for), and the wage-book requirement is met by the totals.

## D-H8 🔴 — Same book, different pages

**This is a consequence of D-H6 and was NOT obvious when it was chosen.** It collides with an
architectural constraint already recorded in this repo
(`2026-08-30-evidence-vs-derived-truth-boundary.md`):

> "Ramesh confirming his Plot A work must not see Santosh's wage, Plot B, or unrelated workers."

**An attendance register is safe to show anyone on the farm. A wage book is not.** The moment money
enters the grid, showing the हजेरी वही to a मुकादम shows him what every man in his crew earns.

**The resolution — one register, three views:**

| Viewer | Sees |
|---|---|
| **Owner** | the whole book — every name, every day, every rupee. His record, his PDF. |
| **मुकादम** | his crew's attendance. **Money: OPEN — see below.** |
| **Worker** | his own row only — his days and his money, nobody else's. |

**The PDF follows whoever asked for it.** A worker's copy is his own row; the owner's copy is the
whole book. This is not an extra feature bolted on — it is what makes D-H6 safe, and it must be in
the read path from the first migration, not added later.

## D-H9 🔴 — The मुकादम sees money **one worker at a time**, never as a roster

**Settled from the Worker-Side Confirmation design**, not from a preference. The founder shared that
document and asked whether it resolved the open question. It does, and it produced a better answer
than either option originally offered.

**The forcing constraint:** 30–50% of farm workers have no usable phone, so that design includes
**proxy confirmation** — the worker confirms verbally and the मुकादम records it, stamped as weaker.
A मुकादम cannot ask *"₹400, correct?"* on a man's behalf without seeing ₹400. **Proxy confirmation is
impossible if he cannot see money.**

But that does not require a wage roster. The distinction matters:

| | What it permits |
|---|---|
| ❌ **Browsable crew wage list** | He can study what every man in his crew earns, at any time, unprompted. |
| ✅ **Per-confirmation view** | He sees one amount, for one man, at the moment he confirms on that man's behalf — and the system logs that he saw it. |

**Chosen: per-confirmation.** Proxy confirmation works; the peer-wage leak does not happen; and each
disclosure is an auditable event rather than ambient access. This satisfies the
evidence-vs-derived-truth constraint without breaking the confirmation design.

---

## 🔴 D-H10 — CONFIRMATION IS A FOURTH AXIS, AND THE CHOSEN CELL CANNOT CARRY IT

**This is the real collision, and it is not the one that was expected.** Worker confirmation does not
collide with the labour branch (that is gated). It collides with **D-H3, the split cell chosen two
decisions earlier.**

That cell already answers three questions:

1. **How much** — full / half / absent / unmarked
2. **When** — day / night
3. **Money** — shown on days that differ from the standard rate (D-H7)

Worker confirmation adds a fourth: **confirmed · disputed · proxy-confirmed · awaiting**.

Four axes in a 26-pixel square. The split cell cannot hold it, and confirmation state is not
decoration — **a disputed day is the single most important thing on the register.**

**Proposed resolution, not yet founder-approved:**

> **Confirmation lives on the ROW, not the cell.** A worker's row shows how much of his week is
> confirmed. **Disputed days are the one exception** — loud enough to earn a cell-level marker,
> because a dispute is precisely what the owner must not scroll past.

Rationale: the worker's real question is *"is my total right"*, not *"was Tuesday right"* — the same
reasoning the confirmation design uses to justify weekly batching over daily messages. Confirmation
is therefore naturally a **row-level** property with one cell-level exception.

**Do not design the attendance cell without resolving this.** Adding a fourth axis after the grid
ships means rebuilding it.

---

## 🔴 Two escalations raised by the confirmation design — NOT yet decided

**E1 — "The worker must be able to see his own history, independent of any farm's permission."**

This is materially larger than D-H8. D-H8 settled that *a worker sees his own row* — inside the
owner's app, under the owner's account. The confirmation design requires his record to live somewhere
**the owner cannot gate**. Its own words: *"If his record lives only inside the owner's app, this is
employer-controlled reputation, not worker dignity."*

Those are two different architectures. The second is a product, not a permission rule. **D-H8 is not
sufficient to satisfy it.**

**E2 — "The owner must not be able to silently change a confirmed event."**

Corrections are expected and fine; silent ones are not. Original fact → who changed it → when → why,
all preserved.

**This is urgent given what the 2026-08-30 audit found.** A green tick shown over an operation that
never happened was a real, live defect fixed that day — and that was a *single*-signed record. A
confirmed record that can be quietly edited manufactures false confidence **with a second person's
name attached to it**, which is strictly worse.

---

## A measurement principle worth adopting verbatim

> **"A zero-dispute farm is not an honest farm, it is a silent one."**

The same instinct as every truth rule in this release: an **absence** being read as a positive fact.
A dispute rate of zero is a warning, not a success — it means fear, or fabricated confirmation.

Build the metric that way from the start. It is very hard to add scepticism to a number after people
have already learned to trust it.

---

## Sequencing — why attendance cannot start today

1. `feat/labour-v2-r1` is **unmerged** and founder-gated.
2. Stage A0 (shared-farm foundation) is running in another session with an isolation guard that
   forbids touching any file Labour V2 modifies — **123 files**, including much of the labour surface.
3. Attendance persistence would touch exactly those files.

**So the order is: Labour V2 merges → Stage A0 lands → attendance builds.** Starting attendance now
would either break Stage A0's isolation guard or create the merge conflict both efforts exist to
prevent.

---

## Reference artifacts

The decisions above were made against interactive mockups at 390px, not descriptions:

- Roster at 80 workers, four treatments
- The register at 4 vs 80 names, week and month
- Crew grouping, the duplicate case, and the two-totals display
- Night shift and extra pay in one cell, four treatments

---

## What is still true, and constrains all of the above

There is **no attendance persistence**: no table, no save path, no sync mutation. The capture screen
carries seven known false claims and is hidden from real users (visible in dev preview only). The
हजेरी वही itself was reviewed and found **honest** — it has no false claims, it simply has no data.

So attendance is two builds, not one:

1. **Give the honest ledger a real source.** The screen works; it needs marks to read.
2. **Rebuild the capture screen** so each of its seven promises becomes true, or goes away.

---

## Cross-check against founder rulings R1–R6 (Stage A design doc, 2026-08-30)

Performed 2026-08-31 after the Stage A0 session shared
`2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md`. **Three decisions above are not new — they were
already mandated.** Recorded so nobody re-litigates them as open design choices.

| Ruling | Text | Bearing on हजेरी |
|---|---|---|
| **R4** | *"Partial identification is normal. Preserve total quantity + known identities + unresolved remainder; **no fabricated identities, no name merges**."* | **D-H4 is this ruling, verbatim.** The never-auto-merge rule and the two-totals display (मुकादमांनी सांगितलेले २० / वेगवेगळी माणसं १९) were presented above as a proposal. They were already decided. |
| **R6** | *"Do not manufacture operations for database convenience, and **do not combine access scopes for domain convenience**."* | **D-H8 is required by R6, not suggested by me.** Once the register carries wages (D-H6), showing one book to owner, मुकादम and worker alike is exactly "combining access scopes for convenience". |
| **R2** | *"Its facts may be stored at the **smallest truthful access scope**, provably joined by one capture identity."* | Direct justification for **D-H9** — money visible per-confirmation, never as a browsable crew roster. |
| **R3** | *"D9.11 superseded — **Layer C back IN**. Mandatory pre-pilot; implementation deferred to Stage B. **Do not reopen whether, only how**."* | 🔴 **Changes the status of D-H10.** See below. |
| **R5** | *"Fresh branch per stage; verify V2 genuinely live before A1, else STOP."* | Sequencing. Note the correction below. |
| **R1** | Resequencing approved; Stage A0 proceeds now. | See sequencing correction below. |

### 🔴 R3 makes D-H10 non-deferrable

D-H10 recorded the fourth-axis problem — confirmation state cannot fit the split cell alongside
amount, day/night and how-much — and proposed a row-level resolution **pending founder approval**.

**R3 removes the option of deferring it.** Worker-to-work attribution (Layer C) is *mandatory
pre-pilot*, and the ruling forbids reopening *whether*. So confirmation state is not a later feature
the grid might one day carry: **it is a requirement the grid must be designed for from the first
migration.** A cell designed for three axes and extended to four later means rebuilding the register
and re-exporting every PDF produced before the change.

**Action:** resolve D-H10's row-vs-cell question *before* the attendance table is designed, not after.

### Sequencing correction (from the Stage A0 session, verified)

An earlier version of this document said Stage A0 waits on the Labour V2 acceptance gate. **That was
wrong.** A0 is independent by construction — branched from `a7784b18`, touching no labour file. It
can complete Tasks 2–9 and sit ready to merge regardless.

**The gate blocks attendance and Stage A1 — not A0.** R5 states the real dependency: *verify V2 is
genuinely live before A1, else STOP.*
