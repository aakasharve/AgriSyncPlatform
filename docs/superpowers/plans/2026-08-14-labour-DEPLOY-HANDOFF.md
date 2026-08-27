# LABOUR LANE — DEPLOY HANDOFF

**For:** a fresh session. You do not need the conversation that produced this.
**Branch:** `feat/labour-management-ui` @ `48d58188` — **146 commits ahead of `main`, `main` 0 ahead.**
**Rollback checkpoint:** tag `labour-v1-green` → `69f022d6`. **Do not move, rewrite or delete it.**
**Founder decision on record:** **Option A — constrained onboarding.** Labour recording only, each farmer on their own phone. Harvest, procurement and cost-correction not introduced. Rationale in `2026-08-14-labour-lane-to-live-PLAN.md` §5.
**Founder wants:** live on **web AND APK**. A web deploy alone reaches zero farmers — see §4.

---

## 1. State at handoff — measured, not asserted

| Gate | Result |
|---|---|
| Build (Release) | **0 errors** |
| Backend | **1823 pass / 2 fail** — both pre-existing `AiEndpointsTests` receipt-extraction tests, failing since before this branch |
| Frontend | **1435 / 147 files** |
| Typecheck | **0 errors** |
| File-size gate | **0 violations** |

**Exclude `src/**/REPRO-A*.test.ts` from any frontend run.** Four deliberately-failing defect reproductions belonging to the parallel lane. Including them turns the suite red for reasons that are not this branch's.

**Three database migrations** ship with this: `plot_ids`+`scope` on `daily_logs`, `can_manage_labour_records` on `farm_memberships`, `notes` on `labour_assignments`.

---

## 2. What is shipping

A farmer can record labour that survives a new phone. **8 workers across 3 plots reports 8, not 24.** संपूर्ण शेत reaches the server. Corrections persist and converge across devices. Labour management is a grantable capability and the Mukadam can verify again.

Plus five fixes found along the way: the user-switch erasure that destroyed unsent work · a sync-display freeze after switching accounts · `ExitMembershipHandler`, which never persisted a member's exit · a picker clip that made `जोडा` and `बंद करा` unreachable · four rounds of founder Marathi.

---

## 2b. What a farmer can actually do after this ships

The plainest version, because the rest of this document is written for whoever runs the deploy.

**New — he could not do this at all before:**
1. **Log work for the whole farm** (संपूर्ण शेत). Previously the record was silently dropped — it never left the phone and he was told it saved.
2. **Log work across several plots as one job.** 8 workers on 3 plots now reports **8**. It reported **24**.
3. **See his labour on a new phone.** Workers, hours, wages, names, who was attributed — all reconstruct after a reinstall or a new handset.

**Fixed — it existed but was broken or lied:**
4. **A correction sticks.** Change 8 to 6, reload, it is 6. It used to go back to 8, and a second phone never heard about it.
5. **The status chip tells the truth.** It said "Sending…" forever for everyone. Now it says what it can prove — and when it can prove nothing, it says nothing.
6. **Two people on one phone stop destroying each other's work.** Signing in as a second farmer used to erase the first one's unsent records.
7. **Removing someone from a farm actually removes them.** The exit was never saved; they kept access.
8. **The Mukadam can verify again** — he was excluded from the one job that is most his.
9. **An owner can grant a team member permission to fix labour records** — and the switch is real, not a mock that resets on the next sync.
10. **The "Add worker" button is reachable.** It sat below a clipped card edge; a farmer could not finish adding a worker.
11. **A new farmer sees faint example names** on the empty worker screen, so he knows what belongs there.

**Unchanged but worth stating:** voice and manual logging, worker identity, attendance, approvals, weather on a log, and the day/reflect views all work as they did. Nothing was removed.

### ⚠️ The gap in Option A that this handoff must not hide

**Option A is currently onboarding *guidance*, not code.** Harvest, procurement, cost correction, income and log deletion are **still present in the app**. Not teaching a farmer about them does not stop a curious farmer reaching them — and those are the surfaces with live data-destroying defects owned by the other lane.

**Founder decision needed before onboarding, and it is a real fork:**
- **(a)** Accept it. Onboard a small, known group, tell them plainly which parts to use, and watch. Defensible with 5–10 farmers you can call.
- **(b)** Hide those entries behind a flag until the other lane lands. Small, client-only, and it belongs to this lane rather than theirs.

**(b) is the safer answer if these farmers are not people you can phone.** Do not treat "we did not tell them about it" as containment.

---

## 3. Before you deploy

- [ ] **Founder has run the APK test** — record labour → sync → reload → confirm it survives. This is the only proof that counts; everything else is `fake-indexeddb`.
- [ ] **Founder has seen the chip Marathi on a real screen** — `लक्षात ठेवलं ✓` / `शेतनोंदीत जमा ✓` / `मदत कराल का?`. Widths are measured and safe; whether the words land is his call, and he has said he will correct from real use.
- [ ] Full suite run **twice** at the merge point (three migrations present).
- [ ] `main` still 0 commits ahead. If it has moved, re-verify the merge is clean before proceeding.

