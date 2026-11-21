# Workflow-led setup: design reference (notes for the product owner)

Files: `index.html` (single file, no external scripts or fonts), `decisions.json` (6 decisions, option A only), this file.
Nothing was built in the app. The page reads the repo's real code only through the verified copy of its words (see "Honesty checks").

## Test hooks

`index.html#f=<path|signin|water|plots|invite>&s=<step>&nofx=1&solo=1`

* `f` and `s` open that flow at step `s` with sample answers filled for every earlier step (the step itself is unanswered). `s` past the end stays on the last step.
* `nofx=1` removes all animation, transitions and sound.
* `solo=1` hides everything except that one phone, at the top left, 390 px wide. In solo mode the single visible phone is `id="phone"` and fills the viewport height (use 390 x 844 to match the BEFORE pictures). On the normal page each phone is `id="phone-<flow>"` (720 px tall).
* `alt=1` takes the other branch of the sample: water asks the drip questions (14 steps), plots takes the seed branch (10 steps).
* Reload the page after changing the hash (it is read once at load).
* `window.__flows = {path:4, signin:19, water:11, plots:10, invite:10}` (counted from the flow definitions with the default samples). `window.__after` lists the hook step behind each AFTER file.

| flow | N | what the steps are |
|---|---|---|
| path | 4 | states of the road: 1 two stops done, 2 left halfway (resume), 3 three done, 4 all done |
| signin | 19 | 1 greeting+language, 2 mobile number, 3-13 the notice (11 pages), 14 the tick, 15 code, 16-18 permissions, 19 arrival |
| water | 11 | 1 type, 2 name, 3 motor count, 4 HP, 5 motor name, 6 phase, 7 power source, 8 drip yes/no, 9 24-hour ring, 10 summary, 11 done (motors repeat 4-8; drip yes adds pipe, filter, litres) |
| plots | 10 | 1 crop, 2 variety, 3 plot name, 4 area, 5 seed/saplings, 6 company or nursery name, 7 quantity or plant age, 8 date, 9 summary, 10 done |
| invite | 10 | 1 who, 2 which plots, 3 pick plots, 4 money yes/no, 5 name, 6 mobile, 7 attendance worker, 8 summary, 9 code/QR/link, 10 done |

### AFTER pictures to create (28 files, 390 x 844 solo screenshots of `#phone`)

Each AFTER frame on the page carries its own `data-hook`. File = `img/after-<flow>-<n>.png`, hook step in brackets:
path 1-4 = [1,2,3,4]; signin 1-6 = [1,2,3,14,16,19]; water 1-6 = [1,2,4,6,9,10]; plots 1-6 = [1,2,3,4,8,9]; invite 1-6 = [1,2,3,4,8,9].
Until the files exist the frames show a striped "AFTER picture comes from the build step" placeholder and the browser logs 404s for exactly those 28 files (expected).

## Rebuild
`python -X utf8 _work/build.py` writes `index.html` and `decisions.json` from `_work/src/*`. Tests: `node _work/test.js` (needs the static server on 3086), `node _work/check-real.js`.

