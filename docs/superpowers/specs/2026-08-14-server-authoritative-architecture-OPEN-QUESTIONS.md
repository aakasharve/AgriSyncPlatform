# Server-Authoritative Cloud Architecture — Open Questions for the Founder

**Status:** Pre-design. Nothing is decided. No code written.
**Branch:** `feat/server-authoritative-architecture` (cut from `feat/labour-management-ui` @ `461bfd3f`)
**Date:** 2026-08-14
**Reads with:** `2026-08-14-server-authoritative-cloud-architecture.md` (your direction) ·
`../plans/2026-08-14-telegram-style-server-migration-HANDOFF.md` (the measurements) ·
`../../AGRISYNC-DOCTRINE.md` (the constitution)

---

## How to use this document

Every question below has a number. Answer the ones you want by number, in any format. Skip the ones
you want me to decide. Where I have a recommendation I have said so, so you can just write "agree"
and move on.

Three markers:

| Marker | Meaning |
|---|---|
| 🛑 **BLOCKING** | Design cannot start without your answer. |
| ⚖️ **CONSTRAINED** | The doctrine already narrows this. Your job is to accept or overrule the constraint, not to pick freely. |
| 💭 **DEFERRABLE** | I can decide it and tell you what I chose. Answer only if you have a view. |

There are **34 questions**. 11 are blocking. Part 3 needs no answers at all; it is the list of things
that must be taken care of regardless.

---

# PART 1 — Carried forward from the handoff

These five were already open before your architecture direction arrived. Two of them your direction
already answered. Three are still live.

### Q1 · First-login behaviour ✅ ANSWERED BY YOUR OWN DOCUMENT

Your §10 bootstrap-snapshot-then-progressive-fill **is** the "recent first, older in the background"
option. Unless you disagree, I am treating this as settled.

*Confirm only if you disagree.*

---

### Q2 · Financial summary — stored or derived? ⚖️ **CONSTRAINED**

**What it is.** Every daily log has a money total. Right now the phone works it out. It never reaches
the server, so on a new phone it rebuilds as zero.

**The constraint.** `P1` says a number the farmer *stated* and a number the system *worked out* may
never pretend to be each other. The log already carries both: a calculated summary **and** a
farmer-typed `manualTotalCost`. So they must stay tellable apart on the wire. That part is not a
choice.

**What is still yours:** where the arithmetic runs.

- **(a)** Server calculates and sends the total. One place does the maths, so the phone and the server
  can never disagree. **Recommended.**
- **(b)** Phone calculates, server only stores the farmer-typed one.

*Answer: Q2 = a / b / other, and confirm you accept the P1 constraint.*

---

### Q3 · Machinery data already sent in the mangled form ⚖️ **CONSTRAINED** 🛑 **BLOCKING**

**What it is.** Machinery went to the server flattened into a line of text and comes back filed as a
crop activity. Farmers have already sent data this way.

**The constraint.** `P3` forbids overwriting a recorded value with no trace. Silently reinterpreting
those rows as machinery is not available.

**Your real choice:**

- **(a)** Leave old rows as they are. New machinery uses the new structure. Old rows stay visibly
  "legacy" and are not re-read as machinery. Nothing is touched, nothing is lost.
- **(b)** Convert old rows by parsing the text back into numbers, and mark every converted value as
  *inferred, not stated* (`P8`). More history recovered, more risk of parsing something wrong.
- **(c)** Convert, and ask the farmer to confirm each one before it counts.

**Recommended: (a).** The parsed text is not reliable enough to become farm truth, and (c) violates
`P9` by adding a chore.

**The trap nobody had spotted.** Those mangled rows are **already sitting on farmers' phones as crop
activities**. The day machinery round-trips properly, the same event exists twice on that device. Any
answer here must also say what happens to the duplicate.

*Answer: Q3 = a / b / c, and how the duplicate is handled.*

---

