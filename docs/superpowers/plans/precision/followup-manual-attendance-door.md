# Follow-up — the manual attendance-capture door (three unfinished controls)

**spec:** `2026-08-28-labour-v2-release-1`
**Status at Labour V2 R1:** NOT a merge blocker. Provably unreachable by any farmer.
**Blocks:** opening the door. Per **Decision 4b (2026-07-19, screen honesty)**, un-hiding
means *finishing* — all three items below, not one, not two.

---

## 0. What this document is

Three controls on the manual हजेरी capture screen
(`src/clients/mobile-web/src/features/labour/components/Attendance.tsx`) promise things the
app does not do. They ship in the bundle. They are safe today only because the single door
into that screen is closed, and closed in a way a test can check.

This file is the whole hand-off: what each control promises, what actually happens, why it is
unfinished, and what "finished" would have to mean. Whoever opens the door owns all three.

## 1. The door, and the pin that holds it

| Thing | Where |
|---|---|
| The gate | `LabourHub.tsx` → `const SHOW_ATTENDANCE_TILE = false;` (~L41) |
| The only render of the tile | `LabourHub.tsx` ~L390 → `{(SHOW_ATTENDANCE_TILE \|\| isPreview) && <QuickTile … label="हजेरी घ्या" onClick={onAttendance} />}` |
| The escape hatch | `useLabourState.ts` ~L157 → `const isPreview = farmCtx === null;` — true ONLY where no `FarmContextProvider` exists, i.e. the `import.meta.env.DEV`-gated `?preview=labour` mount (`App.tsx` `LABOUR_PREVIEW`). Vite folds that branch to dead code in a production build. |
| The only push to the screen | `LabourFeature.tsx` ~L268 → `onAttendance={() => push({ name: 'attendance' })}` — passed to `LabourHub`, i.e. reachable only through the gated tile |
| The only render of the screen | `LabourFeature.tsx` ~L300 → `{cur.name === 'attendance' && <Attendance … />}` |
| **The pin** | `src/clients/mobile-web/src/features/labour/components/__tests__/LabourFeature.attendanceDoorClosed.test.tsx` |

The pin mounts the REAL `FarmContextProvider` over the REAL `useLabourState` and the REAL
`LabourHub`, on a fully-populated farm, and asserts the tile, the screen title and all three
control strings are absent. Flipping `SHOW_ATTENDANCE_TILE` to `true` makes it fail — verified
by doing exactly that. Its second test proves the assertion has teeth (no provider → the tile
appears), its third proves no other door off the hub lands on the screen.

**If you open the door, that test is the file that will stop you.** That is the point: it is
meant to be deleted or rewritten only by the change that finishes the three items below.

---

## 2. Item 1 — the save button promises an approval that does not exist

**What it says today.** `Attendance.tsx` ~L122-126:

```
जतन करा → मंजुरीसाठी      ("save → for approval")
```

**What actually happens.** The click calls `onSave(...)`; `LabourFeature.tsx` ~L300-345
enqueues one `attendance.mark` mutation per worker through `MarkAttendanceCommand.enqueue`,
then toasts the honest offline vocabulary (`लक्षात ठेवलं ✓` — "remembered", never "saved",
P10) and refreshes.

**Why it is unfinished.** Nothing approves a mark. There is no approval state to enter:

- the wire (`sync-contract/schemas/payloads/attendance_mark.zod.ts`) carries no approval,
  verification or status field — only ids, `workDate`, `dayMark`/`nightMark`, hours, and the
  contradiction-resolution id;
- the entity (`ShramSafal.Domain/Labour/AttendanceMark.cs`) has no approval or verified
  property — its columns are farm, operator, date, day/night mark, hours, basis, recorded-by,
  timestamps;
- `RecordAttendanceMarkHandler` contains no approval concept at all;
- the तपासा queue (`ReviewSheet.tsx`) approves **logs**, via `VerifyLogCommand` — a different
  plane entirely. A mark never enters it.

So the arrow in the copy points at a room that does not exist. The mark simply lands.

**What "finished" means — pick one, and only one is a copy change:**

- **(a) Keep the promise.** Give a mark somewhere to go: an approval state on `AttendanceMark`
  (migration + wire field + handler), a queue that lists pending marks, and an approve action.
  This is a schema decision and must be treated as one — see `AttendanceMark.cs`'s own remarks
  on D-H3 and on *unmarked is a fourth state, not a synonym for absent*: whatever state is
  added must not collapse "nobody approved yet" into "rejected".
- **(b) Change the copy.** Drop the `→ मंजुरीसाठी` clause so the button says only what the tap
  does. Deletion of the false clause is preferred over rewording — the same treatment Tasks
  7/7b/11/22 gave the hub's false claims. **Do not invent a new farmer-facing noun for the
  destination** (founder vocabulary rule: describe the work arrangement, never classify the
  human; a permanent naming session is the founder's, not this task's).

Either way the button must not claim "saved" before acknowledgement — the existing toast is
already correct on that and must stay (P10).

---

## 3. Item 2 — the "आज किती लोक आली?" counter collects a number the save discards

