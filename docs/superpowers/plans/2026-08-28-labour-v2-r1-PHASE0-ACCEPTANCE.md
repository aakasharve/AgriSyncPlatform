# Phase 0 — Founder Acceptance Gate (Labour V2 Release 1)

**Branch:** `feat/labour-v2-r1` · **HEAD:** `35fb763b` (15 commits) · **Baseline:** `origin/main` @ `a7784b18`
**Status:** code-complete, every task reviewed. **Not merged. Not deployed.**

> Code-complete ≠ approved. Nothing deploys until you tick the box at the bottom.

---

## What Phase 0 actually did

It did not add attendance. It repaired **truth defects** — places where the app stated as fact
something you never told it. One rule governs all of it:

> **No record at all ⇒ "we don't know", shown as `—` or withheld.
> A record that exists and contains no labour ⇒ a real `0`.**

Nine planned tasks, of which **two were deleted** after the evidence said their premise was wrong.
**Six more were added** along the way — each one the same fault found a layer further out.

---

## How to run it

```bash
# 1. API  (from the worktree root)
dotnet run --project src/AgriSync.Bootstrapper

# 2. Web  (separate terminal)
cd src/clients/mobile-web && npm start
```

Then open **http://localhost:3000** and log in as the test user (`8888888888` / `Testuser@123`).

No `.env` setup is needed — the web app falls back to `localhost:5048` on its own, and warns loudly
rather than looking silently dead if the API is not running.

Labour is behind the labour tile on the home screen.

---

## The five checks

### 1. Money never invents a number

**Where:** Labour → the week dashboard (stat tiles under **या आठवड्यात**).

**Expect:** No **जास्त दिलं** ("overpaid") tile at all, and no **₹0** balance. The tile is *omitted
entirely* rather than showing zero — you will see a gap in the grid, and the gap is deliberate.

**Why it was wrong:** the farm has no job-card evidence, and the old code read "no evidence" as
"zero", then told you that you had overpaid someone.

**Also fixed:** while the screen is loading, or when the server is unreachable, it no longer shows
numbers at all — you get a spinner, or an error with a working retry.

- [ ] Checked

### 2. The app no longer promises attendance it cannot take

**Where:** Labour hub, and the review sheet when you approve a log.

**Expect:** Nothing says **बोलून हजेरी घ्या** ("take attendance by voice") or
**बोलून नोंदवलेली हजेरी**. The review sheet no longer says **मंजूर केल्यावर हजेरीही निश्चित होते**
("approving also settles attendance").

**Why it was wrong:** none of that existed. Seven separate false claims were removed — the plan had
found only two.

- [ ] Checked

### 3. A "no work" day survives a round trip

**Where:** Save a day as **no work**. Open the same farm on a second device (or a private window)
and pull.

**Expect:** It still reads as a no-work day. It must **not** come back as an ordinary work day.

- [ ] Checked

### 4. One day's crew is recorded once

**Where:** Type (don't speak) a day that includes labour, and save it.

**Expect:** One labour record, carrying **the hours you entered**.

**Why it was wrong — the most serious defect found.** Typed entries were writing the crew **twice**,
and the second copy always said **8 hours, "assumed"** — a number nobody stated, sitting beside your
own. It could never have carried your real hours: that field does not exist on the path that built
it. Now proven against a real database by a test that runs on every commit, and that was itself
proven able to fail.

- [ ] Checked

### 5. An unstated headcount shows a dash, not a zero

**Where:** The week dashboard, **मजूर-दिवस** tile.

**Expect:** `—` when no log this week stated how many people worked. A real **0** only when you
logged days and none involved hired labour. Never the word "null" — it used to print that literally.
Half-days count as **0.5**, not rounded to 1.

- [ ] Checked

---

## Not in this phase, by your instruction

- **Vishwas / trust score** — set aside.
- The attendance screen and weekly ledger stay hidden (`SHOW_ATTENDANCE_TILE=false`,
  `SHOW_LEDGER_TILE=false`). No Phase 0 task flips them: un-hiding means finishing, which is Phase 3.

---

## What I decided while you were away, and why

You had three options for the remaining fake zeros. **The question changed before you answered**, so
I acted on the part that stopped being a judgement call, and left the part that still is.

A review found the offline screen showed not only wrong *numbers* but a wrong *sentence*:
**अजून कोणी कामगार जोडलेला नाही** ("no worker has been added yet") — to a farmer who may have twelve.
You cannot make a sentence say "unknown", so option 2 could not have fixed it, and option 3 would
have knowingly shipped a false statement about a farmer's own workforce.

The app now **withholds content it does not have**, using the error banner and retry that already
existed. No new screen, no new copy, **not one new Marathi string**. If you would rather that state
looked different, it is one revert.

Two things protected while doing it:

- **A genuinely empty farm still says it is empty.** If data loads fine and you really have no
  workers, that message is true and stays. The suppression keys on *the fetch failed*, never on
  *the data looks empty*.
- **The retry button actually retries.** It could not before. Proven by a probe: one server call at
  start-up, still one after sitting idle, two only after a deliberate tap — so it cannot loop on a
  metered connection.

**Still genuinely yours:** whether **मजुरी** and **नोंदी** should show *this week's* numbers or
*all-time* ones. They sit under a heading reading **या आठवड्यात** (this week) but carry farm-lifetime
totals. Not invented — mislabelled. Fixing it changes which numbers you see, so it is a product call.

---

## Carried forward (recorded, not lost)

- **Existing duplicate rows in production are not repaired** and there is no backfill path. The fix
  stops new ones. Recommend one read-only count before Phase 1, since attendance will be built on
  top of these rows.
- **`उचल` (advance) has the same defect shape** as the money bug: hardcoded ₹0 server-side with no
  advance engine behind it. Needs its own task.
- **The false-empty-sentence bug is not only in labour.** The same shape is live in the job cards,
  worker profile and compliance screens — `JobCardsPage` says **कोणते काम कार्ड नाही** on the same
  trigger. Deliberately **not** fixed here: each needs new Marathi on screen, which needs your
  approval. Recommend one small task after this ships, with all the copy approved in one batch.
- `LedgerDerivationLabourTests` is Docker-gated and runs in **no** CI workflow. Task 2b routed around
  it; the category gap itself (22 classes) is a repo-wide question.

---

## Evidence

- Build clean with warnings-as-errors · **1,794** domain tests · **97** architecture tests
- All **14** real-database labour test classes pass · **195** app-side labour and session tests
- 8 test classes need Docker, which is off by your standing preference — they did **not** run, and
  are **not** counted as passing
- Character-level check confirms **zero** new farmer-facing Marathi strings

**Founder approved Phase 0: [ ]**