### Q4 · Weather — reader or write-only? 💭 **DEFERRABLE**

**What it is.** Weather is saved to the server on every log and nothing ever reads it back.

Genuinely free, doctrine-clean either way. Weather is captured by the system, not asserted by the
farmer.

- **(a)** Give it a reader. Weather comes back on a new phone with the log.
- **(b)** Declare it write-only on purpose, for later analysis, and say so in writing so nobody
  "fixes" it in six months.

**Recommended: (b) now, (a) when a screen actually needs it.** Building a reader nothing consumes is
the orphan problem in reverse.

*Answer: Q4 = a / b.*

---

### Q5 · "How far back?" — **this question needs splitting** 🛑 **BLOCKING**

It is two different questions wearing one coat, and leaving them merged is how someone builds a
retention cap while believing they built a download window.

**Q5a — how far back does the *phone download*?**
Free engineering choice. Your §9 already answers it: bounded recent, rest on demand.

**Q5b — how far back does the *server keep*?**
Not free. Your own words: *"nothing is ever lost unless he deliberately deletes it."* Doctrine §0.4
puts durable history above convenient mutation.

**Recommended: Q5a = recent bounded, Q5b = forever.** Cost has been measured. ₹2.80 per farmer per
year. Forever is affordable.

*Answer: Q5a = ? · Q5b = forever / bounded at ?*

---

### Q6 · The Marathi for partial and pending 🛑 **BLOCKING**

**What it is.** A farmer on a new phone currently gets an incomplete record and nothing tells him.
`P5` makes telling him mandatory. Telling him means Marathi, and Marathi is yours. An agent inventing
it has already shipped a sentence with the word order inverted.

I need these strings from you eventually, not now, but the design cannot pretend they are free:

1. This record is not fully here yet.
2. Saved on your phone, not yet sent.
3. Sending now.
4. Saved on the farm. (committed)
5. Could not be sent. (must obey the anti-ego rule: no "error", "failed", "wrong")
6. Older records are still loading.
7. This value was worked out from an older entry, not recorded directly. (for Q3b if chosen)

*Answer: confirm you will author these, or tell me to draft English placeholders you replace later.*

---

# PART 2 — New questions raised by your architecture direction

## A. Scope and shape of the project

### Q7 · Is this one project or three? 🛑 **BLOCKING**

Your document bundles three things that could ship separately:

1. **Source-of-truth migration** — the ownership work, Phases A to G.
2. **Media pipeline** — presigned upload, CloudFront read, thumbnails, compression.
3. **Live updates** — the change feed so two phones on one farm see each other.

The handoff said photos are separate and first. Your document treats media as one of the four planes.

- **(a)** Three separate projects, three branches, in that order. Media first because it is a day of
  work and it is 20× cheaper before farmers upload. **Recommended.**
- **(b)** One project, all three planes together.
- **(c)** Ownership + media together, live updates later.

*Answer: Q7 = a / b / c.*

---

### Q8 · Does Phase A get its own gate? 🛑 **BLOCKING**

Your Phase A is: inspect every persisted data type and classify it. Your closing line says do that
classification **before** allowing any agent to modify code.

That is a real deliverable on its own. It is an inventory of everything the phone stores today, with
a verdict per item, and it will take a session.

- **(a)** Phase A is its own deliverable. I produce the classification table, you read it and correct
  it, and only then do we design the migration. **Recommended, and it is what your own document
  instructs.**
- **(b)** Fold Phase A into the design and show it as one section.

*Answer: Q8 = a / b.*

---

### Q9 · The irrigation and inputs fabrication — in scope, or logged as debt? 🛑 **BLOCKING**

**What it is.** This was found today and is not in either document. Irrigation and inputs are broken
the same way machinery is, and on the way back the app **invents** the missing details from fixed
constants:

