# Closure report — the manual attendance-capture door

**spec:** `2026-08-28-labour-v2-release-1`
**Branch:** `feat/labour-v2-r1` · **HEAD at start:** `7219974d`
**Question asked:** are the three known-unfinished manual-attendance controls *provably*
unreachable by a farmer at HEAD?

**Verdict: YES. No merge blocker found. No second door exists.**

---

## 1. Route trace — every way into the Attendance surface

`Attendance.tsx` is imported in exactly ONE place in the whole client
(`LabourFeature.tsx:39`; grep across `src/**` confirms no other import), and rendered in
exactly one place (`LabourFeature.tsx` ~L300, `{cur.name === 'attendance' && …}`).

**How `cur.name` can become `'attendance'`.** `LabourFeature` holds a local screen stack,
`useState<ScreenState[]>([{ name: 'hub' }])` (~L97). The only mutators are `push` (~L170) and
`back` (~L171); `setStack` appears nowhere else. Every `push` call site:

| Line | Pushes | Reached from |
|---|---|---|
| ~L266 | `mukadam` | LabourHub person row |
| ~L267 | `person` | LabourHub person row |
| **~L268** | **`attendance`** | **`LabourHub` `onAttendance` — the gated tile, and nothing else** |
| ~L269 | `dashboard` | LabourHub tile |
| ~L270 | `ledger` | LabourHub tile |
| ~L285/286 | `person` / `mukadam` | MukadamDetail |
| ~L351 | `ledger` | WeeklyDashboard |

So the attendance screen has exactly one predecessor: `LabourHub`'s `हजेरी घ्या` tile, which
renders only under `{(SHOW_ATTENDANCE_TILE || isPreview) && …}` (`LabourHub.tsx` ~L390).
`SHOW_ATTENDANCE_TILE` is hard `false` (~L41) and `isPreview` is `farmCtx === null`
(`useLabourState.ts` ~L157) — no `FarmContextProvider` in the tree at all.

**Routes INTO the labour feature itself (all land on the hub, none can select a sub-screen):**

1. `simpleRoutes.tsx:67` — Profile's `onOpenLabour` → `setCurrentRoute('labour')`.
2. `useLogCommands.ts:643` — auto-return after a labour-intent log save.
3. `mainView.tsx:277` — `LabourLogBanner` "back to labour".
4. `EditSurfaceRegistry.ts:169` — an `attendance.mark` sync **conflict** routes to `'labour'`.
   This is the one route that is *about* attendance, and it still lands on the hub:
   `LabourFeature` renders `AttendanceContradictionPrompt` **above whatever screen is open**
   (~L206-222), i.e. over the hub. It never pushes `attendance`.

`renderLabourRoute` (`simpleRoutes.tsx:80`) mounts a fresh `LabourFeature` each time, so the
stack always starts at `hub`. There is no URL→sub-screen mapping anywhere.

**Deep links / URL.** `readInitialRouteFromUrl` (`useAppNavigation.ts:52`) accepts
`?route=<x>` only for `x ∈ KNOWN_ROUTES` — and **`'labour'` is not in that list**, in either
copy of it (`useAppNavigation.ts:28-51` and `navigationMachine.ts:64-94`). So `?route=labour`
does not even open the labour route, let alone a sub-screen. `?nudge=` accepts only
`close-day | review-summary | open-today` (`navigationMachine.ts:33`) — none touches labour.
`EditSurfaceRegistry`'s `pushRouteToUrl('labour')` writes a URL that a reload will not honour,
which is a separate (harmless, pre-existing) inconsistency, not a door.

**The preview escape.** `?preview=labour` → `LabourPreview` is gated on
`import.meta.env.DEV && …` (`App.tsx:164-167`), which Vite statically folds to `false` in a
production build. That gate was itself the fix for a shipped defect (a runtime-only
`URLSearchParams` check) and is documented in place at `App.tsx:140-160`.

**Conclusion:** in a real farm mount there is no tile, no route, no deep link, no menu and no
redirect that reaches the Attendance screen. Nothing to report loudly.

## 2. The pin

**New file:** `src/clients/mobile-web/src/features/labour/components/__tests__/LabourFeature.attendanceDoorClosed.test.tsx` (3 tests).

No equivalent existed. The three pre-existing assertions all test the *last link only*:
`LabourHub.test.tsx` (Task 18 block, L431/439/446) passes `isPreview` to `LabourHub` as a
prop, and `LabourFeature.test.tsx` (L178/187) reads `isPreview` out of a **mocked**
`useLabourState`. If the derivation `isPreview = farmCtx === null` ever broke, every one of
them would stay green while a real farmer got the door.