---

## 4. The deploy — three steps, and the third is the one people forget

**Step 1 — merge.** `main` is protected; **no direct push.** This goes through a PR and the single required `gate` check. Founder-gated by standing rule.

**Step 2 — deploy the web app.** Use the **`agrisync-deploy` plugin**, never a hand-rolled deploy — that is a standing founder ruling after a previous deviation.
- **Production compute is deliberately hibernated** as a cost saver. It must be woken. Leaving it awake costs **~₹618/month** (measured; the repo's own README claims ₹3,300 and is stale by 5×).
- **RDS snapshot floor before any migration.** Schema and binary move together — no out-of-band DB change.
- Record a `DEPLOYMENT_TRACKER.md` row with prod evidence (`/version` SHA or HTTP status).

**Step 3 — rebuild the APK.** **The Android app bundles its web assets at build time.** Without this rebuild, none of the above exists on a farmer's phone. This is a separate build, not a side effect of step 2.

---

## 5. Migration rollback — read before applying

**The schema is one-way past real data:**
- Migration ① refuses rollback once any `Farm` or `MultiPlot` row exists — rolling back would have to **fabricate a plot**, and its `Down()` deliberately raises rather than invent one.
- Migration ③ refuses once any farmer note exists — rolling back would **delete the farmer's own words**.
- Migration ② drops its column cleanly; its history survives in `ssf.audit_events`.

**Practical rollback:** revert the binary, leave the schema forward. Nothing in the diff requires those columns to be absent. **Put this in the runbook.**

---

## 6. Constrained onboarding — what Option A means operationally

**Safe to onboard:** labour recording, worker identity, attendance, corrections, approvals.

**Do NOT introduce yet** — all owned by the parallel `feat/server-authoritative-architecture` lane, all with live defects:
- harvest and procurement (sales are **never persisted anywhere**)
- cost corrections (**silently rejected**, farmer is not told)
- income recording (**stored as expenditure**)
- offline voice capture (uploads, parses, completes — **the farmer never sees a draft**)
- deleting a log (**deletion never reaches the server; the record returns**)

**One farmer per phone.** Shared-handset isolation has open gaps, also in the other lane.

Those defects cannot destroy data a farmer was never invited to enter. That is the whole basis of Option A.

---

## 7. Two lanes share this working tree — a real hazard, twice realised

`feat/server-authoritative-architecture` is active in the same checkout. During this session it **checked out its own branch mid-work**, and two commits intended for the labour branch landed on theirs. Both were recovered by fast-forward; nothing was lost, but it cost time and produced a wrong report before it was caught.

**If you deploy from here:**
- Verify `git rev-parse --abbrev-ref HEAD` before **every** commit, not once at the start.
- Stage with an **explicit pathspec**, never `git add -A`.
- Untracked files under `docs/superpowers/specs/` and any `REPRO-A*` are theirs. Do not stage them.
- **Better: use a separate worktree.**

---

## 8. Open, not blocking the deploy

- **Owner cannot remove a member from a farm** — the capability does not exist; only self-exit does, fixed this week. Founder decision pending on whether to build it.
- **Two spray-safety questions claim agronomist approval nobody gave** — off-branch, first in `marathi-offbranch-pending.md`. A false claim of authority on chemical-safety advice.
- **The chip's sub-AA contrast** — founder has reserved this for his own examination. Do not change it.
- **A live Glacier transition at 365 days** on the uploads bucket, present in AWS and in no infrastructure code, conflicting with the "farmer reviews last season" access pattern. Nobody recorded that decision.
- **11 stale code comments** still quote the old chip strings. Two are `.tsx`. One grep to finish; list is in the chip commit's report.

---

## 9. How this branch was built — the standards that made it hold

Worth keeping, because they caught things nothing else did:

- **Prove every guard by mutation** — revert the fix, watch the *named* test fail, restore byte-identical, verify by hash. A guard nothing fails without is decoration, and one specified guard was removed after exactly this test proved it decorative.
- **Never call a failing test a flake without measuring.** It came up three times; **twice it was a real defect**, one of them a production bug where a Dexie listener began watching only after its first read completed, silently losing anything written in the gap.
- **Automation can reach what a farmer cannot.** A viewport check passed against a button behind an `overflow:hidden` clip, because `page.click()` scrolls a box a human cannot. Assert geometry, never that a click succeeded.
- **The controller was wrong repeatedly and corrected by implementers** — a ruling that deleted a true warning and created a launch blocker; a "no precedent in the repo" claim that a single `git grep` refuted; an "inert and harmless" verdict on a table that turned out to be the only home for delete intent. **Check what still writes to a thing, not only what reads it.**

> The farmer records once. The server remembers. And the app never tells him something is safe when it is not.