```
irrigation method  → always "Drip"        irrigation source → always "Field"
spray reason       → always "Preventive"  spray type        → always "pesticide"
fertiliser reason  → always "Growth"      fertiliser type   → always "fertilizer"
```

A farmer who flood-irrigated is shown drip. A farmer who sprayed for a live infestation is told it was
preventive. Quantity and cost pushed into a notes field are never read back at all.

This is `P4`, live, shipping today. The doctrine's own phrase for it is "constants wearing the costume
of a measurement."

- **(a)** In scope. Fix it in this work alongside machinery. It is the same defect and the same code
  path. **Recommended.**
- **(b)** Out of scope, filed as EXISTING DEBT under `W2`, fixed later.
- **(c)** Not fixed but neutralised now: stop showing the invented values at all until they can be
  real. Cheapest honest option. Satisfies `P5` immediately.

*Answer: Q9 = a / b / c.*

---

### Q10 · Also never sent to the server 💭 **DEFERRABLE**

Found today, not in either document. These never leave the phone: disturbance notes, the full voice
transcript, the transcript snapshot, the farmer's manually entered total cost, the crop phase at the
time of logging, the day number, and the Understanding Meter score.

Which of these are farm truth that must survive a new phone?

My read: transcript and manual total cost are **truth** and must go. Phase and day number are
**derivable** from the date and the crop cycle. The Understanding Meter score is **derived** and
should be recomputed, never stored, or it becomes a fabricated number the day the formula changes.

*Answer: agree, or name exceptions.*

---

## B. The truth plane — who owns what

### Q11 · An unconfirmed voice draft 🛑 **BLOCKING**

**What it is.** A farmer speaks. The app transcribes and parses it into a draft. He has not pressed
confirm yet. His phone dies.

`P1` says once he confirms, it is farmer-asserted truth. Before he confirms, it is nothing yet. But he
*did* speak, and the recording exists.

- **(a)** Unconfirmed drafts are device-only. Losing one is acceptable. Simplest, and arguably honest,
  because he never said it was right.
- **(b)** The **audio** goes to the server immediately, the draft stays local. He loses the parse, not
  his voice. He can re-parse on the new phone. **Recommended.**
- **(c)** Drafts sync too, and appear as pending on the new phone.

Note that (b) has a consent consequence. Memory records that pre-consent clips are deliberately never
archived, by design, under DPDP §7(1). So (b) applies only after consent.

*Answer: Q11 = a / b / c.*

---

### Q12 · Trust Ladder transitions while offline 🛑 **BLOCKING**

**What it is.** A log moves DRAFT → CONFIRMED → VERIFIED → DISPUTED. Verification is role-gated: an
owner verifies a worker's log.

If the owner is offline and verifies a log, and meanwhile the worker corrects it, the server has to
decide what happened.

- **(a)** Only CONFIRMED may happen offline. Verification and disputes need the server. Fewest ways to
  be wrong. **Recommended.**
- **(b)** All transitions may happen offline and the server reconciles.

*Answer: Q12 = a / b.*

---

### Q13 · Planned tasks — truth or convenience? 💭 **DEFERRABLE**

A planned task is a statement about the future. Is it farm truth that must survive a phone change, or
a scratchpad?

My read: **truth**. A farmer who planned next week's spraying and lost it on a new phone has lost
work. Also, planned-versus-actual is the whole point of the product.

*Answer: agree / disagree.*

---

### Q14 · Does the selected farm follow the farmer across devices? 💭 **DEFERRABLE**

Multi-farm is core. If he switches to Farm B on his phone, should the tablet also switch?

My read: **no**. Selected farm is a device preference. Two devices open on two farms is a feature, not
a bug, especially for an FPO view.

*Answer: agree / disagree.*

---

## C. The outbox — the hardest part

### Q15 · What happens when the server rejects a pending action? 🛑 **BLOCKING**

**This is the biggest gap in your document.** You defined two states, Pending and Committed. Reality
has a third: **Rejected**.

