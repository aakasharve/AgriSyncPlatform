# FOUNDER DECISION HANDOFF

**Date:** 2026-08-15 · **Branch:** `feat/server-authoritative-architecture` @ `458b7c78`
**Purpose:** the decisions that are yours, each with what it blocks and a recommendation — so you can
decide deliberately rather than under deploy pressure.

**Companion documents.** What is broken and why: `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md`.
What it costs a farmer: `2026-08-14-COMPLETE-GAP-REGISTER.md`. This document is only the decisions.

---

## 1. WHAT CHANGED THIS SESSION

Work that needed none of your decisions is done, verified and committed. Five commits.

**Twenty-three reproduced defects are closed.** The open-defect suite went from **48 failing
assertions to 25**. Nothing was marked green to get there — every remaining failure still runs and
still fails loudly.

| Fixed | What a farmer stops losing |
|---|---|
| Fourteen fields erased by his own sync | Machinery hours and rental, the diesel expense, tomorrow's planned spray, the disturbance that stopped work, **the words he actually spoke**, the total he stated himself, the Understanding score, the weather, the crop phase and day number, his deletion, and the record of which AI read his voice |
| His `CONFIRMED` silently downgraded to draft | The server said nothing about verification and the app read silence as a demotion |
| A deleted log coming back | Two separate causes: the deletion was preserved but the column every list actually reads was still computed from the rebuild, and the delete erased the freshness marker |
| **The freshness marker erased on nearly every save** | This was bigger than the delete. `batchSave` is the main confirm-and-save path and it had the same bug |
| One unreadable-queue error flattening every unsent record | The guard caught its own error and answered "nothing is pending", silently switching itself off |
| A killed app stranding a photo or a voice note forever | The status had no owner. The honesty chip said "stuck, go check" and every door it pointed at was painted on |
| Money entries duplicating on re-enqueue | Three commands minted a fresh key each time, disarming both server dedupe layers |
| **A refused correction failing invisibly** | The server's real refusal code never matched the app's list, so it burned five silent retries and parked where no screen reads. It now reaches the conflicts screen |

**Verified, unpiped, exit codes recorded:**

```
merge gate     147 files · 1435 tests · 0 failed · exit 0
open defects     4 files ·   66 tests · 25 failed  (was 48)
lint           0 errors · 361 warnings   (CI enforces 600)
file sizes     all under 800 lines
architecture   91 passed · 0 failed
```

Guards were mutation-proved: breaking one makes its **named** assertion fail, and the restore is
hash-identical. "23 failed" is not evidence; `machinery_survives_the_first_pull_after_acknowledgement`
is.

**One change you should know about because it changes what a green CI means.** The four reproduction
files are now committed — they had never been on any branch, so the evidence for ~50 claimed defects
existed only on one machine. They run as their own CI step that reports and does not block. The merge
gate answers *"did this change break something?"*; it does not answer *"is the backlog empty?"*.
Nothing is skipped and no count is fudged. The alternatives were considered and rejected in writing:
a skipped test reports Passed while asserting nothing — which this repo has already shipped once, for
months — and the `it.fails` marker turns *any* failure green, including a broken fixture.

---

## 2. WHAT IS NOT FIXED, AND WHY IT IS NOT AN OVERSIGHT

Twenty-five assertions are still red. They fall into four groups, and **none of them can be closed by
being more thorough** — each needs a decision or a contract change.

1. **Two farmers on one phone can still see each other's data.** Untouched this session. See D4.
2. **Income is still stored as expenditure**, and six fields are still dropped at the outbox
   boundary. Needs the wire format to carry direction — a server change.
3. **An offline voice note still produces nothing.** Needs a component that does not exist.
4. **Four collections still come back fabricated** — a flood irrigation from a canal returns as drip
   from a field. This one I hit head-on today and it is D1 below.

---

## 3. THE DECISIONS

Ordered by what they block. Every one is written so you can answer it in a sentence.

---

### D1 — Two rules in the code contradict each other. Which one wins?

**This is the most interesting thing I found today, and I stopped rather than pick.**

When your phone pulls a log back from the server, four collections — crop activities, irrigation,
inputs, observations — are **rebuilt by guessing**. The server only stores "a task happened"; it does
not store what kind. So the app fills the gaps with fixed literals:

- flood irrigation from a canal → comes back as **drip irrigation from the field**
- a curative fungicide for a named disease → comes back as a **preventive pesticide**
- an urgent observation you spoke → comes back as **normal**, typed by hand
- a skipped task → comes back **completed**

That is inventing values a farmer never said — the thing your doctrine forbids most plainly.

**But the fix collides with a rule already in the code, defended by four tests.** One of them says it
outright: *"Preservation must be scoped to the fields the wire cannot express — otherwise it would be
a different bug, one that ignores the server."* Those tests are part of the labour work, and the
programme says to protect that read-back, not redesign it.

Both rules are right about different things. The wire **can** say a task happened and **cannot** say
what it was.

So I stopped at the intersection both rules agree on — the fields the wire has no word for at all —
and left the four collections alone, with a long comment in the code explaining exactly this. The
fabrication is still live, still reproduced, still named.

| Option | What it means |
|---|---|
| **(a) Fix the wire format so it carries the real values.** **Recommended.** | The only fix that ends the guessing instead of relocating it. It is already scheduled work, not new work. Costs a contract change and a deploy |
| (b) Let the phone's copy win wholesale | Fast, but it means a task added anywhere other than that phone never appears on it — and it contradicts four shipped tests |
| (c) Merge item by item | **Do not.** The app mints a fresh id per send for manually-entered items, so the merge matches nothing and keeps both copies. Machinery is sent as a task and rebuilt as an activity, so the farmer would see a phantom tractor beside his real one, **each with its own rental and fuel cost.** That is duplicated rupees |

**Your call:** (a), (b), or (c). I recommend (a) and it does not block the merge.

---

### D2 — A money correction still cannot land. Fixing it needs an id changed.

Today the app sends two field names the server refuses, so the **whole** correction is thrown away.
I fixed the invisible half — the refusal now reaches the conflicts screen instead of vanishing. The
correction still does not land.

**Why I did not just rename the fields.** The server validates that id as a plain UUID. The app mints
it with a `madj_` prefix. Renaming the field without changing the id's shape makes the check throw
*before* the correction is even queued — so it would stop reaching the outbox at all. **That is
strictly worse than being refused at the server**, and the same file documents this exact failure
ninety lines above.

| Option | What it means |
|---|---|
| **(a) Change the id to a plain UUID and rename together.** **Recommended.** | Closes it properly. Touches an id already stored on farmers' phones, so it needs a small migration |
| (b) Leave it refused-but-visible | The farmer at least sees it failed and can act. Honest, but his correction still does not reach the server |

**Your call:** (a) or (b). Recommend (a), scheduled with the money work, not rushed.

---

### D3 — The 154-commit tower has never reached production

`main` is **0 ahead, 154 behind**. Every fix above becomes another commit on a tower that has never
shipped. The security work below has nowhere to land until this merges.

| Option | What it means |
|---|---|
| **(a) Merge the tower now, then land containment on top.** **Recommended.** | It is green. Holding a security fix behind an unrelated review is the worse risk |
| (b) Cherry-pick containment onto a fresh branch, ship it alone | Smaller review, but costs a rebase and splits the history |
| (c) Hold both until you have accepted the labour work | Leaves the shared-handset leak live |

**Your call:** (a), (b) or (c). **This one blocks everything else.**

---

### D4 — The shared-handset leak: fix it before or after the merge?

Two farmers on one phone can read each other's harvest, procurement, finance settings and vocabulary.
Worse, the leaked records carry **workers' names** — people who never used your app and never agreed
to anything.

**I deliberately did not touch this today.** It is the one item where doing it badly is worse than
waiting: the routing that decides whose data you get **fails open** — when ownership is unknown it
hands over the previous farmer's database rather than refusing. Closing that touches 299 call sites
across 84 files, and a half-done version crashes the app on boot for everyone. It needs its own
session and a real phone.

Every other gap on the list can be fixed later and the farmer recovers. **This one cannot be
un-leaked.**

| Option | What it means |
|---|---|
| **(a) Its own session, before any farmer beyond your reach.** **Recommended.** | Until then the rule is absolute: **one farmer per phone, no exceptions** |
| (b) Rush it into this deploy | It is the highest-blast-radius change in the programme |

**Your call:** (a) or (b). And regardless — is anyone other than you currently sharing a handset?