This file mocks nothing on that path — real `FarmContextProvider` (fed a real-shaped `/me`),
real `useLabourState`, real `LabourHub`, real `SHOW_ATTENDANCE_TILE`. Only the network
(`labourClient`, `MeContextService`) and device storage (`attendanceLocal`,
`attendanceParked`) are stubbed, plus ReviewSheet's two always-mounted deps.

1. **the pin** — real farm, wire returns a fully populated farm: no `हजेरी घ्या`, no
   `आजची हजेरी`, and none of the three control strings. Positive control asserted first
   (`हजेरी वही` / `तपासा` / `आढावा` present, `fetchLabourData` called with the real farm id)
   so absence cannot be satisfied by a blank screen.
2. **teeth** — the same tree with NO provider (the `?preview=labour` condition) DOES show the
   tile, and never reaches the wire.
3. **no second door** — from the real-farm hub, opening each of the other doors
   (`हजेरी वही`, `आढावा`, `तपासा`) never lands on the capture screen.

**Teeth verified by experiment, not by assertion:** flipping `LabourHub.tsx`'s
`SHOW_ATTENDANCE_TILE` to `true` turns tests 1 and 3 red (`AssertionError: expected <span …>
to be null`, ×2); the flag was restored and `git diff` on that file is empty.

## 3. Follow-up left behind

`docs/superpowers/plans/precision/followup-manual-attendance-door.md` — all three items in one
named place, each with: the exact copy today, what the code actually does (with the wire and
domain evidence that no approval state exists), why it is unfinished, and what "finished"
would mean as an explicit (a)/(b) choice. Carries the binding constraints (Decision 4b, P4/P5,
P7/Constraint 3, P9, P10, the founder economic model, the farmer-facing vocabulary rule) and
the instruction that the pin must be rewritten by the change that opens the door, never
quietly deleted.

Load-bearing findings recorded there:
- **No approval state exists for a mark, anywhere.** Not on the wire
  (`sync-contract/schemas/payloads/attendance_mark.zod.ts` — ids, date, day/night mark, hours,
  contradiction-resolution id, and nothing else), not on the entity (`AttendanceMark.cs` — no
  approved/verified property), not in `RecordAttendanceMarkHandler`. `ReviewSheet`'s तपासा
  queue approves **logs** via `VerifyLogCommand` — a different plane. So `जतन करा →
  मंजुरीसाठी` points at a room that does not exist.
- **The counter is dropped at the call site.** `Attendance.tsx` ~L123 maps only `status` +
  `shift`; `count` (~L61) is never read again, and the wire has no headcount field.
- **`नाव जोडा` duplicates a finished feature.** `FieldOperatorPicker.tsx` already does add-or-
  select-and-attach and is wired into `ReviewSheet`; this button was simply never connected to
  it. Note its P9/B2 rules and that `todaysLabourAssignmentId` is `''` in the preview fixture
  on purpose.

## 4. Gate

| Check | Result |
|---|---|
| New pin, alone | 3/3 passed |
| New pin with the door forced open | 2 of 3 fail (intended); flag restored, file clean |
| Full labour vitest (`src/features/labour`, `--maxWorkers=1`) | **42 files / 471 tests passed, 0 failed, 0 errors** (186s) |
| `tsc --noEmit` | **0 errors** (exit 0, no output) |
| `eslint` on the new file | 0 problems |
| `check-file-sizes` | OK (new file ~190 lines; only the pre-existing quarantined `useVoiceRecorder.ts`) |

**Environment note, so the numbers are readable.** A first pass at `--maxWorkers=2` reported
`40 files / 461 tests passed` plus **2 `[vitest-pool] Failed to start forks worker` errors** —
`LabourFeature.attendanceDoorClosed.test.tsx` and the pre-existing
`LabourFeature.window.test.tsx`. That is a worker-*start* timeout under machine load (23
sibling agents on this box), not a test failure: both files then passed together in isolation
(10/10), and the single-worker full run above is green with zero errors. Same class as the
known mainView-under-full-parallelism baseline.

## 5. Scope discipline

- The three controls were **not** fixed. The door was **not** opened.
- `LabourHub.tsx` is byte-identical to HEAD (the flag flip was an experiment, reverted).
- Multi-User Architecture untouched.
- Changes: one new test file, two new docs. No production code modified.