The farmer was told his work was recorded. The server later refuses it, because the plot was deleted,
or he lost access to the farm, or the data is invalid.

- **(a)** It surfaces as something needing his attention, and the content is preserved so nothing he
  said is thrown away. He decides. **Recommended, and closest to `P2`.**
- **(b)** Retry forever, silently. Never tell him. This is `P5` failure: the app looks like it worked.
- **(c)** Discard and tell him.

A farmer who was told "recorded" and later finds it gone is the exact trust failure this whole project
exists to prevent. Whatever we pick, it cannot be silent.

*Answer: Q15 = a / b / c.*

---

### Q16 · How long may work sit in the outbox? 🛑 **BLOCKING**

Three weeks offline is a real scenario in rural India.

- **(a)** Forever. It sits until it sends. Consistent with your promise. **Recommended.**
- **(b)** Expires after N days.

If (a), one consequence must be accepted: the phone must be able to hold a lot of unsent work,
including photos, without running out of space. That needs a size cap on media, not on the record.

*Answer: Q16 = a / b, and if a, what happens when the phone runs out of space.*

---

### Q17 · Two devices, one farm, both offline, same log 🛑 **BLOCKING**

Multi-user from day zero is a locked design principle, so this is not hypothetical. The mukadam and
the owner both edit today's labour count while offline.

- **(a)** Last to arrive wins, and the earlier version is kept in history so nothing is destroyed and
  the farmer can see both. **Recommended.** Fits `P3`.
- **(b)** First wins, second is rejected and surfaces under Q15.
- **(c)** Both are kept as separate records and the farmer merges them.

*Answer: Q17 = a / b / c.*

---

### Q18 · Correcting something that has not synced yet 💭 **DEFERRABLE**

He logs 8 workers offline, then corrects it to 6 before he ever gets signal. Does the server see one
mutation or two?

My read: **one**. Nothing had reached the server, so there is nothing to correct against. Correction
history begins the moment the server has a version. Anything else creates fake history.

*Answer: agree / disagree.*

---

### Q19 · Photo captured offline — what syncs first? 💭 **DEFERRABLE**

The log is small, the photo is large. On a weak connection the log will arrive and the photo will not.

My read: **log first, photo after, and the log is honest about the photo still being on its way.** A
log held hostage to a 3 MB upload is `P9` failure.

*Answer: agree / disagree.*

---

### Q20 · Does the existing sync machinery get reused? 💭 **DEFERRABLE**

`/sync/push` already has idempotency keys, which means sending the same thing twice does not create it
twice. `/sync/pull` already has cursors.

My read: **reuse both.** Building a second sync channel is the same debt as a second database, and both
documents warn against it.

*Answer: agree / disagree.*

---

## D. Media

### Q21 · Where are thumbnails made? 🛑 **BLOCKING**

- **(a)** On the phone, before upload. Free, no server cost, works offline. But a weak phone does the
  work, and we trust the phone to do it right.
- **(b)** On the server, after upload. Consistent quality, costs money per image, needs the full
  original uploaded first, which is the thing we are trying to avoid on 2G.
- **(c)** Both. Phone makes a small one for immediate display, server makes the proper set later.
  **Recommended.**

*Answer: Q21 = a / b / c.*

---

### Q22 · How small do we compress? 💭 **DEFERRABLE**

A receipt needs readable text. A crop-disease photo needs leaf detail. A field photo does not.

My read: **one setting is wrong.** Receipts get a higher quality floor than field photos. Two presets,
not one, and not a slider the farmer has to think about.

*Answer: agree, or give a target size.*

---

### Q23 · The photos already uploaded uncompressed 💭 **DEFERRABLE**

There are existing full-size images in S3.

- **(a)** Leave them. New uploads are compressed. Cost is already spent.
- **(b)** Run a one-off job to compress and re-thumbnail them. **Recommended if the count is small**,
  and I would measure the count before deciding.

