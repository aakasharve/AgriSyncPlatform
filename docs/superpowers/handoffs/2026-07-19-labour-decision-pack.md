# FOUNDER DECISION PACK — Labour Management (शेतमजूर) → Production

**Written:** 2026-07-19 · **Branch:** `feat/labour-management-ui` @ `38552ba9` (30 ahead / 11 behind `origin/main`)
**Prod today:** backend `/version` = `5e65d32b` (hibernated by design) · frontend built from `cb538602` · APK v1.0.7
**Sources:** the 532-line deploy audit (11 blockers) + a second, adversarial sweep that found ~40 more issues, of which the ones below survived verification.

---

## THE ONE-PARAGRAPH VERSION

The labour feature itself is well built. The problem is not the feature — it is that **this laptop lies to us**. Local development connects to the database as a superuser, which means the security rules that guard every farmer's data are switched **completely off here** and switched **fully on in production**. On top of that, the local database was never built from the real migration files, so those rules don't even exist on this machine, and the two tests that were supposed to catch this **report "passed" in CI without ever connecting to a database**. That single blind spot is why the headline approve button works perfectly here and fails 100% of the time in production, why every expense a farmer records never leaves his phone, and why photo uploads have been dead in production since May. None of this is new damage from this branch — most of it has been broken in production for weeks or months and nobody could see it. There are **7 decisions** below. Everything else I fix without asking.

---

## PART A — WHAT I FIX WITHOUT ASKING

**The un-regression work (must happen first, no debate)**
1. Merge `origin/main` into the branch — otherwise deploying from here **deletes the welcome screen, the redesigned consent screen, the mascot fix and the Setup Hub legibility pass from production** and rolls the version label back to 1.0.5.
2. Resolve the 4 merge conflicts by hand, keeping BOTH `main`'s welcome gate AND the labour arrival-scroll — with the welcome early-return placed *after* the hook call, or the app crashes.
3. Confirm `scripts/deploy-s3.sh` and `.gitattributes` land with the merge (the codified S3 upload that exists because a hand-typed one caused the live DPDP cache exposure on 2026-07-18). Correct the wrong path recorded in the prior audit.
4. Clean the working tree: 1 modified file, ~40 loose screenshots and scratch files, 4 untracked onboarding files that collide with `main`'s tracked versions. Build only from a clean worktree.
5. Bump the version to 1.0.8 in all four places.

**The prod-only failures (the "works here, dies there" family)**
6. Fix the tenant-scope gap so approvals actually reach the server — two-phase, proven against a real database as the production role, not the in-memory fake.
7. Fix the same gap on the sibling actions in whichever breadth you pick in Decision 1.
8. Fix the second, dead approve button (`verify_log_v2`) that has never worked anywhere — but **only after** fix 6 lands, otherwise a dead-but-honest button becomes a silently-lying one.
9. Fix the rejection classifier: 40 of 46 server error codes are currently misread as "try again later", so failures die silently in a hidden queue and the farmer's own "Retry all" button is a no-op on exactly those rows.
10. Make failed approvals reportable at all — today the only error the code can catch is a local disk failure, so the carefully-written Marathi failure messages are unreachable.
11. Add the missing server-side log + audit row at the one place that knows a mutation failed, so this class of bug can never again be invisible in production.
12. Stop side-car failures being logged as *"non-blocking; log is durable"* — that wording tells the next reader to stop investigating.
13. Add a fitness test so any future migration that creates a table without granting the app permission fails the build (this is a boot-crash-loop trap waiting for the next feature).

**The money plumbing**
14. Fix the expense ID bug — the app mints `me_<uuid>` where the server contract demands a bare UUID, so **every single expense a farmer records is rejected on his own phone before it ever hits the network**, silently, with no error, while the finance page shows it as saved. One line.
15. Make expense capture idempotent so a re-save can't double-count a day's labour.
16. Stop the finance page and the wage book measuring different farms/periods without saying so.
17. Stop the app calling an overpayment "उचल" (advance) — it currently tells the farmer his worker owes him money that was never advanced.

