# LOCKED DECISIONS — Labour V2: attendance, ledger, money

**Locked by the founder: 2026-08-28.** Supplements, does not replace,
`2026-07-19-LOCKED-DECISIONS.md`. Binding for the build — any agent that wants to deviate
must **escalate, not decide** (doctrine `E1`: read the ruling, never infer it).

**Scope ruling:** *"I want it fully functional on this version. We can only keep aside the
विश्वास (trust score) part, but all other must go live."* So of the seven surfaces hidden
under Decision 4b, **five ship** (हजेरी घ्या capture, हजेरी वही ledger, the weekly ledger
button, money actions उचल/सेटल/पैसे द्या, the उचल stat) and **two are deferred**
(विश्वास trust score, trust graduation).

**Offline ruling:** attendance capture **must work offline**. Founder chose this knowingly
over the smaller online-only scope.

---

## D1 — Money semantics

| # | Question | Founder's ruling |
|---|---|---|
| 1a | Who receives an उचल (advance)? | **BOTH** — a mukadam (who then distributes) *and* an individual worker directly. The model must support either payee. |
| 1b | When is सेटल (settlement) done? | **Usually weekly, but the farm owner decides.** The app must offer easy options to choose the settlement period — not hardcode weekly. |
| 1c | What does पैसे द्या (pay) do? | **"Nothing but to add those money entries to the ledger."** It RECORDS money already handed over. It does not trigger, initiate or promise a payment. |

**Consequences to honour**
- Payee is polymorphic (mukadam *or* worker). Do not model advances as worker-only.
- Settlement period is **farm-level configuration**, defaulting to weekly. It is a *choice*,
  so the chosen value is a stated fact — record it, never assume it silently (`P8`).
- `पैसे द्या` is a ledger entry, not a payment instruction. No integration, no payment rail,
  no "pending payment" state. Recording ≠ paying.
- Decision 3a (2026-07-19) still binds: **दिलं = ALL labour money paid out**, show `—`
  rather than an invented total when none was spoken (`P4`).

## D2 — Who may mark attendance

> *"If owner allowed, then mukadam allowed to mark attendance. And owner can decide anyone if
> there is any such situation, for that day or for that week, even when mukadam is absent."*

- The **farm owner** holds the permission and **grants** it.
- A **mukadam** may mark attendance **only when the owner has allowed it** — it is not
  implicit in the mukadam role.
- The owner may delegate to **any person**, **time-bounded**: for **that day** or **that week**.
- Explicitly covers the mukadam-absent case.

**Consequences to honour**
- This is a real **authorization grant**, not a role check: it needs subject, scope
  (day | week), validity window, and granting owner — recorded, auditable, revocable.
- An expired grant must **refuse and say so**, never silently accept and drop.
- Approval-before-it-counts was **not** ruled on here. Do **not** infer one. Escalate if the
  design needs it.

## D3 — Distinguishing workers who share a name

> *"Name, surname and mobile number, along with who brought him also."*

Identity is the composite: **given name + surname + mobile number + who brought him**
(the introducing mukadam / referrer).

**Consequences to honour**
- This **repeals find-or-create on normalised given name per farm**. The
  `WorkerNameProjector` same-name merge (two real people named रमेश collapsing into one
  record) is the exact defect this ruling exists to close, and Decision 5b already required
  it fixed before names ship. Money makes it unacceptable.