*Answer: Q23 = a / b / measure first.*

---

### Q24 · Voice recordings — how long do we keep the audio? 🛑 **BLOCKING**

Your document says this is a product and data-governance decision, not a technical one. So it is
yours.

Once a recording is transcribed and the farmer has confirmed the log, the audio has served its
purpose, except as evidence.

- **(a)** Keep forever. Strongest evidence, biggest storage bill, largest privacy surface.
- **(b)** Keep for a fixed window, then delete the audio and keep the transcript. **Recommended**, and
  it is the DPDP-friendliest option.
- **(c)** Delete as soon as transcribed and confirmed.

*Answer: Q24 = a / b (window = ?) / c.*

---

### Q25 · The presigned upload changes who guards the door 🛑 **BLOCKING**

Today the API server is the gatekeeper for every file. With presigned uploads, the API hands out a
temporary permission slip and steps out of the way.

That is the right architecture and it is what makes 10 MB uploads stop touching server memory. But the
permission slip must be scoped tightly: this farm, this log, this one file, short expiry, size
capped. Otherwise a leaked slip is an open door into the bucket.

*Answer: confirm you accept the tradeoff. I will design the scoping; you do not need to specify it.*

---

## E. The read path

### Q26 · What is actually in the bootstrap snapshot? 🛑 **BLOCKING** (product question, not technical)

This is what the farmer sees in the first two seconds on a new phone. Your §10 lists: identity, farm
memberships, current farm, plots, active crop cycles, today's status, recent activity, pending work,
summary metrics.

I need you to confirm or edit that list, because it is a product decision about what "my farm is here"
means to a farmer.

Specifically: **how many recent days of logs?** Seven, thirty, the current crop cycle?

*Answer: confirm the list, and name the recent window.*

---

### Q27 · All farms, or just the current one? 💭 **DEFERRABLE**

Multi-farm is core.

My read: **memberships for all farms, full data for the current one.** He sees every farm he belongs
to immediately, and switching farms loads that farm.

*Answer: agree / disagree.*

---

### Q28 · What does a half-finished first sync look like? 🛑 **BLOCKING**

He logs in on a new phone, the bootstrap starts, and the signal dies halfway.

`P5` says the app must not look complete when it is not. But `P9` says he must still be able to record
today's work.

My read: **he can always record. What he cannot yet see is marked as still loading, never shown as
empty.** An empty screen that means "still loading" is the same lie as a zero that means "not
measured".

*Answer: agree / disagree.*

---

## F. A principle collision you need to rule on

### Q29 · "Sync-invisible" versus "tell the farmer the truth" 🛑 **BLOCKING**

Two of your own rules point in opposite directions here.

`PROJECT_BOOT.md` lists **"Offline-first, sync-invisible"** as a non-negotiable design principle. The
farmer should never think about syncing.

`P5` says a control must never look like it works when it does not. And your own §16 forbids a screen
saying "saved successfully" when nothing reached the server.

Both cannot be fully true. Something must show the difference between "on your phone" and "on the
farm".

- **(a)** Sync stays invisible when everything is fine, and only becomes visible when something needs
  attention. Silence means healthy. **Recommended.** This keeps the spirit of "invisible" while
  obeying `P5`.
- **(b)** Always show the state of every record. Honest, noisier, and starts to feel like an
  engineering tool.
- **(c)** Sync-invisible wins outright, and `P5` is waived for sync state. I would push back on this
  one, because it is the state your §16 says must become impossible.

*Answer: Q29 = a / b / c.*

---

## G. Doctrine

### Q30 · Does your invariant become a locked principle? 💭 **DEFERRABLE**

Your §16: *"No successful business mutation may permanently exist only on one client device."*

That is the exact mirror of `P1`, which forbids canonical data living in a best-effort side-car on the
server. Yours forbids it living only in a disposable cache on the device.

A plan can be argued with. A `P` rule cannot be reopened by an agent.

