# LOCKED DECISIONS — Labour Management → Production

**Locked by the founder: 2026-07-19.** Source pack: `2026-07-19-labour-decision-pack.md`.
These are binding for the build. Any agent that wants to deviate must escalate, not decide.

| # | Decision | Founder's choice | Note |
|---|---|---|---|
| 1 | Breadth of the "works here, dies in prod" fix | **1c** — fix ALL of it, including job cards, soil tests, compliance | Wider than the CTO recommendation (1b). Adds a NEW migration granting read policies to 3 further tables → enlarges the DB surface and keeps this in the strict migration lane. Accepted knowingly for "nothing broken". |
| 2 | Make the machine catch this class | **2b first, then 2c** | CI fixed to actually provision a DB and to FAIL LOUDLY when a security test cannot run; then rebuild local DB from migrations and run dev as the restricted runtime role. |
| 3 | Money semantics + money bugs | **3a** | दिलं = ALL labour money paid out. Fix the expense-drop (`me_<uuid>` vs bare UUID). Show "—" instead of an invented total when none was spoken. Fix headcount so "चार माणसांनी" renders 4, not 0. |
| 4 | What ships on screen in v1 | **4b** | Ship what works; HIDE unfinished (हजेरी घ्या save, पैसे/उचल buttons, विश्वास section, उचल tile, week arrows, हजेरी वही tile). Honest Marathi empty states + QR "add a worker" CTA. तपासणी stops calling the owner's own logs "your team's entries"; add a 14-day bound. |
| 5 | Worker names + privacy | **5b** — ship names, but do the erasure work FIRST | Deviates from the CTO recommendation (5a = defer). REQUIRED sub-work, see below. |
| 6 | Delivery surface | **6b** | Web deploy first (prove in prod), then build + publish APK v1.0.8 from the merged commit. Version bumped in ALL FOUR places or Android silently refuses the update. |
| 7 | Nightly hibernation | **7c** | Disable for deploy night (one command each way) AND permanently before the first real farmer (~₹500/month). |

## Decision 5 — the sub-questions the founder's choice does NOT resolve, and the ruling taken

5b requires shipping worker names. Two things it leaves open; both are handled as follows (escalate if you disagree):

1. **Un-deletable analytics rows.** `analytics.events` carries `DO INSTEAD NOTHING` rules on UPDATE and DELETE — a `worker.named` event embedding a raw name can never be scrubbed or removed, at any layer. Code cannot make an append-only row deletable.
   **RULING: stop writing the raw name into analytics entirely.** Emit a non-identifying reference (worker id / stable hash) instead of `name_raw`. Then there is nothing to delete, and the erasure story closes without touching the append-only rules.
2. **The same-name merge flaw.** `WorkerNameProjector` find-or-creates on exact normalised name per farm, so two different real people named रमेश on one farm collapse into ONE record. Harmless while worker rows are admin-only analytics; a real hazard the moment names are shipped and any reputation/money attaches.
   **RULING: fix before shipping names** (do not let a known identity-merge bug go live under 5b), or gate the projector so it cannot merge across distinct assignments. Escalate if the fix proves non-trivial.

Remaining erasure work required by 5b: give `ssf.workers` and `ssf.worker_assignments` real scrub dispositions; correct the now-false `ErasureWorker.cs:99-104` manifest claim about `ssf.labour_assignments`; make `ErasureWorkerAnonymizationTest` actually seed names and grep for them (today it seeds none and asserts only a count — false assurance).

## Standing constraints (unchanged)

- **Nothing touches live prod until a deploy is explicitly run.** Verified 2026-07-19: branch never pushed (remote has only `main`), live prod `/version` = `5e65d32b` (deployed 2026-07-09), and the new labour endpoint returns 404 on prod.
- Sequence is **deploy → verify in prod → only then merge to main**.
- Deploying from this branch REQUIRES `origin/main` to be merged in first, or the deploy un-ships the welcome screen, consent redesign, Setup Hub legibility pass and rolls the version label backwards.
- Money invariant: one labour entry must read identically on log, reflect, finance and labour-management screens.
- OTP/SMS remains a dev stub — accepted, known, out of scope. No worker can join via QR until it is fixed.
