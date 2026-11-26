# Voice flow v2: speak in 3 taps, calm steps after stop, one saved screen that closes itself (design)

**Spec id:** `voice-flow-v2-2026-11-23` · **Date:** 2026-11-23 · **Base:** `task/plr-d10-rc1` at `61447ea0` (the ShramSafal TEST app line) · **Plan:** `docs/superpowers/plans/2026-11-23-voice-flow-v2.md`
**Status:** UX approved by the founder 2026-11-23 (prototype *sathi-ring*, blocks v2–v6). Not built. Lines marked *(my call)* are the plan writer's and can be overruled.
**Scope:** phone only, behind the new flag `VITE_VOICE_FLOW_V2`. **No server change, no DB change, no change to how a log is saved or synced.** Flag off = the app exactly as today.
**Private mirror:** the cofounder OS keeps specs in `_COFOUNDER/specs/_active/`, which is not in this checkout; the CTO session copies this file there so the PR can reference the id.

---

## 1. The farmer's journey (approved)

1. **Log page unchanged.** Work home → green door "झालेले काम सांगा" → crop → plot (`LogEntryFlow` + `CropPlotStepper`). Start = 3 taps.
2. **Mic card.** Once a plot is chosen, the mic slot becomes a card: "आता बोला", the crop·plot line, a big mic (~148 px) with a **7-second ring**. Tap = start now. No tap: recording starts by itself after 7 s, and Sathi's bubble says "आता बोला — मी ऐकतोय". An example sentence. A link "थांबा, अजून प्लॉट निवडायचे आहेत" stops the ring. **Each new plot tap restarts it.** The typed way in ("बोलता येत नसेल तर इथे लिहा" → "लिहून सांगा") stays.
3. **While recording — silence help, hints only (P9).** Before he has spoken: 4 s → one example; 9 s → a card with 3 prompts (काम / मजूर / औषध किती); 16 s → "काही सुचत नसेल तर थांबवा दाबा — आवाज जतन होईल". After he has spoken and goes quiet ~5 s (or at 60 s): a popup above the red stop "काम सांगून झालं? तर खालचं लाल बटण दाबा" and the stop pulses. Driven by the **real input level** of the open microphone (`useMicLevel`); nothing covers the stop button; nothing blocks.
4. **After stop — calm step list** (replaces the Shram Sathi waiting screen while the flag is on): आवाज जतन केला → शब्द लिहून घेतले → कामं वेगळी केली (part chips) → प्लॉट तपासला → औषध आणि खत ओळखले (product chips with type) → जतन झालं. A progress bar that moves **only in whole steps**. Every tick is a real event (§3). No timer, no percentage (P4).
5. **Saved screen** (replaces the top of the result while the flag is on), top to bottom: place chip + day chip (existing move-day sheet when allowed) + "आज N वेळा सांगितलं" + "आज कोणी सांगितलं"; one card: "जतन झालं ✓", the badge row, the big existing clip player "तुमचा आवाज ऐका", the existing meter (server DFES score only); "तुम्ही काय दिलं" (existing product tanks → product card); the 8 parts with value or red "सांगितलं नाही" (red = the ONE mic for that part); his words with "श्रम साथीला हे का समजले?" tiles and the unclear box; Sathi's question; mix banner; extras; edit buttons; audience row (owner); refused / money banners; earlier recordings in a fold; the speaker line for non-checkers; a big blue "शेतीचा आढावा बघा" that opens today's full result screen unchanged (the owner's "पक्कं आहे" stays there).
6. **Bottom bar:** big round mic "आणखी सांगा" + "३० सेकंदात बंद होईल" draining bar. Any touch → back to 30. Product card open or clip playing → paused. At 0 → back to the work home + toast "आजचं काम जतन झालं ✓ — परत बघायचं असेल तर शेतीचा आढावा मध्ये बघा".

## 2. What does not change
- The log is already saved before any result shows (`useVoiceAutoSave` → `useLogCommands.handleAutoSave` → Dexie write → `create_daily_log` enqueue). v2 adds **no** save step and touches **no** sync.
- Owner approval stays one deliberate tap ("पक्कं आहे" on the full result screen) with basis heard / read. Auto-approval is **deferred**: the server's `ReviewBasis` accepts only `heard` | `read` (`src/apps/ShramSafal/ShramSafal.Domain/Logs/OwnerConfirmation.cs:10-16`).
- "तपासा आणि जतन करा" (`CheckSaveHost`) stays for `unclear`, `otherPlot` and `notWritten`.

## 3. Real events behind each step (verified on `61447ea0`)
| Step | Ticks when | Where it is said |
|---|---|---|
| आवाज जतन केला | the clip row is written on this phone (`persistProcessingVoiceClip(…, 'parsing')`) — "फोनवर सुरक्षित", never "सर्व्हरवर" (P10) | `infrastructure/ai/BackendAiClient.ts:373` |
| (typed) तुम्ही लिहिलेलं मिळालं | the typed text is sent to the parse | `BackendAiClient.ts:411` |
| शब्द लिहून घेतले | the parse answer arrives **with** a transcript (Sarvam STT + structuring run in one server call; the separate live-transcript stage is off: `useStreamingParse: false`, `infrastructure/voice/types.ts:181`) | `app/hooks/useVoiceAutoSave.ts:117` (sink entry) |
| कामं वेगळी केली | same answer, parts it filled | same |
| प्लॉट तपासला | the sink's plot check passes (`movesThePlot` false) | `useVoiceAutoSave.ts:121` |
| औषध आणि खत ओळखले | same answer has input rows (step not drawn when it has none) | same |
| जतन झालं | `onWritten` (the phone's durable write) | `useVoiceAutoSave.ts:142` |

Steps 2–5 therefore tick **together** when the answer arrives. That is the truth of today's pipeline, shown as it is.

## 4. Decisions recorded
- **V2-1** The countdown arms **only on a plot tap made on this screen**, never on arriving with a plot already chosen (back from a result, a pinned question, the हजेरी door, saying one part again, the ONE mic from "आणखी सांगा"). Otherwise "मागे" or auto-close would open the mic by itself 7 s later. *(my call)*
- **V2-2** The countdown runs only when the phone already allows the microphone (`readDevicePermission('microphone') === 'granted'`, or a recording already started in this app session). Otherwise the card shows no ring and waits for a tap — a countdown that says "starts by itself" must really start (P5), and an OS permission dialog must never pop up unasked. *(my call)*
- **V2-3** Sathi's "आता बोला — मी ऐकतोय" is a **bubble, not a voice**: no sound while the microphone is open (it would be recorded).
- **V2-4** With v2 on, the old 10-second stop hint (`recorderWords.ts:47`) is replaced by the speech-driven "काम सांगून झालं?" popup (never two popups).
- **V2-5** Auto-close lands on the **work home**, not on the plot + mic step (see V2-1).
- **V2-6 (founder to confirm)** **Name clash:** in the app "पूर्ण शेतीचा आढावा" is already the farm review page (`ReflectPage`, `i18n/oversightTranslations.ts:636`). The approved blue button "शेतीचा आढावा बघा" opens a different page (today's full result screen). The toast's pointer is correct: the just-saved log is on पूर्ण शेतीचा आढावा (it reads the same `history`, today's date). Recommendation: rename the button to "सविस्तर बघा" (sub-line "आजचं सगळं: औषध, घटक, आवाज") so the two names never mean two pages. The plan ships the approved words until the founder rules.
- **V2-7** The "प्लॉट तपासला" question inside the step list is **not built today** (§5). The existing "तपासा आणि जतन करा" screen takes over, as today.
- **V2-8** No projected "→ N/10" anywhere: no server field carries it (P4). The meter shows the server's score or "अजून समजतंय…".

## 5. Not feasible today without server changes or a voice-path refactor
- **Auto-approval of the owner's own read-back** — needs a new `ReviewBasis` on the server (`OwnerConfirmation.cs`). Deferred.
- **"→ N/10 if you tell X" chips on the meter** — needs the server's `nextDetails` (Phase A Task 12A, founder decision pending). Not shown.
- **"शब्द लिहून घेतले" as its own earlier moment** — needs the live transcript stage, which is off since 2026-08-31 (it created no AI job and zeroed DFES scoring). Ticks with the parse answer instead.
- **"आवाज सर्व्हरवर सुरक्षित" on step 1** — the phone cannot know the raw upload landed until the answer; step 1 says "फोनवर".
- **The other-plot question inside the step list** — the decline turns the status to idle inside `useVoiceRecorder.ts` (quarantined at its 848-line ceiling, may not grow). Fallback: existing `CheckSaveHost`; an optional two-button question on that screen is a stretch task.

## 6. Rules this must keep
P4 (every tick is a real event; server score only), P5 (a countdown that says it starts must start), P9 (hints only, nothing blocks or covers the stop), P10 ("फोनवर" vs "सर्व्हरवर" honest), P11 (old phones: deadline-based timers, no heavy animation, works at 320 px; flag off = unchanged), haptics only via `shared/utils/haptics.ts` (its off switch), reduced motion = no ring animation / no pulse.