---

### D5 — Nobody has run this on a real phone

Every proof on this branch is a simulated database in a test runner. Your own plan says the
clean-device journey **must not be a unit test**. It currently is one.

Twice this week reading and running gave different answers: an automated check passed against a
button a farmer physically cannot reach, and a test everyone called flaky was a real production bug.

**Fifteen minutes, and it is the only thing on this list I cannot do:** record a log with machinery
and an expense → let it sync → force a pull → check the machinery, the expense and the total are
still there. On today's build that fails *before* any wipe. After this session's work it should pass.

**Your call:** run it before merge, or accept the branch unproven on hardware. Recommend before.

---

### D6 — Your database password is on the public repo

Six files. Postgres also accepts connections from anywhere. Open since **8 August** and it belongs to
no current lane, which is exactly how it has stayed open. Rotation is the only fix.

**Your call:** rotate now, or name who owns it and by when.

---

### D7 — Voice recordings are stored as plain text

The encryption exists as code and has **zero callers** — every recording falls through to the old
path. Your 30-day retention ruling was made before this was known.

There is also a bucket in production receiving raw recordings under weaker encryption than intended,
which appears in no configuration file, and which **swallows every write failure** — so a farmer gets
a success while his evidence silently stops being kept.

**Your call:** does the 30-day ruling still stand now that the window is plaintext? And do you want
the swallowed failures surfaced first, before anything else about that bucket is touched? (Doing it
the other way round makes every write fail *silently*.)

---

### D8 — Six smaller rulings, none blocking

| # | Question | Recommendation |
|---|---|---|
| a | Should an owner be able to remove someone from their farm? The capability does not exist | Build it — but it is not urgent while nobody has a team on the app |
| b | Is "labour comes back on a new phone, machinery and expenses do not" acceptable for a first cohort? | Your answer sets the order of the next lane's work |
| c | Are harvest and procurement **product truth** worth storing on the server? | Until you say yes, they exist only on one phone |
| d | May a farmer's database ever be deleted from a shared handset, and what warns him first? | Deleting his history is irreversible — no agent should decide it |
| e | The 365-day cold-storage rule on photos: keep or remove? | **Remove.** One "show me last season" tap costs 13× that photo's entire annual storage bill. The rule saves ₹45/month, and it has never yet triggered — so removing it today is free |
| f | Harvest, procurement, cost correction, income and log deletion are still reachable in the app. Hide them behind a switch, or accept? | Hide them if you onboard anyone you cannot phone. "We did not tell them about it" is not containment |

---

## 4. WHEN YOU DEPLOY — FIVE THINGS THAT WILL BITE

Not decisions. Facts to hand whoever runs it.

1. **Production is not hibernated — it takes a nap every night.** An enabled schedule stops the
   database and the host at **01:00 IST**, every day, regardless of any manual wake. A heavy deploy
   plus your manual acceptance run, done late, **will straddle that boundary and lose both
   mid-flight.** Disable both rules for the window; re-enable after.
2. **This is a heavy deploy, not a static push.** The branch carries 10 database migrations. It needs
   a pre-deploy snapshot — the database is single-AZ, so a manual snapshot is the only rollback floor.
3. **The cache must be cleared explicitly.** The web shell has no cache header and inherits a 24-hour
   lifetime. Without invalidation, returning users stay on the old, leaky shell **for up to a day**
   after a cross-farmer fix.
4. **A web deploy reaches zero APK users.** The Android build bundles the web files at build time. For
   a leak fix, a new APK is a gate item, not a nice-to-have.
5. **Two lanes share one working tree** and it has already caused a wrong report once. Use a separate
   worktree.

---

## 5. THE SHORTEST PATH FROM HERE

1. **D3** — decide the merge. Everything waits on it.
2. **D5** — fifteen minutes on a real phone. It turns this session's work from *tested* into *proven*.
3. **D6** — rotate the password. It is unrelated to all of the above and has waited a week.
4. **D4** — schedule the isolation session before any farmer you cannot phone.
5. Everything else can be answered in writing whenever you get to it.

**The test that decides whether any of this is finished:** if an acknowledged farmer record can
disappear, change meaning, leak to another farmer, or need the original phone to rebuild it — it is
not finished. After this session, **fewer of those are true than yesterday, and the ones that remain
are named.**