- ⚠️ **Mobile number MUST NOT be mandatory.** Many workers have no phone, and OTP/SMS is
  still a dev stub in production. Requiring it would reject a real worker, violating `P9`
  (no optional field may reject a farmer's record). It is a *strong discriminator when
  present*, never a gate.
- "Who brought him" is a real relationship (worker → introducing mukadam), not a text note.

## D4 — What a half-day is worth

> *"Half the salary that had been decided."*

`अर्धा` = **exactly half of the agreed wage** for that worker/engagement.

**Consequences to honour**
- Deterministic. No per-job override, no rounding policy invented by the system.
- ⚠️ **This requires the agreed wage to be a recorded fact.** If no wage was agreed or
  captured, the system must show `—`, not a computed half of an assumed number. Half of a
  fabricated wage is still a fabricated number (`P4`), and `P8` requires recording whether
  the wage was *stated* or *assumed* alongside the value.

## D5 — Release sequencing

> *"5b — after I check the UI."*

**Two releases, in order:**
1. **Release 1** — attendance capture (offline) + हजेरी वही ledger + weekly ledger button.
2. **Release 2** — money actions (उचल / सेटल / पैसे द्या) + the उचल stat.

**Gate between them:** the founder reviews the UI. Release 2 does not start shipping until
he has checked Release 1 on screen. This is a **Founder Acceptance Gate**, not a status
update — code-complete ≠ approved.

---

## D6 — The उचल lifecycle (founder's own words, 2026-08-28)

> *"उचल is something that is being paid earlier. Let's say on 1 June I gave 3000 rupees — it
> should be recorded as उचल. But if from that day till 10 June that उचल converts into my bill
> or payable to that person, then if I tap सेटल it will get settled. What I have to do from
> June 1 is mark his attendance, or say his name that he was present. That's it."*

**The model, stated as a rule:**
1. An **उचल** is money handed over **ahead of settlement**. It is recorded once, dated, against
   a named payee (a worker **or** a mukadam — ruling `D1a`).
2. Each day of **recorded presence accrues earnings** for that person, at the agreed wage
   (`अर्धा` = exactly half — ruling `D4`).
3. Accrued earnings **draw the advance down**. The outstanding balance is
   `advance − earnings accrued − payments recorded`.
4. **सेटल** squares the balance at a moment the owner chooses (period is owner-configurable,
   usually weekly — ruling `D1b`).
5. **The farmer's only daily obligation is to say who was present.** Everything else is derived
   from that plus the recorded advance.

**Why this makes the current production display a defect, not a semantic.** The dashboard today
renders **जास्त दिलं** (overpaid) at the farmer's *entire* labour spend. It computes
`paid − recorded-work`, where recorded work can only come from job cards — and production has
**zero job cards** (measured 2026-08-28), so the baseline is structurally `₹0`. Every rupee ever
paid is therefore labelled an outstanding advance, including wages paid for work already
completed. Under `D6` an advance is money given **ahead** of settlement, so this is a
**fabricated figure** (`P4`), not a true statement of what is owed.

**RULING therefore: `उचल` is an EXPLICITLY RECORDED fact, never a figure inferred by subtracting
from an empty baseline.** Until advances are recorded and attendance drives accrual (Release 2),
the honest display is `—`.

**Consequences to honour**
- Advance, accrual and settlement are three distinct recorded events, not one derived number.
- Accrual needs the **agreed wage** as a recorded fact; absent it, show `—` (`P4`, `D4`).
- The running balance must be **reconstructable server-side without the originating device**
  (`P10`), so it cannot be computed only on the phone.
- `पैसे द्या` remains a ledger entry (`D1c`) — a recorded payment, distinct from both an advance
  and an accrual.

## D7 — A mukadam's attendance mark counts immediately

Founder, asked whether a mukadam's mark needs owner approval first: **"yes it's the right
direction"** — confirming *counts immediately, owner corrects afterwards*.

Consistent with `P2` (fast entry, forgiving correction). The existing तपासा review flow is a
**correction** surface, **not** a gate that attendance waits behind. Do not introduce an
approval step; that would be inferring a ruling the founder did not make.

## D8 — Attendance grain: OPEN, being decided from real scenarios

Founder: *"farm day must be considered as we are already recording the work, it will get
assigned — or just go deeper for this question by imagining the real life scenarios rather than
keeping in mind making it hard to record the truth or reality just for the sake of our technical
convenience."*

His lean is **farm-day**. His instruction is explicit and binding on whoever decides:
**do not choose the grain for technical convenience.** If reality needs the harder model, the
harder model is correct and must be costed honestly. Decision pending a scenario-driven
analysis; this file will be patched with the ruling.

---

## D9 — FINAL MODEL (founder, 2026-08-28). Supersedes D8's open question.

> **A Work Log proves that work happened. Attendance proves who was present. Most attendance
> starts from work, but labour presence remains valid even when work could not happen.
> Never force a false Work Log merely to explain a true attendance event.**

### The four situations the product must understand

| # | Situation | Shape |
|---|---|---|
| 1 | Work happened, labour participated | Work Log → HOW MANY · Attendance → WHO |
| 2 | Owner did the work himself | Work Log exists; **no forced labour attendance** |
| 3 | Labour came, no work happened | **Attendance exists independently**; reason recorded; **no fake Work Log** |
| 4 | Mukadam + crew | Mukadam = his OWN person-level attendance · crew = separate aggregate · marking actor = separate provenance fact |

### D9.1 Attendance is anchored to Work Logs but must not DEPEND on one
Legitimate no-work days: rain before start, machinery failure, missing input/material, no
water or electricity, field inaccessible, workers retained but work never began. Creating a
fake "Rain work" Work Log to give attendance a parent is forbidden. **"No work" is not
"absent", and no completed work is not no attendance.** Unknown is not zero.

### D9.2 Attendance is a COMPOSITION RESOLVER, not a blank register
The Work Log owns the participation count for its own work/plot; attendance explains what that
count consisted of: known people · mukadam as an individual · mukadam's accompanying crew
(aggregate) · direct unnamed labour · unresolved remainder. Partial resolution is valid and
must never be shown as an error. **Naming must never alter counting.**

### D9.3 The mukadam is a PERSON, not a label on a crew
`Shankar + 8` must be capable of meaning **Shankar himself present, plus eight accompanying
workers** — not eight people with Shankar hidden inside the count. Three facts stay distinct:
mukadam identity · workers he brought · the actor who marked the record. They may be the same
human and are never the same fact.

### D9.4 WHO MARKED is not WHO WAS PRESENT
Shankar marking attendance remotely at 21:00 does not prove he attended. Only explicit
attendance evidence makes him present.

### D9.5 Crew-count semantics must be explicit, never assumed
`शंकर आठ जण घेऊन आला` normally means Shankar **+ 8 others**. `शंकरकडचे एकूण आठ जण होते` may mean
**8 in total**. **Do not resolve this linguistic ambiguity by undocumented assumption** — carry
`sourceText` + `systemInterpretation` and let confirmation settle it. (Both fields already exist
in the parser output — verified in production.)

### D9.6 Ask only for the smallest missing truth
- count known → *"या 12 जणांमध्ये कोण होते?"*
- count unknown → *"आज किती जण होते आणि कोण कोण होते?"*
- no work, labour present → *"आज कोण आले होते आणि काम का झालं नाही?"*
- draft already complete → show it and offer **बरोबर** / **बदल करा** only.

### D9.7 Two parsers, one recorder
The **generic Work Log parser** stays unrestricted and extracts labour only opportunistically —
labour-extraction failure must NEVER block a Work Log. The **attendance parser** is contextual,
receiving farm, date, work log, plot, known count, existing draft and known workers. Different
semantic contract; **do not build a second recording stack.**

### D9.8 Three epistemic states — and no prediction in R1
**Confirmed** (human approved) · **Voice Draft** (extracted from what was actually said, awaiting
confirmation) · **Unknown** (`—`, never zero, never auto-absent). **No historical inference in
Release 1** — no "he was here yesterday so probably today". Explicit information → structured
draft → human confirmation.

### D9.9 Attendance records evidence, never money
`full / half / explicit hours` are attendance facts. The no-work day proves why: whether those
present get full wage, half, a waiting charge, or nothing is a **commercial agreement** question
for Release 2. **This further supersedes D4** — half-day is 0.5 day of evidence, not half a wage.

### D9.10 Implementation order (founder-set)
1. **Fix the false financial zero** — Unknown → `—`; never compute overpayment from unknown earnings.
2. **Trace and repair labour PERSISTENCE** — production shows structured AI labour extraction
   already works (**11 of 23 results carry a populated `labour` array with a `count`**) but only
   **1** durable `labour_assignment` row exists. Find the smallest correct seam before building
   any parallel infrastructure.
3. Minimal farm-day attendance · 4. Contextual attendance mic · 5. Minimum durable worker
   identity · 6. Correction UI in the existing visual language · 7. Cross-work bridge
   (exception-only) · 8. Weekly ledger, designed backwards from the settlement conversation.

### D9.11 Release 1 excludes
Wage calculation · payroll · advance settlement · permanent crew identities · detailed
worker-to-job attribution (**Layer C is CUT**) · reputation · marketplace · historical attendance
prediction · speculative AI inference.

### D9.12 The bridge is an exception resolver, never a routine screen
Normal flow is Work Log → attendance mic → confirm → done. The bridge appears ONLY when known
identities create genuine day-level ambiguity (the same known worker across two logs). Anonymous
crews must **never** be deduplicated across plots: `Shankar + 8` on Plot A and `Shankar + 4` on
Plot B does not license any claim about unique people. Shankar himself reconciles once; his
unnamed workers do not. If settlement later needs that number, ask for it then.

---

## D10 — Backward compatibility is NOT a constraint (founder, 2026-08-28)

> *"No APK is currently in farmers' hands. We have full freedom to cleanly restructure contracts and
> internal shapes before pilot release. Do not preserve a bad contract merely for hypothetical
> backward compatibility."*

**This supersedes `P11` for the pre-pilot window.** If the cleanest solution requires changing
nullable semantics, attendance DTOs, integer→decimal totals, the required `PresenceStatus`
tri-state, read models, API contracts, internal labour shapes or obsolete frontend assumptions —
**prefer the clean model**. Do **not** add compatibility adapters, duplicate DTOs or transitional
plumbing unless another **active consumer in the repo** needs them.

**The brake, in his words:** *"Do not restructure merely because we have freedom. Every structural
change must remove a proven contradiction, simplify the model, or strengthen truth."*

⚠️ **Honesty note.** An APK *is* published (v1.0.9 / versionCode 17, 28,917,579 bytes, live at
`shramsafal.in/download`). The ruling is that no **farmer** depends on it — not that it does not
exist. Before breaking any contract, check whether it would strand data already written by that
build: a device Dexie database (forward-only at **v24**, no `VersionError` recovery path) or an
unsynced mutation queue. One real device (`db658ce1`) had 4 rejected mutations on 2026-08-27.

**Consequence for the three-segment rejection-code trick:** it exists *only* because fielded
clients already treat `CONFLICT` as permanent. Under D10 that constraint is lifted, so explicit
codes plus an updated client become an option — but this is a change that must pass the brake.

## D11 — Reuse Disturbance for the no-work day, if the domain supports it

The repo already contains a disturbance concept covering **exactly** the founder's no-work causes,
shipped 2026-06-29/30:

- `DisturbanceCause { Machinery, Electricity, Weather, WaterSource, Pest, Disease, LabourShortage, MaterialShortage, Other }`
- `DisturbanceScope { FullDay, Partial, Delayed }`
- plus `Reason` (farmer's words, preserved), `Severity`, `BlockedSegmentsJson`, `WeatherEventId`,
  `AffectedScope { event | bucket | whole_day }`, `Impact`, `ResolvedStatus`
- prompt module `AI/Prompts/inner/disturbance.v1.md` — *"an inner modifier, not a ninth visible
  bucket"* — with positive examples *"Paus mule spray thambavla" ⇒ weather* and
  *"Labour aala nahi" ⇒ labour_shortage*

**RULING: do NOT introduce another attendance-specific reason taxonomy** unless repo truth proves
Disturbance genuinely cannot serve. The two remain **separate truths**: attendance says WHO was
present; disturbance says WHAT blocked the day. Never collapse one into the other.

### The open structural question — delegated to the repo-aware agent, not the founder

`DisturbanceEvent` carries *"a plain `DailyLogId` FK, no farm_id, no Provenance, no version chain"*
— it **requires a daily log**. So the answer turns on what `DailyLog` MEANS:

- **If it is "the factual record of this farm day"** → a log recording *no completed activity,
  disturbance = Weather, scope = FullDay* is **honest**, not a fake Work Log. Reuse the existing
  architecture; build no parallel reason system.
- **If it means "completed/performed farm work"** → an empty log created only to satisfy a foreign
  key would **distort the domain**, and the smallest repo-consistent restructuring is required.

Founder instruction: *"Do not return it to the founder unless the repository genuinely supports
both interpretations equally and a product decision is required."* His invariant: **never invent
work that did not happen.** He leans toward the first reading but requires it validated from the
repo.

**Also blocking today:** `DisturbanceItem` exists as a type but is **not a field on
`CreateDailyLogPayload`** and **not on the create_daily_log allow-list**, so the sync path cannot
carry it. Prod holds **0** `disturbance_events`, and of 23 AI results only **3** carry a non-blank
`reason` (17 are null) — the write is silently skipped when reason is blank.

## D12 — Labour, disturbance and observation persistence is ONE investigation

Measured in production: the AI produced **11** populated labour arrays, **3** disturbance objects
with a real reason, and observation content — yet `ssf.labour_assignments` holds **1** row,
`ssf.disturbance_events` **0**, and `ssf.observation_events` **0**. All three are written by the
same `LedgerDerivationService`.

> *"Do not automatically fix labour persistence in isolation if the root cause is actually a broader
> phase-boundary problem."*

The boundary must be defined from repo truth, answering: **which facts are canonical once the
farmer confirms, and which are genuinely best-effort derived intelligence?**

- **Likely canonical:** reported labour participation · an explicit disturbance/blocker · an
  explicit farmer observation, if product semantics treat it as trusted farm history.
- **Potentially best-effort:** weather enrichment · AI interpretation · derived insights.

> *"Do not blindly move every `LedgerDerivationService` child into the critical transaction.
> Likewise, do not leave an explicitly confirmed farmer fact inside a wrapper that can silently
> disappear."*

⚠️ **Alternative explanation that must be eliminated first:** all 28 `ai_jobs` date from
2026-05-14..2026-06-13. If the labour/disturbance write paths landed on `main` *after* that window,
the absence is **chronological, not defective** — which would change Phase 0 entirely.

---

## D14 — PLAN APPROVED (founder, 2026-08-28)

**Approved.** Execute `docs/superpowers/plans/2026-08-28-labour-v2-release-1.md`, baselined on
`origin/main = a7784b18`. Subagent-driven development, one subagent per task, each constrained by
the plan and current repo truth.

> *"Do not let subagents redesign the product model. They may simplify implementation when repo
> evidence supports it, but they must preserve the locked invariants."*

**Founder priority order:** 1 prove the live voice path · 2 fix the `DayOutcome` round-trip ·
3 remove false farmer-facing claims and false-zero semantics · 4 clean the attendance contracts
before farmers depend on them · 5 smallest farm-day attendance model · 6 contextual voice capture ·
7 the bridge, only for genuine ambiguity · 8 weekly ledger · 9 ship only after the gates pass.

**Excluded, restated:** no payroll · no settlement engine · no crew management · no historical
attendance prediction · no speculative attribution expansion · **no engineering work for
Category C artefacts.**

**The final product rule:**
> *Preserve what the farmer actually said, ask only for the missing truth, and never let the system
> turn attendance into proof of work that did not happen.*

### D14.1 — Task 0 is allowed to delete work
If the streamed-voice → confirmed-labour → durable-row test is **green**: record it, and **remove
any remaining Task 3 work that no longer has a demonstrated purpose.** *"Do not harden a path
merely because the old plan expected work there."* If **red**: repair the smallest proven missing
connection and **preserve the lean streaming architecture** unless repo evidence requires otherwise.

## D15 — D3 identity: option (a)

Keep the existing `FullName`. Add only a **nullable mobile** and a **nullable `introduced_by`** (or
the repo-native equivalent relationship). **Do not split surname into another farmer-facing field
in Release 1** — it adds onboarding friction without proven value.

`FullName` + mobile-when-available + who-introduced-him is sufficient identity discrimination for
R1. If real pilot usage later proves same-name collisions cannot be resolved safely with that,
revisit identity structure **from evidence**.

## D16 — ONE canonical truth about the mukadam's own presence

The founder approves collapsing the aggregate crew into the single attendance model **only if it
preserves one canonical truth about the mukadam himself**:

> *"Do not create two independently editable presence truths for the same person."*

Forbidden: an attendance `status` saying Shankar was absent while a separate field independently
says `mukadam_present = true` (or the reverse).

Required: the model must honestly represent **"Shankar's accompanying workers were present,
Shankar himself was not."**

### RESOLUTION (repo-native, no founder decision needed)
**Drop `mukadam_present` from the schema.** The mukadam's own presence is his **`status`** on his
own `attendance_marks` row — the identical field every other person uses. `accompanying_count` is a
distinct fact *about his crew*, carried on that same row.

| Real situation | Row |
|---|---|
| Shankar came with 8 | `subject=Shankar, status=Present, accompanying_count=8` |
| His 8 came, he did not | `subject=Shankar, status=Absent, accompanying_count=8` |
| Shankar came alone | `subject=Shankar, status=Present, accompanying_count=NULL` |

One field decides whether Shankar was present, and there is nowhere to contradict it. The invariant
is **structural, not disciplinary**. Note this keeps `status` absent-able per Task 5 — an unmarked
person has no row at all — so a crew-without-mukadam day requires his absence to be **deliberately
marked**, which is correct: someone had to say the crew came.

---

## Standing constraints inherited (unchanged)

- **Money invariant:** one labour entry must read identically on the log, reflect, finance
  and labour-management screens.
- **Decision 4b:** un-hiding a surface means **finishing** it. Flipping a flag over an
  unfinished path ships a screen that lies to a farmer.
- **Decision 5b:** the erasure work lands **before** worker names carry money or reputation.
- **`P10`:** offline capture is required, but until server acknowledgement it stays
  **explicitly unsynchronized intent** — never rendered as saved.
  `Acknowledged = reconstructable without the originating device.`
- **`P11`:** APK v1.0.9 / versionCode 17 is in the field; a 180-day window applies.