*Answer: yes, add it as `P10` / no, keep it in the spec.*

---

### Q31 · Does an ADR get written for the machinery data decision? 💭 **DEFERRABLE**

Q3 migrates real farmer data and changes an API contract. Under the cofounder rules that is
ADR-shaped, meaning a permanent record of the decision and why, that nobody can quietly reverse.

My read: **yes**, and it should also cover Q9 and Q15 since all three are data-honesty decisions.

*Answer: agree / disagree.*

---

## H. Things that touch this work but are not this work

### Q32 · The production raw-blob bucket 💭 **DEFERRABLE**

Confirmed today: the production config has **no** raw-blob storage section at all, so the code falls
back to a default bucket name, `agrisync-raw-ap-south-1`. Production may be writing evidence blobs
into a bucket nobody has costed.

This needs one look at the live AWS account. It is fifteen minutes and it is not part of this project.

*Answer: do it now as a separate small task / later.*

---

### Q33 · Live updates between devices 💭 **DEFERRABLE**

Your §13. Two people on one farm seeing each other's work without refreshing.

My read: **not now.** Your own document says full real-time infrastructure is not needed initially,
and the cursor already exists. Refreshing on app open covers most of the value. Build it when a
farmer complains, not before.

*Answer: agree / disagree.*

---

### Q34 · The unpruned message table 💭 **DEFERRABLE**

The server's internal message table has never been cleaned. 1,169 rows measured, all processed, none
deleted, no ceiling. This project adds to it.

My read: **fix it here**, because this project makes it grow faster. It is small.

*Answer: agree / disagree.*

---

# PART 3 — What must be taken care of, regardless of your answers

**No decisions needed here.** This is the list I hold myself to. It is in the document so you can
check that I did.

## Doctrine that binds this work

| Rule | What it forces here |
|---|---|
| `P1` Phase Rule | Farmer-confirmed data goes in the durable write path, never a best-effort side-car. Stated and derived stay tellable apart. |
| `P3` Correction is never silent mutation | No recorded value gets overwritten without a trace. Nothing history should explain gets hard-deleted. |
| `P4` No fabricated numbers | The irrigation and input constants are a live breach. Whatever Q9 decides, no new invented value is added. |
| `P5` Truthful missing beats fake working | A partial record must say it is partial. A pending save must not say saved. |
| `P6` Creator ≠ data subject | Worker names arriving on a new device do not become the new device owner's data. Erasure of a worker must still be possible. |
| `P7` Attribution never changes quantity | 8 workers with 3 named is still 8, on any device. |
| `P8` Provenance over precision | Any value recovered by parsing old text is marked inferred, not stated. |
| `P9` Low-friction capture is sacred | No sync state, no upload, no bootstrap may ever block recording today's work. |

## Traps that already cost time and must not be re-hit

1. **The `/sync/push` allow-list is strict.** Adding a payload field without adding it to the list
   rejects the *entire* record, and the failure looks nothing like the field you added.
2. **There are three copies of the payload shape**, and one is hand-written. A type-level guard was
   added since the handoff, but the generated C# copy and the server-side allow-list are still covered
   by nothing in CI.
3. **Read-back must land before the client starts sending.** Reversing this order nearly shipped a bug
   that rewrote a three-plot log into "entire farm".
4. **The "did this response carry the field" test, never "did a value come back non-empty".** The
   second form deletes farmer data. Most repeated trap in this codebase.
5. **Three-state fields.** `null` means the response makes no statement. `[]` means the server says
   there is none. They are not interchangeable, and at least one of the four new categories is
   optional where the others are required, so a copy-paste of the labour pattern will be wrong.
6. **A migration's rollback must refuse, not invent.** The scaffolded rollback for one Phase 2 change
   would have written a fabricated plot over exactly the rows the change existed to make honest.