## Taps and typing (measured on the demos, shortest path, mic answer = mic tap + one "बरोबर" tap)
* water 10 one-tap answers, nothing typed (today: 4 taps to the motor step + at least 6 fields; today's count leaves the timetable out)
* plots 12 touches, nothing typed (today: 6 taps + 5 typed or filled fields)
* invite 11 touches, nothing typed, including sending the link (today: at least 4 taps + the plots sheet + up to 3 typed fields)
* signin 13 touches, nothing typed: greeting 1, number by mic 2, "सगळं ऐका" 1, "पुढे" after the notice 1, tick 1, "पुढे" 1, code by mic 2, three permissions 3, arrival 1. Today (from the pictures): 3 screens, a typed number plus password or code, one tick, a notice of over 400 words behind a link.
* path: one tap ("चला") per stop.
The test script asserts these numbers; the page text uses `_work/taps.json` written by the test.

## Same fields as today vs new behaviour

Same fields, nothing added: water (source name+type, motor name, HP, phase, power source, drip yes/no, pipe size, filter, litres per hour, the cut window per phase); plots (name, area+unit, variety, seed/saplings, company or nursery, quantity+unit or plant age, date); invite (role, plots, money permission, name, mobile, attendance worker).

New behaviour, marked next to the phones on the page and in `decisions.json`:
1. Sign-in: the phone permissions are asked on these screens, one at a time. Today the page only explains and the phone asks at first use.
2. The notice is read page by page with "ऐका" and "सगळं ऐका". The words are the app's own and unchanged; the voice in the demo is a timed sweep, not speech.
3. The setup hub as a road, with resume and "ऐका" instead of "?".
4. The electricity cut window is asked inside the water flow (today a separate card); the alternate-week timetable is not drawn and stays in today's screen.
5. Money question skipped for कामगार and "स्वतःचं काम" (money does nothing there; today the form shows it and the server refuses with `authority_idle`).
6. Date: today's two choices ("आज", "आधी केली") with a big day-month-year picker instead of the phone's own date input; "आज दिवस N" is today's own count.
7. Crop tiles show six crops (the six photos supplied). Today's long searchable picker stays and is not drawn. Not shown, not decided: adding several plots in one go.
8. Suggested names are shown as a tap ("सुचवलेलं"). The plot name suggestion is variety + number; today's own-pattern suggestion (G16 after G15) stays.

Consent order: the tick comes before the code is sent (as today, the button stays off until the tick and nothing is saved before it). The brief listed the code first; I followed the app. Password sign-in, the new-phone check and "कोड किंवा QR ने सामील व्हा" are not redrawn.

## Honesty checks done
* `_work/check-real.js`: 88 strings marked `R('...')` in the flows were found word for word in the repo source (setupLabels, WaterSourceWizard, ElectricityTimingConfigurator, addPlotWords, plotStartCopy, invitationCopy, plotScopeCopy, firstRunCopy, translations, cropMasterData). Everything else on the phones is new draft Marathi and needs the usual review.
* The consent notice text was extracted by script from `consentNotice.ts` (Marathi block) and `voiceSwitchWords.ts`; `test.js` proves all 37 notice strings appear unchanged across the 12 notice/tick pages.
* 19 + 11 + 10 + 10 + 4 steps screenshotted and looked at; text sizes, tap targets, Latin words, "AI", emoji, overflow at 1200 and 390 px, reduced motion, keyboard focus, the dial by pointer and by keyboard, the feel panel switches, the road (leave, resume, finish) all tested.
* Phone text sizes: question 30 px, answers 22 px, helper lines 17 px, reading pages 20 px, smallest text 15 px (chips and dial labels). Main answers are at least 64 px tall (dial handles have a 64 px touch area).
* Latin on phones is only what the app itself shows in Marathi mode: proper names (Super Sonaka and the other varieties as stored, plot names G1.., the company name, AgriSync, Data Protection Board of India), HP, OTP, QR, and the "English" language button.

## Could not verify / open questions
* Sound could not be heard here (headless browser); the tones are created with the Web Audio API and nothing threw. Buzz is chosen by `navigator.vibrate` on an Android user agent; I could not test a real Android phone, so on a computer you see the glow.
* Real read-aloud speech is not in the demo. Which voice reads the notice (and whether it works offline) is a build question.
* The crop's own date word (छाटणी for grapes, पेरणी for wheat, लागवड otherwise) is my reading of today's per-crop word; only grapes were checked against the schedule notes.
* The notice length: the brief says about 449 words; counting the Marathi fields I get about 405, so the page says "over 400 words".
* Sample plot names for sugarcane (S1-S3), worker names, the code 1234-5678 and the QR drawing are invented samples and labelled so.
* "Money" appears once as a permission question (invite); no amount is shown or asked anywhere.
* The six-crop tile list, whether permissions move into sign-in, and "सगळं ऐका" autoplay all need a founder decision before building.

## Design plan (frontend-design process)
Plan v1: sage page, rounded cards, numbered markers, one phone per section. Review against the brief found it read like the generic card-kit default, so I changed it: no card chrome around text blocks (hairlines instead); the road line is the one repeated motif (phone progress line, the step road beside every phone, the setup path itself); the first thing on the page is a working question with a breathing mic, not a headline over stats; BEFORE sits on a paper-grey band, AFTER on a mint band; one quiet palette (emerald, mint, stone, warm cream only inside phones, amber unused because nothing "needs attention"); sentence case everywhere except the two functional BEFORE/AFTER tags.
Fixes after looking at screenshots: hidden attributes were overridden by display rules (keypad showed open); long phone numbers wrapped; plot ticks overlapped text; dial labels collided with the centre number; long notice pages clipped (now the card scrolls and text is 20 px); the mic now sits under the question and the answers sit at thumb height; the sticky count line moved into the footer.