**What it says today.** `Attendance.tsx` ~L77-84: the heading "आज किती लोक आली?" ("how many
people came today?"), a −/+ stepper over `count`, and a hint line
`🎙 "आज ४ लोक कामाला आली" — व्हॉइस लॉगमधून` implying it is the same number the voice log
carries.

**What actually happens.** `count` is local state seeded from `data.attendance.headcount ?? 0`
(~L61) and **is never read again**. The save (~L123) maps only the per-worker `status` map and
the screen's `shift`:

```ts
onSave(Object.entries(status).map(([fieldOperatorId, s]) => ({ fieldOperatorId, status: s, shift })))
```

There is no `count` in that payload, and no headcount field on the `attendance.mark` wire.
The farmer taps + six times and nothing anywhere records it.

**Why it is unfinished, and why "just wire it up" is the wrong instinct.** A headcount here is
not a free number:

- **Attribution never changes reported quantity (Constraint 3 / P7).** The engagement is the
  single source of truth for how many worked. Marking four people present does not turn a crew
  of eight into four, and a stepper on this screen must not be able to.
- **Headcount never produces rupees** (founder's corrected economic model). It proves human
  execution happened. Without a trustworthy rate source the money reads `—`, never `₹0` and
  never a guess; and for उक्ते काम the money comes from the agreement, never headcount ×
  day-rate.
- **A disagreement is a fact to preserve, not to resolve silently.** The voice path already
  has the finished machinery for exactly this: `attendanceDisagreement.ts` (spoken count vs
  the anchored log's headcount, and count-vs-composition) with `AttendanceResult.tsx`'s
  `headcount-disagreement` surface. Rule 1 there: **both statements are preserved, nothing is
  overwritten.** A manual stepper that writes a number is a second, mute door into the same
  fact class.

**What "finished" means — pick one:**

- **(a) Wire it honestly.** The typed count becomes a *statement by the owner*, carried on its
  own path, run through `attendanceDisagreement.ts` against the anchored engagement, and shown
  in the same confirm surface the voice path uses. It never mutates the engagement, and it
  never becomes money. (This is real work: a statement plane the wire does not have today.)
- **(b) Remove it.** Delete the card. The named per-worker rows below it are what make the
  screen हजेरी; the count above them is decoration that currently lies by omission. Removing
  it costs the farmer nothing he can reach today.

Also delete or fix the `🎙 …व्हॉइस लॉगमधून` hint with whichever branch is taken — as written it
tells the farmer this number came from (or goes to) his voice log, and neither is true.

---

## 4. Item 3 — "नाव जोडा" only shows a toast

**What it says today.** `Attendance.tsx` ~L116-118, a full-width dashed CTA:

```
+ नाव जोडा — इतिहासातून किंवा नवीन     ("add a name — from history or new")
```

**What actually happens.** `onClick={() => onToast('इतिहासातून निवडा किंवा नवीन नाव')}` — it
toasts a restatement of its own label. No picker opens, no person is added, nothing is
attached. The screen's own amber note directly above it ("किमान एक नाव आवश्यक" — at least one
name required) makes this worse: it names a requirement the only control on the screen for
meeting it cannot meet.

**Why it is unfinished.** Not because the capability is missing — it exists and is finished.
`FieldOperatorPicker.tsx` is the real surface: add a person *or* select an existing one, and
attach them to ONE labour engagement (`labourAssignmentId`). It is already wired into
`ReviewSheet` (Labour V1 Task 13). This button is a second entrance to that feature that was
never connected to it.

**What "finished" means — pick one:**

- **(a) Open the real picker.** Wire this button to `FieldOperatorPicker`, which brings its own
  rules with it and they are not optional: attribution is an **opt-in overlay, never a task the
  app assigns** (P9 — zero names, zero warnings, zero wizards, zero completion percentages);
  identical names are **real people, not duplicates** (B2 — never merge, never auto-pick); and
  it never renders an "attached / total" ratio. The screen also needs a real
  `labourAssignmentId` to attach to — note `data.attendance.todaysLabourAssignmentId` is `''`
  in the preview fixture *on purpose* ("no real engagement exists behind a mock"), so this
  cannot be built against the preview alone.
- **(b) Remove the button** — and then reconcile the amber note above it, which promises a
  requirement with nothing left to satisfy it.

---

## 5. Constraints binding on whoever picks this up

- **Decision 4b:** un-hiding the door means finishing all three. Do not open it for one.
- **P4/P5:** never state as fact what the app has not established. An unstated count is
  unknown, never zero.
- **P7 / Constraint 3:** attribution never changes reported quantity.
- **P9:** low-friction logging is sacred. Nothing added here may nag, score or complete-ify.
- **P10:** never rendered as saved before acknowledgement.
- **Founder economic model:** रोजंदारी / उक्ते काम describe the **basis of the obligation to
  pay**, not the human. Unnamed ≠ unknown payment model; occasional ≠ contract; Mukadam
  involvement ≠ contract. Headcount alone never yields rupees.
- **Farmer-facing vocabulary rule:** internal names (`LabourAssignment`, `FieldOperator`,
  `ContractUnit`, …) stay — no renames, no migrations for terminology. Farmer-facing copy must
  not show "Labour"/"Labour Management" and must not present "रोजंदारी" as a visible *category
  of person*. "उक्ते काम" may remain farmer-facing. **Do not invent a permanent replacement
  noun** — the founder runs a naming session. Where a label is unavoidable, use the smallest
  neutral work-centred wording.
- **Deleting a false clause beats rewording it.** That is the precedent this branch set
  repeatedly (Tasks 7, 7b, 11, 22).

## 6. Done means

- [ ] Each of the three items resolved by an explicit (a) or (b) — recorded, not implied.
- [ ] No farmer-facing string on the screen promises anything the code does not do.
- [ ] The door's pin (`LabourFeature.attendanceDoorClosed.test.tsx`) is rewritten by the same
      change that opens the door — never quietly deleted, never left asserting a door that has
      moved.
- [ ] Founder acceptance before the door opens. Code-complete ≠ approved.