**The screen honesty fixes**
18. Fill the तपासणी approval cards with the actual content (count, shift, task, amount) — today they show a name and a raw `2026-07-19` date and nothing else, so approving is blind.
19. Add proper Marathi empty states everywhere a list can be empty (people, ledger, plots, insight) instead of headings floating over nothing.
20. Show a loading state instead of ₹0 — on a weak signal the wage book currently renders a confident "you owe nothing" while it is still fetching.
21. Add a network timeout so a stalled request becomes an honest error instead of hanging silently for minutes.
22. Delete the hardcoded "दैनिक ₹300" line on the worker page — it shows the same invented wage for every worker.
23. Stop leaking English and `2026-07-13`-style dates into a Marathi-only screen.
24. Refresh the "तपासा 76" badge after approving, so it doesn't still say 76 after clearing the whole queue.
25. Fix bulk approve — approving 76 items currently fires ~76 sequential network round-trips *after* telling the farmer it's done.
26. Stop the wage book being served from a stale cache on slow connections (money screens should error honestly, not show yesterday's numbers).
27. Stop a 429 rate-limit response logging the farmer out and wiping his saved login (today a transient throttle is treated as a revoked password — and with no OTP SMS, he cannot get back in).
28. Add a build-time guard so a frontend bundle can never ship without the backend address baked in (today it silently builds a bundle that points at nothing).

**The proof and paperwork**
29. Run the labour endpoint tests locally, port the four money assertions to a suite that actually runs, and delete the four false "CI runs this" comments checked into the codebase.
30. Prove the migration applies cleanly on a database built from zero, as the production role — it has **never been executed by Entity Framework anywhere on Earth**.
31. Point the deploy health check at the probe that actually touches the database (`/health/ready`), not the one that returns "healthy" without checking anything.
32. Fix the rollback trigger — "restart count above zero" is the *normal* state after a wake, so as written it would roll back a perfectly good deploy.
33. Read production's real migration history before touching anything, with the connection string pinned (there's a stale leftover database locally that already nearly caused a mis-diagnosis).
34. Branch manifest, DEPLOYMENT_TRACKER row, promote the spec, reconcile the declared change surface, and rewrite the Founder Acceptance Gate — which is currently **unsatisfiable**, because it asks you to query two tables that do not exist.
35. Correct the `ErasureWorker` privacy manifest, which becomes factually false the moment this migration lands — regardless of your answer to Decision 5.

