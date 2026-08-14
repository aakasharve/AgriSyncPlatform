# LABOUR LANE → LIVE — EXECUTION PLAN

**Status:** Draft for founder approval. **No code written against this yet.**
**Branch:** `feat/labour-management-ui` (57 commits, green) → `main` → prod
**Date:** 2026-08-14 · **Cofounder mode active**
**Change class / risk tier:** UI + client-presentational · `trust_tier: medium`. **No server, no schema, no sync mechanics.**

**Written after reading, in full:**
`G:\VALIDATION\Planning Directive — Server-Authoritative Trust Architecture.md` (the other lane's mandate) ·
`docs/superpowers/specs/2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md` (their discovery) ·
`docs/AGRISYNC-DOCTRINE.md`

---

## 0. The finding that governs this plan

**I read their directive to find what I could safely take. The honest answer is: almost nothing I proposed.**

Yesterday I drafted a "week-one blockers" list of six fixes. Checked against §§4, 5, 11, 12, 18 and 25 of their directive, **all six are inside their mandate.** Not adjacent — inside.

| My proposed fix | Their directive | Verdict |
|---|---|---|
| §4.1 pull destroys 14 fields | §4 round-trip fidelity · §15 partial records · §21 read-back before removal | **THEIRS** |
| §4.2 offline voice produces nothing | §11 one sync subsystem · §18 failure states · §25 scenario 2 | **THEIRS** |
| §4.3 deleted logs resurrect | §25 scenario 15, named explicitly | **THEIRS** |
| §4.7 cost corrections silently rejected | §11 sync states · §12 idempotency | **THEIRS** |
| §4.10 income filed as expenditure | §4, and it is *their own worked example* of "survives technically, changes meaning" | **THEIRS** |
| §4.13 double-tap creates two cost entries | §12, which names "two payments" verbatim | **THEIRS** |

**So: everything in my earlier block 1 is neglected. It is not mine to do, and doing it would collide with a lane already in flight.** Their directive is deliberately class-level — *"solve the class of architectural problem, not merely the currently discovered broken fields"* — which means picking off individual faces of it in a parallel branch is exactly the conflict they warned against.

**This plan is therefore much smaller than yesterday's, on purpose.** That is the correct outcome of the check you asked for, not a reduction in ambition.

---

## 1. The boundary — one sentence each

**Their lane owns:** anything where the answer to *"is this fact safe if the phone dies?"* is currently no. All server work, all sync mechanics, all media pipeline, all data-ownership classification, all ~50 matrix defects.

**This lane owns:** what a farmer *sees and touches*, where the underlying data is already correct. Presentation, reachability, wording, and the labour feature that is already built and green.

**The test I applied to every candidate task:** *does fixing this change what reaches the server, what is stored, or how it syncs?* If yes → theirs. If no → mine.

---

## 2. Global constraints — binding on every task

1. **Touch no server code.** Nothing under `src/apps/**`, no migration, no `sync-contract/**`, no generated payload, no allow-list.
2. **Touch no sync mechanics.** Not `logSyncMutationService.ts`, not the reconcilers, not `MutationQueue`, not the workers, not `db.outbox`.
3. **Change nothing about what is persisted or transmitted.** If a change alters a stored shape, it is theirs.
4. **Add no new farmer-facing Marathi.** The founder is the authority. Invented Marathi has shipped wrong once already.
5. **Never fabricate.** No default, no placeholder value, no invented figure (`P4`).
6. **Low-friction capture is sacred** (`P9`). No new required field, modal, warning or nag.
7. **Nothing merges** until the Founder Acceptance Gate is ticked. **Nothing deploys** until §7 passes.
8. **If a task turns out to touch their surface, STOP and report.** Do not negotiate the boundary mid-task.

---

## 3. What is already done and merely needs to ship

All complete, all green, all on the branch today.

- [x] **Labour Phase 2, phases 1–6.** A farmer can record labour that survives a new phone; 8 workers across 3 plots reports **8, not 24**; संपूर्ण शेत reaches the server; corrections persist and converge; labour management is a grantable capability; the Mukadam can verify again.
- [x] **The user-switch erasure fix.** Two people on one handset no longer destroys the first one's unsent work.
- [x] **A production sync-display defect** — a Dexie listener that started watching *after* it started reading, silently losing anything written in the gap.
- [x] **`ExitMembershipHandler`** — a member who leaves now actually loses access. It never persisted before.
- [x] **The picker clip** — `जोडा` and `बंद करा` were unreachable on the worker screen. A farmer could not finish adding a worker.
- [x] **Four rounds of founder Marathi**, 38/38 byte-identical to the FINAL string set.

**Measured at HEAD:** build 0 errors · backend **1823 pass / 2 pre-existing** · frontend **1433 / 147** · typecheck 0 · file-size gate 0 violations.

---

## 4. Tasks

Each is independently committable and revertible. Binary checkboxes.

### T1 · Merge Labour Phase 2 to `main`
- [ ] Full suite run at merge point, twice (three migrations present)
- [ ] `main` is 0 commits ahead — confirm the merge is still clean at the moment of merge
- [ ] Merge; `labour-v1-green` remains untouched as the rollback point
- **Done when:** `main` carries Labour Phase 2 and CI is green.
- **Why first:** the other lane branched from this work. Everything downstream is easier once it is on trunk, and it is the reference implementation their §5 names as the model.

### T2 · Complete the Marathi
- [ ] Founder supplies two short chip phrases (~13–15 Devanagari characters)
- [ ] Apply via the i18n system; no inline strings
- [ ] Verify against the measured container budgets — chip ~13–15 chars, toast 38/line, badge 45/line, drawer header **34 hard clip**
- **Blocked on:** founder. **Everything else in this plan can proceed without it.**

### T3 · Farmer-facing honesty on surfaces this lane owns
Their §5 names the log-save honesty layer as exemplary and says *"extend it; do not redesign it."* This task extends it **only where the underlying data is already correct** — i.e. wording and state display, never the mechanism.
- [ ] Inventory every surface that makes a save/sent claim, and mark each **theirs** or **mine**
- [ ] Raise only the mine ones; list the theirs ones for their lane
- [ ] No new Marathi without founder copy
- **STOP condition:** any surface whose claim is wrong *because the sync is wrong* is theirs. Report, do not fix.

### T4 · Device verification
- [ ] Founder runs the APK: record labour → sync → reload → confirm it survives
- [ ] Founder confirms the Marathi reads right on a real screen
- **Blocked on:** founder. **This is the only proof that counts** — everything else is `fake-indexeddb`.

### T5 · Deploy
- [ ] Founder Acceptance Gate ticked (§6)
- [ ] Deployed via the `agrisync-deploy` plugin — never hand-rolled
- [ ] Three migrations applied; RDS snapshot floor taken first; schema and binary move together
- [ ] `DEPLOYMENT_TRACKER.md` row with prod evidence (`/version` SHA or HTTP status)
- **Runbook note, mandatory:** migration ① is **one-way** past the first `Farm`/`MultiPlot` row; migration ③ is one-way past the first farmer note. Rollback past those points requires a documented decision about those rows.
- **APK note:** the APK bundles web assets at build time. **A web deploy does not reach APK users.** An APK rebuild is required or none of this reaches a farmer's phone.

---

## 5. Can this face real farmers? — the honest answer

**Labour recording: yes.** It round-trips, it survives a new device, it does not inflate counts, and it tells the truth about what has and has not reached the server.

**The app as a whole: no — and not because of anything in this lane.**

The blocking defects are all in the other lane's mandate:
- a log's machinery and expense fields are destroyed on the first sync, **on the farmer's own phone**
- an offline voice note uploads, parses, completes — and the farmer never sees a draft
- deletions do not reach the server, so deleted records come back
- income is stored as expenditure
- harvest sales are never persisted anywhere at all

**Therefore there are exactly two ways to have farmers this week, and both are the founder's call:**

**Option A — constrained onboarding.** Onboard for **labour recording only**. Every farmer on their own phone. Harvest, procurement and cost-correction not introduced. This is defensible today: those defects cannot destroy data a farmer was never invited to enter.

**Option B — wait** for the other lane's containment to land.

**A third option that is not available:** onboarding for full use this week. The data-destroying defects are real, they are in flight elsewhere, and this lane cannot honestly close them.

---

## 6. 🛑 Founder Acceptance Gate

- [ ] Founder has read §0 and accepts that yesterday's block-1 list is **withdrawn as out of scope**
- [ ] Founder chooses **Option A or Option B** in §5
- [ ] Founder supplies the two Marathi phrases (T2)
- [ ] Founder has run the device test (T4)
- [ ] Founder authorises the merge (T1) and the deploy (T5)

**Nothing merges and nothing deploys until every box above is ticked.**

---

## 7. Explicit deferrals — named, not silently dropped

Their directive §26.J requires anything discovered and not repaired to be named. From this lane:

- **All ~50 matrix defects** → theirs.
- **Photo compression** → their §10. Still worth doing early: it is a reliability fix (a 4 MB upload on rural 2G fails) before it is a cost one, and 20× cheaper before farmers upload than after.
- **Owner cannot remove a member from a farm.** The capability does not exist — only self-exit does, and that was fixed this week. Needs a founder decision on whether to build it; it is a server capability, so it belongs to their lane if built.
- **Two spray-safety questions claim agronomist approval nobody gave.** Off-branch, recorded in `marathi-offbranch-pending.md`, first in that file. **This is a false claim of authority on chemical-safety advice** and outranks every copy item on that list.
- **The chip's sub-AA contrast** — founder has explicitly reserved this for his own examination.
- **A live Glacier transition at 365 days on the uploads bucket**, in AWS and in no infrastructure code. It conflicts with the "farmer reviews last season" access pattern, which is the one case where cold storage costs *more*. Nobody recorded that decision.

---

## 8. What I am asking for, in one line

**Read §0, pick A or B in §5, and send me the two Marathi phrases.** Everything else in this plan I can run without you.
