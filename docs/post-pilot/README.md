# Post-pilot development (PARKED)

**Status:** parked on 2026-11-21 by the founder. Nothing here is built in the app.
**Branch:** `task/plr-d10-post-pilot`, cut from the test branch `task/pre-launch-repair-d10-redesign` at `56b95d15`.
**Rule:** this branch is never merged to `main` and is not part of the test APK. It is picked up only after the
real-user pilot feedback is in, and only when the founder says so. Pushing the branch to GitHub is allowed
(same rule as every `task/plr-d10-*` branch); a pull request to `main` is not.

Today this branch holds documents and design prototypes only, no app code. The founder's second feature
(built separately, to be released after the pilot feedback) is meant to land on this branch too.

## What is parked here

| What | Folder | State | Next step after pilot feedback |
|---|---|---|---|
| Workflow-led setup: a before/after study of the setup screens turned into "the app asks, you answer" flows (setup road, sign-in and notice, water and power, crops and plots, invite someone), with soft sound and buzz | `workflow-led-setup/` | Design and working prototype done. The founder has not approved any of the six decisions. | He looks at pilot feedback, then approves or changes each flow. Effort and risks: `EFFORT-ESTIMATE-2026-11-21.md`. |
| Ask cards for the whole app (five card kinds) | `ask-cards/` | The founder PARKED it on 2026-11-21: wrong direction (voice stays the way of working, and the daily "आज काय काम झालं" flow stays exactly as it is). Kept only as a reference. | Do not build. |
| The founder's second feature | (to be added) | Not here yet. | Add a row here with its name and branch when it lands. |
| Pre-dated fill: the owner records earlier days' work by voice, marked "आधीची नोंद · मालकाने भरली", with no verification step (founder 27 Nov Q11-A) | `predated-fill/` | Two screen options made 28 Nov (V-A: link on the plot page; V-B: tap an empty day on the farm overview; CTO recommends V-B). The founder MOVED IT TO POST-PILOT on 28 Nov: "we will build it after pilot and give it as update". Not picked yet. Today the app already lets any member add work to a past day with no marker. | He picks V-A or V-B, then build: server marker + owner-only + 30-day limit (about 2-2.5 days), phone (1.5-3 days). Code facts and doctrine notes are in the options page. |
| Scripts used to build the approval page and the phone page | `tools/` | Reference. Paths inside are placeholders to fill in. | Reuse when a new before/after page is needed. |

## How to open the prototype

- Open `workflow-led-setup/index.html` in a browser. It needs the `img/` folder beside it and nothing else
  (no network, no external fonts).
- Test hooks, step counts and the list of what is new behaviour versus today are in `workflow-led-setup/NOTES.md`.
  The full design brief is `workflow-led-setup/BRIEF.md`.
- Rebuild the page from its sources: from the `workflow-led-setup` folder run `python -X utf8 _work/build.py`.
  The checks are `node _work/test.js` (needs a static server on port 3086) and `node _work/check-real.js`.
- The screen-capture scripts are not saved here because they carry the demo sign-in. The pictures they made are
  `img/b-*` (BEFORE screens, taken on 2026-11-21 from the PC test app with demo data) and `img/after-*`
  (AFTER pictures, drawn by the prototype, not by the real app).

## Honest limits of what is parked

- The prototype is plain JavaScript on a single page. Nothing in it is wired to the real app, and the mic on its
  phones is a drawing.
- Sound and buzz were never tried on a real Android phone. The read-aloud in the demo is a timed sweep, not speech.
- Only 88 strings on the phones are word-for-word from the app. The rest is new draft Marathi that needs the usual review.
- Not drawn: name and village, machines, drawing a plot or farm boundary, which machines work a plot, several power
  cuts a day with repeat rules, changing something already saved, password or new-phone sign-in, join by code.

## Working folder

On this PC the folder `E:\APPS\Running App Versions\AgriSyncPlatform\.claude\worktrees\post-pilot` is a sparse
checkout (only `docs/post-pilot`) because the drives were full on 2026-11-21. Inside it, run
`git sparse-checkout disable` when the whole repo is needed. To open the branch somewhere else:
`git worktree add <folder> task/plr-d10-post-pilot`.

## Before anyone builds from this

1. Read `docs/AGRISYNC-DOCTRINE.md` and `EFFORT-ESTIMATE-2026-11-21.md`.
2. The founder's rules for this design: voice stays; the daily voice flow, its waiting screen and its result screen are
   untouched; only static, long-read or many-tap screens change; big text, one thing at a time, soothing sound and buzz;
   no fabricated numbers; the farmer is never told something untrue.
3. A plan with a Change Surface (DB, backend, frontend, cross-cutting) and a founder acceptance gate comes before any code.