**Two things the audit worried about that I checked and cleared** — recorded so nobody burns deploy time on them: weather failure cannot cost a farmer a log (it's isolated behind a savepoint by design), and the old `SET LOCAL` row-count bug cannot hit this migration. Also: the S3 signature bug is already fixed and live in production, and the rate-limit "everyone shares one bucket" worry is **refuted** for our actual server setup.

**Blocker 9 has dissolved — no decision needed.** The audit asked you to choose what to do about months of approvals stuck in phones flushing at once. It won't happen. Those approvals were rejected, misclassified, retried 5 times over about a minute, and then **permanently parked and forgotten** — they are already lost, and the "Retry all" button cannot revive them. So there is no burst to fear. I'll fix forward and count what's actually parked during the deploy. Nothing to resurrect; there are no real farmers yet, so the real loss is zero.

---

## PART B — THE DECISIONS

---

### DECISION 1 — How wide do we fix the "works here, dies in production" family?

**The situation.** There is one bug repeated in about a dozen places. When the app sends anything it saved while offline — an approval, an expense, a photo, a new plot — the server forgets to tell the database *which farm this is*. Production's security rules then match nothing, and the action fails. The farmer sees a green tick; the server got nothing. It has been fixed in exactly one place (voice logs) and left broken everywhere else. This is the **third** time this exact bug has reached a deploy gate.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **1a** | Fix only the approve button | ~2 hours | The wage book works but the farmer still cannot record an expense or upload a receipt photo. You ship a working approval attached to a permanently empty ledger. |
| **1b** | Fix approve + all money actions + photo uploads (everything a farmer can actually reach today) | ~half a day extra | Three families that no farmer can reach yet (job cards, soil tests, compliance) stay broken. Tracked, not shipped-broken. |
| **1c** | 1b plus those three families | ~1 more day, **and a new database migration** to add read policies for three more tables | Enlarges this release's database surface beyond "3 columns on one table", which re-triggers the strict migration lane and adds real deploy risk for features nobody can use yet. |

**CTO recommendation: 1b** — it makes everything a real farmer can touch actually work, without adding database risk to this deploy for features that aren't reachable. The remaining three go on the tracker with a named owner.

---

### DECISION 2 — Do we make the machine able to catch this class before we ship again?

**The situation.** This laptop connects to the database as a superuser, so the security rules are bypassed entirely — and the local database was never built from the migration files, so those rules **don't exist here at all**. Worse: the two tests written specifically to catch this look for a database that CI never creates, fail to connect, and then report **"PASSED"** having asserted nothing. A green CI badge on this repo currently tells you nothing about whether tenant security works. That is why five separate prod-breaking bugs sat undetected.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **2a** | Nothing now; rely on production smoke tests | Free | Every fix in Decision 1 ships **unproven**. You'd be trusting a laptop that has already been wrong five times. Against your "real farmers" bar, this is the option I'd rule out. |
| **2b** | Fix CI only — make it create the database, and make an unrunnable security test **fail loudly** instead of falsely passing | ~1 hour, blocking | Every future pull request genuinely tests production's security posture. But the laptop stays blind, so bugs still get *written* blind and only caught later. |
| **2c** | 2b **plus** rebuild the local database from the real migrations and run dev as the production role | ~half a day, and things that "worked" will start failing honestly | Highest confidence; local and production finally behave the same. Cost is a short painful session where genuine bugs surface all at once. |

**CTO recommendation: 2b now (blocking this deploy), 2c immediately after** — 2b is the cheap change that turns a lying green tick into real proof, and it's the only thing that lets you trust Decision 1's fixes. 2c is the permanent cure and shouldn't wait long.

*Note: whichever you pick, do NOT let anyone "fix" this by pointing local dev at the production role today — that would break the two tests that are the only thing standing between this bug family and your farmers.*

---

### DECISION 3 — The money story: what does "दिलं" mean, and what happens to money the app has been throwing away?

**The situation.** Three separate money problems, one decision. (1) On your own seeded farm the finance page shows **₹22,200 of labour spend** and the wage book shows **दिलं ₹0** — because they count two different categories of the same payments, so बाकी (still owed) is overstated by the full amount. (2) Every expense a farmer records is **rejected on his own phone before it ever reaches the network** — it shows on the finance page from local storage only, and is destroyed by a reinstall or a new phone. (3) When a farmer says "four men, ₹400 each", the phone calculates ₹1,600 and the server deliberately refuses to multiply and stores ₹0 — so two screens show two numbers for the same sentence. Plus the deferred bug where "चार माणसांनी काम केलं" renders as **"0 people"** — which the prompt makes the *common* case, not an edge case.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **3a** | दिलं = **all labour money paid out**. Plus: fix the expense drop, show "—" instead of an invented ₹ when a total wasn't stated, and fix the headcount so "चार माणसांनी" shows 4 people | ~half a day. Some payments show as a farm-level total rather than per-person until job cards are used. Historical logs start displaying the headcount they always contained | The two pages reconcile and बाकी becomes correct. Residual: per-person attribution stays partial until job cards are in real use. |
| **3b** | Keep दिलं = job-card wages only, and split the **finance** page into "wages via job card" vs "other labour spend" so the farmer can see why they differ | Similar effort, but the farmer must learn a distinction he never asked for | Strictly correct accounting, but बाकी stays wrong until every payment flows through a job card — which nothing forces today. |
| **3c** | Fix only the expense drop; leave the definition mismatch and the display bugs | ~1 hour | Your stated #1 invariant — one entry reads identically on every screen — is knowingly violated on the first money screen a farmer opens. |

**CTO recommendation: 3a** — it matches what a farmer actually means by "what I've paid out", makes the two screens agree, and the headcount fix is a *correction* to logs that were always right underneath, not a regression (no real user has seen the old rendering).

*Not recommended either way: attempting to rescue expenses already stranded on test handsets. There are no real farmers yet, so the real loss is zero, and a recovery migration touching money records carries more risk than the data is worth.*

---

### DECISION 4 — What actually appears on screen in version 1?

**The situation.** Several parts of the labour screens are still the pre-backend demo. **हजेरी घ्या** shows crops that aren't his, lets him set today's headcount, says **"जतन झाले"** (saved) — and saves nothing, anywhere. **पैसे द्या** shows **"पैसे दिले ✓ — नमुना"** after he's handed over real cash; the tick is what he'll read, not the word "नमुना". **विश्वास द्या** promises auto-approval after 25 clean days and can never trigger. The **उचल** tile is hardcoded to ₹0 while advances are near-universal in Maharashtra daily-wage labour — so बाकी is too high by every rupee he's advanced. The week arrows just show a toast. And **the people list is structurally empty in production** — workers can only join via QR + OTP, and prod SMS is a dev stub, so no worker can join at all.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **4a** | Ship all of it as-is | Nothing | A farmer is told attendance was saved when it wasn't, and told money was paid when nothing was recorded. This is the option most likely to end the relationship with your first farmers. |
| **4b** | Ship the parts that work; hide the unfinished ones (remove हजेरी घ्या save, the पैसे/उचल buttons, विश्वास section, उचल tile, week arrows, हजेरी वही tile) and add honest Marathi empty states with a QR "add a worker" call to action | ~half a day. The approved 4-tile layout ships with 3 tiles | Nothing on screen is false. Residual: the wage book is genuinely empty until OTP works — but it now *says why*, instead of looking broken. |
| **4c** | Hold the whole labour feature; ship only labour logging + approvals | Least risk of a bad first impression, but you lose the headline | You've built a wage book nobody sees, and the approval flow alone is a thin release. |

**CTO recommendation: 4b** — an honest empty screen with a clear next step is recoverable; a screen that confirms a payment that never happened is not. Also included: **तपासणी stops calling his own logs "your team's entries"** and gets a 14-day bound so the queue can't grow forever.

---

### DECISION 5 — Worker names and privacy (Blocker 7)

**The situation.** One line in this branch switched on a component that pulls real worker names out of the spoken Marathi and writes them into **four** places in production. Production holds **zero** worker names today. One of those four places is an analytics table with database rules that make rows **physically impossible to update or delete** — once a name lands there, it cannot ever be removed. These workers are not our users: they gave no consent, received no notice, and cannot file an erasure request. The component also merges two different people named रमेश on the same farm into one record.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **5a** | Revert the one line for this deploy. Ship labour clean; land worker names as their own change once ADR 0026 is signed and there's an erasure path | **Nothing.** The labour feature never reads worker names, and the only test lost has never executed anywhere | Zero privacy exposure. The identity-ladder product vision is delayed, not cancelled. |
| **5b** | Ship it, but do the erasure work first — give the two worker tables a real scrub path, decide what to do about the un-deletable analytics rows, correct the manifest, make the erasure test actually test something | ~1 day, plus a legal question you cannot resolve in code (names in an append-only table) | You start accumulating third-party names before the notice wording exists. The रमेश-merge flaw becomes live. |
| **5c** | Ship as-is and accept the gap | Nothing today | A compliance artifact in your repo would state, in writing, something that is factually false — and the analytics rows are permanent. |

**CTO recommendation: 5a** — this is a clean 0-to-1 flip that costs nothing to defer and cannot be undone once it happens. Your own 2026-07-18 note already lists notice wording and an erasure path as required before production. Names are the product; they just need the paperwork first.

---

### DECISION 6 — Which surface are we shipping to: web only, or web and the phone app?

**The situation.** The Android app does not load the website — it runs a copy of the web app baked in when the APK was built. **A web deploy does not reach APK users at all.** If your farmers are on the APK (they will be), the labour feature simply will not appear on their phones after a "successful" deploy — and you'll check your own phone, see nothing, and reasonably conclude the deploy failed.

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **6a** | Web only this release; APK later | Nothing extra now | Nobody on the APK gets the labour feature. Fine — as long as you *know*, so you don't misdiagnose it. |
| **6b** | Web now, then build and publish APK v1.0.8 from the merged commit | One extra workflow run + installing on a real device with app data cleared | The feature actually reaches farmers. Risk: if the version number isn't bumped in all four places, Android silently refuses the install and the "update" changes nothing. |
| **6c** | Hold the web deploy and ship both together | Simplest story | Loses your deploy-first-then-merge sequence, which is the safer order and which you specifically chose. |

**CTO recommendation: 6b** — web first (so we prove it in production before trunk absorbs it), then the APK from the merged commit. It's the only path that puts labour in a farmer's hands, and I'll handle the four version bumps.

---

### DECISION 7 — Does production keep going to sleep at night?

**The situation.** Every night at 01:00 IST a scheduled job **stops the server and the database**, and wakes them at 05:30. It's an intentional cost saver from the pre-launch period, and the README itself says "DISABLE AT LAUNCH". A farmer who opens the app before dawn — normal for irrigation and labour muster — gets a dead app. Separately, a full deploy takes 45–120 minutes, so a deploy started after ~23:00 can be **mid-migration** when the job pulls the database out from under it. That is exactly the 2026-05-22 incident (schema and app out of step for 21 hours).

| Option | What it means | What it costs you | What could still go wrong |
|---|---|---|---|
| **7a** | Keep the nap; just avoid deploying late | Free | Relies on a tired person remembering a rule at exactly the wrong moment. Farmers hit a dead app before dawn and conclude the app is unreliable — the hardest thing to recover from. |
| **7b** | Disable the nap for the deploy night only (one command each way), keep it otherwise | Free, and removes the worst-case entirely for this deploy | Deploy is safe, but the pre-dawn dead window remains for farmers. |
| **7c** | 7b **plus** turn the nap off permanently before the first real farmer | Roughly **₹500/month more** | The app is up 24/7, which is the bar you just set. |

**CTO recommendation: 7c** — 7b for this deploy regardless (it's one command and removes a 21-hour-incident-shaped risk), and turn it off for good the day before the first real farmer logs in. ₹500/month is the cheapest reliability you will ever buy.

---

## PART C — HOW TO REPLY

One line, seven answers:

```
1b, 2b, 3a, 4b, 5a, 6b, 7c
```

That string is my full recommendation. Change any letter you disagree with. If you want to talk one through instead of deciding it, write the number and "discuss" (e.g. `1b, 2b, 3 discuss, 4b, 5a, 6b, 7c`).

---

## PART D — WHAT IS STILL TRUE AFTER ALL SEVEN DECISIONS

These do not go away no matter what you pick. Go in knowing them.

**1. No new farmer can sign up, and no worker can join.** Production SMS is a dev stub — the flag defaults to "fake" and there is no guard, so a deploy that doesn't explicitly set it ships the stub silently. You've accepted this one gap. But be clear on the knock-on: the wage book's people list **cannot** populate until it's fixed, because workers join only via QR + OTP. Also — the stub currently writes **live OTP codes and phone numbers into production log files, kept 7 days**. I'll suppress that regardless. And the eventual guard must ship in the *same* deploy as the real MSG91 credentials, or the backend will refuse to boot at all.

**2. This migration has never been run by Entity Framework anywhere on Earth**, and production **refuses to start** if a migration is pending. The columns exist locally only because they were added by hand. I will prove it on a clean database first, but the first real execution is deploy day. If it fails, the failure mode is a restart loop — total API outage, not a labour outage.

**3. Production's actual database history has never been read.** We expect it to be exactly one migration behind. That's a written claim, not a fact, and it's only checkable after we wake production. If it's sparse the way the local one is, the boot migration will try to replay ~25 migrations against a populated schema — the 2026-05-22 shape.

**4. The full-lane rehearsal against a clone of the production database is physically impossible from this machine** (the database sits in a private network). That gate will correctly refuse and escalate to you for a one-off authorisation. Expect it; don't let anyone pre-declare the workaround.

**5. Production will be running an unmerged commit** between the deploy and the merge. That's your chosen sequence and it's defensible, but one of the deploy gates becomes tautological as a result. Accept it knowingly.

**6. Even at option 1c, some things stay broken.** Job cards, soil tests and compliance actions taken offline still fail. Nobody can reach them today, but that's a "nobody has tried yet", not a "it works".

**7. Photo uploads to the production storage bucket have never once been proven to work.** The signature bug is fixed and live, but no attachment has ever completed a round-trip against the real bucket. I've added it to the smoke tests. It could still fail on a permission we've never exercised.

**8. Rate limiting will bite at your first group onboarding.** Ten login attempts per minute per internet address. A village demo or an FPO meeting where several farmers sign up together will start failing with a generic error, and Indian mobile carriers put many users behind one address. The lockout consequence is fixed (item 27 in Part A); the limit itself is a named follow-up.

**9. One small server, no redundancy.** Single-instance AWS is a 99.5% commitment — roughly 3.6 hours of allowable downtime a month. Fine now, not fine at scale.

**10. The legal items are still open**, and they're yours, not engineering's: notice wording for farmer-entered worker names, an erasure path for a worker who never used the app, and the Marathi worker-name dictionary still marked `LEGAL_REVIEW_PENDING`. Decision 5a defers *storing* the names; it does not close the paperwork.

**11. ADR 0026 (Worker Identity) is proposed and unsigned.** Nothing in this deploy may create a worker-identity table or any name-matching link. The "two people named रमेश merge into one" flaw stays dormant under 5a — and stays dormant is not the same as fixed.

**12. A deploy can still fail and need a rollback.** The plan is sound: the three new columns can safely stay, the binary swaps back in minutes, and trunk is untouched until you merge. But the standing rule holds — **if it fails twice, we stop and go back to the laptop.** No third attempt.

**13. And the honest one:** this pack found roughly forty issues in a feature that passed 562 frontend tests, 1077 domain tests, 77 architecture tests, a clean typecheck and a clean lint. Every one of those numbers was true. None of them could see any of this. Decision 2 is the one that changes that — everything else on this list is a symptom of it.