7. **New child tables need their own tenant column.** An existence-check policy on a child table fails
   at runtime because parent and child are written together. Tried, reverted, documented as `F8`.
8. **New repository members need default bodies.** 28 implementors; an abstract member produces
   roughly 135 compile errors. And every test double then answers the default, so a test can pass for
   the wrong reason.
9. **The UI gate pins to the exact commit.** Any commit invalidates it, including a docs commit. All
   screen files get written together, before the first screen commit. Never bypassed.
10. **Source files cap at 800 lines.** Split, never suppress.
11. **Commit hooks are live** and count bytes, not characters, so Marathi in a commit subject behaves
    differently than it looks.
12. **Never invent farmer-facing Marathi.**

## Verification standards

- Repo is truth. Every file opened before it is asserted about. The last plan's line numbers were
  wrong eight times.
- Measure, never predict. Baseline, then change, then actual, with real command output.
- Prove every guard by breaking it. Revert the fix, watch the *named* test fail, restore, verify by
  hash. A guard that nothing fails without is decoration.
- A failing test is not a flake until it has been measured. Last time this came up three times and
  twice it was a real defect, one of them a production bug.
- Correct the instruction when it is wrong, with evidence.

## Housekeeping owed

- The cost evidence for "cost is not a reason to hesitate" lives in a folder git ignores. A fresh
  clone has none of it. Two files need copying into `docs/`.
- The supervisor-intervention log row for today's pre-flight is owed.
- `SESSION_STATE.md` was last written 2026-05-22 and still describes the old branch. `PROJECT_BOOT.md`
  names the wrong trunk. Both are docs-only fixes.
- Project memory's claim that a Thin Client Migration completed phases 0 to 7 is **unverifiable**. The
  only artifact is a 13-line tombstone whose pointer to its own "full record" resolves to a directory
  that holds nothing. It was born as a tombstone. Memory has been corrected. Do not cite it.

---

# PART 4 — What I recommend happens next

In this order, and I will not start any of it without your word.

1. **You answer the 11 blocking questions.** Q3, Q5, Q6, Q7, Q8, Q9, Q11, Q12, Q15, Q16, Q17, Q21,
   Q24, Q25, Q26, Q28, Q29. *(That is 17 marked blocking; 11 need a real decision, the rest need a
   "agree".)*
2. **You merge `feat/labour-management-ui` into `main`.** Clean fast-forward, zero conflicts, verified
   today. Not my call to make, and everything downstream waits on it.
3. **Phase A runs as its own deliverable** (if Q8 = a). I produce the full inventory of everything the
   phone stores, with a verdict per item, and you correct it.
4. **Then, and only then, the design.** Sections, your approval per section, written spec, your
   review, and a plan through the plan-writing skill.

Media work can run in parallel from step 2 onward. It shares no files with this.

---

## Answer sheet

Copy this, fill it in, hand it back.

```
BLOCKING
Q3  machinery legacy data =            duplicate handled by =
Q5a phone downloads =                  Q5b server keeps =
Q6  Marathi =                          (you author / draft placeholders)
Q7  one project or three =
Q8  Phase A own gate =
Q9  irrigation/inputs fabrication =
Q11 unconfirmed voice draft =
Q12 offline trust-ladder =
Q15 server rejects a pending action =
Q16 outbox lifetime =                  out-of-space behaviour =
Q17 two devices same log =
Q21 thumbnails made where =
Q24 voice audio retention =            window =
Q25 presigned tradeoff accepted =
Q26 bootstrap contents =               recent window =
Q28 half-finished first sync =
Q29 sync-invisible vs P5 =

CONSTRAINED — accept or overrule
Q2  financial summary =                P1 constraint accepted =
Q3  P3 constraint accepted =

DEFERRABLE — answer only if you have a view
Q1 Q4 Q10 Q13 Q14 Q18 Q19 Q20 Q22 Q23 Q27 Q30 Q31 Q32 Q33 Q34
```
