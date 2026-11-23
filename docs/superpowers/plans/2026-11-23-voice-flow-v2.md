# Voice flow v2 (mic card with 7 s ring, silence help, calm step list, self-closing saved screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today, behind `VITE_VOICE_FLOW_V2`, the TEST app gets the founder-approved voice flow: plot tap → a big mic card that starts listening by itself after 7 s → hints when he is silent → a calm step list after stop that ticks only on real events → one saved screen built from the existing result pieces that closes itself after 30 s untouched.

**Architecture:** Phone only. Re-compose existing pieces: `RecorderFace` gets a v2 idle card and speech-driven hints (from the existing `useMicLevel` level); the processing screen gets `VoiceJourney`, fed by a tiny in-memory signal (`voiceJourneySignal`) that the existing save path already passes through (`BackendAiClient` clip write, `useVoiceAutoSave` sink and `onWritten`); `VoiceResultContainer` renders a new `SavedScreen` (existing badges, `ClipPlayer`, `ResultHero` meter, `ProductTank`, `PartLinks`, `WordsFold`, `EarlierRecording`, …) and keeps `VoiceResultScreen` unchanged as the detail page. Flag off = no new code path runs.

**Tech Stack:** React 19 + TypeScript + Vite + Vitest + Testing Library (phone). No .NET, no DB.

**Spec:** `docs/superpowers/specs/2026-11-23-voice-flow-v2-design.md`. Spec id for commits and the PR: `voice-flow-v2-2026-11-23`.

## Global Constraints

- **Base:** `task/plr-d10-rc1` (verified at `61447ea0`; this plan was written on `ccr-746bc02c-gsa5t5`, which is that line plus docs). Integration branch `task/voice-flow-v2` cut from `task/plr-d10-rc1`; Task 0 lands on it first; every other task is a lane branch off it (`task/voice-flow-v2-tN`), merged back by the lane lead. PR `task/voice-flow-v2` → `task/plr-d10-rc1`. Never `main`, never force-push, never `--no-verify`, never amend after push.
- **Frontend only.** No file under `src/apps/**`, `src/AgriSync.Bootstrapper/**`, migrations, `sync-contract/**`. No change to `useLogCommands.handleAutoSave`, `logSyncMutationService`, the mutation queue, or `useVoiceRecorder.ts`.
- **`useVoiceRecorder.ts` is untouchable:** it is quarantined at 848 lines (`scripts/check-file-sizes.mjs:29-44`) and `check-file-sizes` already counts it at 848 — **zero** lines of growth allowed.
- **Flag off = today, byte for byte.** Every new branch is `FEATURE_FLAGS.voiceFlowV2 && …`. Existing tests that mock `app/featureFlags` with a partial object (e.g. `core/navigation/__tests__/mainView.dailyLoop.test.tsx:106-113`) get `voiceFlowV2: undefined` → off: they must pass **unchanged**. Do not put `VITE_VOICE_FLOW_V2` in `.env` or `.env.local` (Vitest loads them); use `.env.development.local` for the preview.
- **Doctrine:** P4 (every tick/number is a real event; server score only; no "→ N/10"), P5, P9 (hints never block, never cover the stop — the lane L6b lesson at `RecorderFace.tsx:79-82`), P10 ("फोनवर" ≠ "सर्व्हरवर"), P11 (deadline-based timers, 320 px, no new canvas).
- **Words:** every new farmer string lives in ONE file, `src/features/voice/flowV2/voiceFlowWords.ts` (Task 0), Marathi with `// PROPOSED (Marathi)` and an English twin with `// PROPOSED (English)` (house style: `recorderWords.ts:25-30`, `checkSaveWords.ts:54-55`). Existing approved strings are reused, never re-typed (`resultStrings.ts`, `resultCopy.ts`, `TypedEntry.tsx:25-40`). No emoji in farmer copy except the existing ✓ / 🎤.
- **Haptics** only via `hapticFeedback.*` (`shared/utils/haptics.ts:112`, off switch `:65-71`). **No sound while the mic is open.** Reduced motion: no ring sweep, no pulse (`motion-safe:` only).
- **File sizes:** cap 800 lines per `.ts/.tsx` (`scripts/check-file-sizes.mjs:13`). New files stay **≤ 250 lines** *(my call)*. Note: `npm run check:file-sizes` is **already red on the base** (3 files, none touched here: `domain/types/log.types.ts` 836, `infrastructure/api/dtos.ts` 835, `infrastructure/storage/DexieDatabase.types.ts` 812). The per-task gate is: *no new file in its output and no touched file above 800*.
- **Line numbers** are as of `61447ea0` (verified with Read/Grep while writing this plan). Tasks that edit the same file shift them (T7 moves `VoiceResultScreen.tsx` lines that T11 cites): find the code by the quoted names, not by the number.
- **Commits:** Conventional Commits, subject ≤ 72 chars, body, last body line `spec: voice-flow-v2-2026-11-23`, then the session's attribution lines.

## Baseline (measured on this checkout, 2026-11-23)

| Check | Command (in `src/clients/mobile-web`) | Result |
|---|---|---|
| Types | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass (0 errors, 77 warnings) |
| Storage | `node scripts/check-storage-discipline.mjs` | OK |
| File sizes | `npm run check:file-sizes` | **fails on base** (3 untouched files, above) |
| Suites this plan touches | `npx vitest run src/features/logs/components/voiceResult src/features/voice/components src/features/context/components/__tests__/CropPlotStepper.test.tsx src/features/logs/components/entry src/core/navigation src/app/hooks/__tests__` | 102 files, 835 tests, pass |
| Architecture | `dotnet test src/tests/AgriSync.ArchitectureTests/` | **not runnable here: `which dotnet` → nothing.** No C# changes, so unaffected; `.github/workflows/arch-tests.yml` runs it, but only for PRs into `main` (same for `frontend-ci.yml`) — so every phone check is run locally and pasted into the PR. |

**Per-task check set ("the checks"):** `npm run typecheck && npm run lint && npx vitest run <task paths> && npm run check:file-sizes` (read against the baseline) and, for a task that touches storage or infrastructure, `node scripts/check-storage-discipline.mjs`.

## Change Surface

| Surface | Answer |
|---|---|
| **DB** | **None.** No migration, no table, no column, no Dexie schema/version change (no new Dexie table either; `check:dexie-version` untouched). |
| **Backend** | **None.** No endpoint, DTO, handler, setting or prompt. Owner confirm keeps `ReviewBasis` `heard`/`read` (`ShramSafal.Domain/Logs/OwnerConfirmation.cs:10-16`). |
| **Frontend** | Flag `voiceFlowV2` (`app/featureFlags.ts`); words `features/voice/flowV2/voiceFlowWords.ts`; recorder: `RecorderFace.tsx`, new `recorder/MicCard.tsx`, `recorder/SilenceHelp.tsx`, `recorder/silenceHelpModel.ts`, `recorder/useAutoStartCountdown.ts`, `recorder/flowV2Types.ts`, prop pass-through in `AudioRecorderStreaming.tsx` / `AudioRecorder.tsx`; entry: `LogEntryFlow.tsx` (arm on plot tap), `core/navigation/mainView.tsx`, `core/navigation/logRecorder.tsx`; journey: new `infrastructure/voice/voiceJourneySignal.ts`, emit lines in `infrastructure/ai/BackendAiClient.ts` and `app/hooks/useVoiceAutoSave.ts`, new `features/logs/components/voiceFlowV2/{journeyModel.ts,VoiceJourney.tsx}`; saved: new `voiceResult/LatestParts.tsx` (extracted, same DOM), `ResultHero.tsx` (`parts` prop), new `voiceFlowV2/{SavedScreen.tsx,SavedPartsGrid.tsx,useIdleClose.ts,IdleCloseBar.tsx}`, `VoiceResultContainer.tsx` (branch + detail toggle), `core/navigation/voiceResultView.tsx` (`onAutoClose`); dev preview: `features/oversight/OversightAppPreview.tsx`, `preview/usePreviewRouterCtx.ts`, new `preview/voiceFlowV2Fixtures.ts`, `preview/previewVoiceJourney.ts`, `app/providers/DataSourceProvider.tsx` (export a value provider for the preview). |
| **Cross-cutting** | `.env.fieldtest.example` `VITE_VOICE_FLOW_V2=1`; `.env.production.example` `VITE_VOICE_FLOW_V2=0`; **not** added to `.github/workflows/release.yml` / `android-release.yml` (production builds stay off). The founder's gitignored `.env.fieldtest` on the PC needs the line added by hand. No telemetry, no new permission (RECORD_AUDIO already in `android/app/src/main/AndroidManifest.xml:45`). New Marathi strings to the founder for review. |

## Review Focus

1. **Nothing saves twice, nothing saves differently.** The emit lines in `useVoiceAutoSave.ts` and `BackendAiClient.ts` are fire-and-forget, wrapped in `try/catch`, after the existing awaits; `useVoiceAutoSave.test.ts` and `useLogCommands.voiceAutoSave.test.ts` pass unchanged (Task 1).
2. **The mic never opens by itself when he did not just tap a plot**, never while the typing sheet is open, never with the page hidden, never without granted permission (Task 4 tests).
3. **Every journey tick maps to a signal event**; events older than the screen are ignored; the progress bar moves in whole steps (Task 6 tests).
4. **Auto-close lands on the work home**, keeps the saved record, pauses while a clip plays or the product card / day sheet / detail page is open (Tasks 10, 12).
5. **Flag off:** every existing suite above passes with zero edits to existing test files.

---


## Review amendments (CTO review + independent code verification, 2026-11-23) — these OVERRIDE the tasks below where they differ

**Delivery shape.** Two stages on the same branch, each verified before it is offered: **Stage 1** = T0, T1, T2–T5, T6 (mic card, silence help, step list). **Stage 2** = T8–T12 (saved screen, auto-close) without T7. T13 (dev preview) after both; T14 dropped. Gate 1 is on the TEST APK (or localhost preview) of the branch; nothing merges into `task/plr-d10-rc1` before the Founder Acceptance Gate.

**Task 0 (done in commit "feat(voice): voice flow v2 flag…"):** `placeLabelOf` moved to `core/navigation/placeLabel.ts` and re-exported from SpeakHost (no circular import, review M6 / verifier 5). The fieldtest line is ACTIVE (`VITE_VOICE_FLOW_V2=1`). The flag test reads the files (Vitest cannot stub this env read).

**Mic card (T4/T5):**
- B1 / verifier 2 — **fire once per armSeq.** The countdown hook lives in `RecorderFace` ABOVE the `if (isRecording)` early return, with a "consumed armSeq" ref that survives the card unmounting. A cancel, a mic error, or any recording that starts holds the countdown until the NEXT plot tap. Tests: cancel → no restart; mic error after auto-start → no loop; plot deselected at 5 s → no start at 7 s.
- Verifier 3 — `readDevicePermission` is async: no ring until it resolves; the 7 s deadline starts at the resolve; unknown / prompt / denied = no auto-start (the card still shows, tap only).
- H1 — an AUTO-started recording with no detected speech in 20 s is cancelled silently (nothing saved) and the card shows "माइक दाबल्यावरच ऐकेल". If the level is not measurable, no auto-start. A level stuck at exactly 0 for the first 3 s = not measurable.
- M1 — synchronous `startingRef` guard: a tap at 6.9 s and the 7.0 s timer can never open two recorders; the mic button calls `hold()` before `onStart`.
- M2 — only the big mic button starts recording; the "थांबा…" link and the card body never call `onStart`.
- H7 — `setArmSeq` only when `FEATURE_FLAGS.voiceFlowV2` (flag off = no new state change on plot tap).
- L3 — closing the typing sheet without sending leaves the countdown held.

**Silence help (T2/T3):**
- Verifier 1 — `SilenceState.measured` (true on the first defined level); stage is `none` while not measured; never latch on the first ~90 ms `undefined`.
- H4 — ONE fixed-height hint slot, rendered from t=0, content swapped; the stop button's position never changes. Test pins the slot from t=0.
- H5 — no live region while the mic is open (`role="note"`, `aria-live="off"`); countdown digits `aria-hidden`, one announcement when the countdown arms. Ask the founder for example sentences without numbers or brand names (open item; keep the approved ones until then).

**Step list (T6):** H6 — on a real phone `understood → written → success` happen within milliseconds; the final completed state (all ticks + chips) is HELD on screen for 1.2 s before the result screen replaces it (no extra tick; P4-safe). Ticks only from `voiceJourneySignal`. M7 — `renderProcessingScreen` is shared with SpeakHost: with the flag on, every speak entry point shows the step list (add a flag-on SpeakHost test; a हजेरी-door recording that never emits 'understood' shows step 1 only, then the existing screen it lands on).

**Saved screen (Stage 2):**
- H7 — **T7 removed:** zero edits to `VoiceResultScreen.tsx`; the saved screen duplicates the ~25 lines of badge row / edit buttons (follow-up to dedupe).
- H2 / P10 — the title follows the sync truth: on the phone only → `RS.remembered` ("लक्षात ठेवलं ✓"); server-acknowledged → `RS.onServer`. The 30 s toast uses the same claim. **No auto-close** while any log's `syncQueued !== true`, while sync is `needsFix`, or while a refused / money-not-followed banner shows.
- H3 — auto-close pauses while `openOverlayCount() > 0` (`backStack.ts`), while `pickingDay`, while the ProductCard is open, while a clip plays, and resets on `focusin`/pointer/touch/key; no scroll listener.
- M4 — the 30 s ticking lives in the `IdleCloseBar` leaf (text once per second, bar by CSS), never re-rendering the whole screen.
- M5 / verifier 7 — `detail` state and `useBackDismiss` sit above the container's `return null`; the sticky `SavedScreenBack` returns to the saved screen while in detail.
- Verifier 6 — `TypedNote` from `DayParts.tsx` (testid `vr-typed-note`); mix verdicts recomputed as `VoiceResultScreen.tsx:144-149`; `DayPickSheet` still rendered in the v2 branch.
- Detail button words: "आजचा आढावा बघा" (V2-6: "शेतीचा आढावा" is ReflectPage's name). The closing toast keeps "शेतीचा आढावा मध्ये बघा" because the saved record is visible there.

**Preview (T13):** verifier 8 — `OversightAppPreview` listens for `agrisync:toast`; `DataSourceValueProvider` stub satisfies `AppDataSource`. Fixture strings must be absent from `dist/` (L1 check).

**Checks per lane (M8):** add the source sweeps: `shared/utils/__tests__/bottomBarSweep.test.ts`, `voiceResult/__tests__/ResultHero.plot.test.tsx`, `src/__tests__/testHygiene.contract.test.ts`, `displayTime.sweep.test.ts`; the full suite at every lane merge. `check:file-sizes` must still name exactly the same 3 base files. **Telemetry (M9):** `logger.info('voice_v2.*')` breadcrumbs (auto-start fired / held / cancelled, hint stage, auto-close, detail opened, pause reason). **Rollback (M10):** at D1 build the flag-on and flag-off APKs from one SHA.

---
## Parallelisation map

```
T0 contracts (flag, words, types, signal, pass-throughs)  ── must land first (~1 h)
 ├─ Lane A: T1 emit events ─────────────► T6 VoiceJourney ───────────────┐
 ├─ Lane B: T2 silence model ──► T3 silence UI in RecorderFace           │
 ├─ Lane C: T4 MicCard + countdown ──► T5 arm on plot tap (LogEntryFlow) │
 ├─ Lane D: T7 extract LatestParts ┐                                     │
 │          T8 ResultHero parts    ├─► T11 SavedScreen ──► T12 container ┤
 │          T9 SavedPartsGrid      │                                     │
 │          T10 useIdleClose + bar ┘                                     │
 └─ Lane E: T13a fixtures (any time) ──────────────► T13b preview wiring ◄┘ (needs T5, T6, T12)
T14 (stretch, independent after T0): two-button plot question on CheckSaveHost
T15 integration checks + screenshots + PR  →  Gate 1 (founder, localhost)  →  D1 TEST APK  →  Gate 2 (founder, phones)
```

| Task | Est. | Depends on | Can run with |
|---|---|---|---|
| T0 | 1 h | — | — |
| T1 | 1 h | T0 | T2, T4, T7–T10, T13a |
| T2 | 1 h | T0 | all lanes |
| T3 | 1.5 h | T2 | T4/T5 (different region of `RecorderFace.tsx`; see T3) |
| T4 | 2 h | T0 | T2, T3 |
| T5 | 1 h | T4 | — |
| T6 | 2.5 h | T1 | Lane D |
| T7 | 1 h | T0 | T8–T10 |
| T8 | 0.5 h | T0 | T7, T9, T10 |
| T9 | 1 h | T0 | T7, T8, T10 |
| T10 | 1.5 h | T0 | T7–T9 |
| T11 | 3 h | T7–T10 | T6 |
| T12 | 1.5 h | T11 | — |
| T13a / T13b | 1 h / 1.5 h | T0 / T5+T6+T12 | — |
| T14 (stretch) | 1.5 h | T0 | anything |
| T15 | 1 h | all above | — |

Five engineers: wall-clock ≈ 6–7 h including review.

---

### Task 0: Contracts — flag, words, shared types, the journey signal, pass-throughs (no behaviour)

**Files:**
- `src/clients/mobile-web/src/app/featureFlags.ts:147` — add after `simulateUnlock` (inside `FEATURE_FLAGS`, which spans `:57-148`):
  ```ts
  /** spec: voice-flow-v2-2026-11-23 — mic card + 7 s ring, silence help, step list, self-closing saved screen. Default OFF. */
  voiceFlowV2: isEnabled('VITE_VOICE_FLOW_V2'),
  ```
- `src/clients/mobile-web/.env.fieldtest.example:21` — after `VITE_SIMULATE_UNLOCK=0` add a commented `VITE_VOICE_FLOW_V2=1` line (spec id in the comment).
- `src/clients/mobile-web/.env.production.example:31` — after `VITE_TASK_CLOSE_CONFIRM=0` add `VITE_VOICE_FLOW_V2=0` with a comment "OFF until the Founder Acceptance Gate of voice-flow-v2-2026-11-23 and a promotion decision".
- New `src/clients/mobile-web/src/features/voice/flowV2/voiceFlowWords.ts` — `VOICE_FLOW_MR`, `VOICE_FLOW_EN` (same keys, `satisfies` one interface) and `voiceFlowWords(language)`. Keys and Marathi (each `// PROPOSED (Marathi)` unless marked):
  - mic card: `cardTitle` 'आता बोला' · `tapToStart` 'माइक दाबा आणि बोला' · `autoIn(n)` `दाबलं नाही तरी ${n} सेकंदात साथी ऐकायला सुरुवात करेल` · `exampleLabel` 'असं सांगा' · `example` '“आज पाच मजूर होते, चार तास फवारणी केली, कॉन्फिडॉर अडीचशे एमएल.”' · `holdLink` 'थांबा, अजून प्लॉट निवडायचे आहेत' · `held` 'माइक दाबल्यावरच ऐकेल' · `sathiListening` 'आता बोला — मी ऐकतोय' (founder-approved words, still marked PROPOSED until his string review).
  - silence: `coachOne` 'बोला… मी ऐकतोय. उदा. “आज छाटणी केली”' · `coachTitle` 'काय सांगायचं? यापैकी काहीही' · `prompts` `[{ q: 'आज कोणतं काम केलं?', ex: '“फवारणी केली”' }, { q: 'किती मजूर होते?', ex: '“पाच जण होते”' }, { q: 'कोणतं औषध, किती?', ex: '“कॉन्फिडॉर अडीचशे एमएल”' }]` · `stopNote` 'काही सुचत नसेल तर थांबवा दाबा — आवाज जतन होईल' · `doneAskTitle` 'काम सांगून झालं?' · `doneAskBody` 'तर खालचं लाल बटण दाबा'.
  - journey: `journeyTitle` 'साथी तुमचं काम लावून ठेवतोय' · `journeySub` 'शांतपणे बघा — पुन्हा बोलायची गरज नाही' · `stepKept` 'आवाज जतन केला' · `keptSub(sec)` `${sec} सेकंदांचा आवाज · फोनवर सुरक्षित` (NOT "सर्व्हरवर", P10 — differs from the prototype on purpose) · `stepKeptTyped` 'तुम्ही लिहिलेलं मिळालं' · `stepWords` 'शब्द लिहून घेतले' · `stepParts` 'कामं वेगळी केली' · `stepPlace` 'प्लॉट तपासला' · `stepProducts` 'औषध आणि खत ओळखले' · `stepSaved` 'जतन झालं' · `waiting` 'थोडं थांबा… साथी लिहून ठेवतोय'.
  - saved: `savedTitle` 'जतन झालं' · `listenTitle` 'तुमचा आवाज ऐका' · `listenSub` 'जसं बोललात तसंच' · `givenTitle` 'तुम्ही काय दिलं' · `givenHint` 'दाबा आणि घटक बघा' · `detailButton` 'शेतीचा आढावा बघा' (spec V2-6: name clash, founder to rule) · `detailSub` 'आजचं सगळं सविस्तर: औषध, घटक, आवाज' · `closesIn(n)` `${n} सेकंदात बंद होईल` · `closesSub` 'काहीही दाबलं की वेळ परत ३० होईल' · `paused` 'थांबवलं' · `pausedSub` 'बघून झालं की परत वेळ सुरू होईल' · `closedToast` 'आजचं काम जतन झालं ✓ — परत बघायचं असेल तर शेतीचा आढावा मध्ये बघा'.
  - Reused, NOT re-typed: `RESULT_STR.addAnother/todayCount/firstToday/todayWho/times/justNow/remembered/onServer/needsFix/confirmedBadge/notConfirmed/noneYet/tellMore/earlierTitle/unclearTitle/edit` (`resultStrings.ts:21-86`), `resultCopy(language).whyHeading/speakerDone/typeNames/spray/drip` (`resultCopy.ts:125,202,162,146-147`), `TYPED_WORDS.link` (`TypedEntry.tsx:29`).
- New `src/clients/mobile-web/src/features/voice/components/recorder/flowV2Types.ts`:
  ```ts
  export interface MicCardSpec { /** bumps on every plot tap made on this screen; 0 = never armed */ armSeq: number; placeLabel: (language: string | undefined) => string }
  export interface RecorderFlowV2 { silenceHelp: boolean; card?: MicCardSpec }
  ```
- New `src/clients/mobile-web/src/infrastructure/voice/voiceJourneySignal.ts` (pattern: `features/logs/services/dfesAnswerSignal.ts`, in-memory pub/sub; infrastructure so `BackendAiClient` may emit it; imports only `AgriLogResponse` from `domain/types/log.types`):
  ```ts
  export type VoiceJourneyEvent =
    | { kind: 'kept'; input: 'audio' | 'text'; durationMs?: number }
    | { kind: 'understood'; draft: AgriLogResponse }
    | { kind: 'placeChecked'; result: 'same' | 'otherPlot' | 'unclear' }
    | { kind: 'written'; logIds: string[] };
  export interface VoiceJourneySnapshot { startedAt: number; input?: 'audio'|'text'; durationMs?: number; keptAt?: number; draft?: AgriLogResponse; understoodAt?: number; place?: 'same'|'otherPlot'|'unclear'; writtenAt?: number; logIds?: string[] }
  export function noteVoiceJourney(e: VoiceJourneyEvent, now = Date.now()): void;   // 'kept' starts a NEW snapshot; others update the current one
  export function readVoiceJourney(): VoiceJourneySnapshot | null;
  export function subscribeVoiceJourney(l: () => void): () => void;
  export function resetVoiceJourneyForTests(): void;
  ```
  `noteVoiceJourney` never throws (listener errors are caught and dropped). Snapshots are replaced, never mutated, so `useSyncExternalStore` sees each change.
- `src/clients/mobile-web/src/features/voice/components/recorder/RecorderFace.tsx:31-57` — add `flowV2?: RecorderFlowV2` to `RecorderFaceProps` (unused in T0).
- `src/clients/mobile-web/src/features/voice/components/AudioRecorderStreaming.tsx:36-50` and `:305-322` — add the same optional prop and pass it to `RecorderFace`; same in `src/clients/mobile-web/src/features/voice/components/AudioRecorder.tsx` (`RecorderFace` call at `:224`).
- `src/clients/mobile-web/src/core/navigation/logRecorder.tsx:24-27, 40-55` — `LogRecorderHooks` gains `armSeq?: number`; when `FEATURE_FLAGS.voiceFlowV2`, pass `flowV2={{ silenceHelp: true, card: armSeq !== undefined ? { armSeq, placeLabel: l => placeLabelOf(ctx.logScope, ctx.crops, l, resultStr(l).wholeFarm) ?? '' } : undefined }}` to both recorders (`placeLabelOf` is exported at `core/speak/SpeakHost.tsx:47`; `resultStr` at `voiceResult/resultStrings.ts:165`). `renderLogRecorder` is a hook-free render function (`routeContext.ts` rule), so the label is a function of the language, resolved inside `MicCard`.

- [ ] **Step 1: Failing tests.**
  - `src/features/voice/flowV2/__tests__/voiceFlowWords.test.ts`: MR and EN have identical keys; every MR string contains Devanagari and no Latin letters except `ml`; every EN string has no Devanagari; `autoIn(7)`, `keptSub(46)`, `closesIn(30)` interpolate.
  - `src/infrastructure/voice/__tests__/voiceJourneySignal.test.ts`: `kept` starts a snapshot with `keptAt`; `understood` / `placeChecked` / `written` fill it in order; a second `kept` replaces the snapshot; a throwing listener does not stop others or throw out of `noteVoiceJourney`; unsubscribe works.
  - `src/app/__tests__/featureFlags.voiceFlowV2.test.ts`: with `vi.stubEnv('VITE_VOICE_FLOW_V2', '1')` + `vi.resetModules()` the flag is true; unset → false.
- [ ] **Step 2: Run and see them fail:** `npx vitest run src/features/voice/flowV2 src/infrastructure/voice/__tests__/voiceJourneySignal.test.ts src/app/__tests__/featureFlags.voiceFlowV2.test.ts`.
- [ ] **Step 3: Implement** the files above.
- [x] **Step 4: The checks** + the baseline suite list (must stay 835/835 plus the new tests). Commit `feat(voice): voice flow v2 flag, words and contracts (off by default)`; push; lanes branch from here.

### Task 1: Say the real events (emit only; the save path is unchanged)

**Files:**
- `src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.ts:373` — right after `await this.persistProcessingVoiceClip(material, farmId, scope, 'parsing');` add `try { noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: material.inputRawDurationMs ?? material.inputSpeechDurationMs }); } catch { /* display only */ }`.
- `BackendAiClient.ts:418` (first line of `submitVoiceTextInput`, after `safeTrim`) — `noteVoiceJourney({ kind: 'kept', input: 'text' })` in the same `try`.
- `src/clients/mobile-web/src/app/hooks/useVoiceAutoSave.ts:117-148`:
  - after the `logIntent === 'labour'` return (`:118`): `noteVoiceJourney({ kind: 'understood', draft })`;
  - `:120` unclear branch: `noteVoiceJourney({ kind: 'placeChecked', result: 'unclear' })` before `bindDraftDecline`;
  - `:121` other-plot branch: `… result: 'otherPlot'`;
  - after `:121`, before the duplicate check: `… result: 'same'`;
  - inside `onWritten` (`:142-147`), after `setVoiceResult(...)`: `noteVoiceJourney({ kind: 'written', logIds: logs.map(l => l.id) })`.
  - Each call wrapped so a throw can never reach the save (a local `say = (e) => { try { noteVoiceJourney(e); } catch { /* display only */ } }`). `saveChecked` (`:181-209`) emits nothing.

- [ ] **Step 1: Failing tests.**
  - `src/app/hooks/__tests__/useVoiceAutoSave.journey.test.ts` (new file; reuse the fakes style of `useVoiceAutoSave.test.ts`): a savable draft emits `understood` → `placeChecked:same` → `written` with the written ids, and `written` comes only after the fake `handleAutoSave` called `onWritten`; `logIntent === 'labour'` emits nothing; an unsavable draft emits `understood` + `placeChecked:unclear`; a draft with `suggestedContext.{cropId,plotId}` emits `placeChecked:otherPlot` and never `written`; a save that returns `null` emits no `written`; a subscriber that throws does not change the sink's return value.
  - `src/infrastructure/ai/__tests__/BackendAiClient.journey.test.ts` (mock as in `BackendAiClient.offlineGate.test.ts`): an online audio parse emits `kept` (`input:'audio'`, `durationMs` from the input) **after** the `voiceClips.put` resolves; a text parse emits `kept` (`input:'text'`); an offline parse emits nothing from this path.
- [ ] **Step 2: Run, fail:** `npx vitest run src/app/hooks/__tests__/useVoiceAutoSave.journey.test.ts src/infrastructure/ai/__tests__/BackendAiClient.journey.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests + `npx vitest run src/app/hooks src/infrastructure/ai` (existing `useVoiceAutoSave.test.ts`, `useLogCommands.voiceAutoSave.test.ts`, `laneOF.savePlumbing.test.ts` pass unchanged) + the checks + `node scripts/check-storage-discipline.mjs`. Commit `feat(voice): say when the voice is kept, understood and written`.

### Task 2: Silence help model (pure)

**Files:** new `src/clients/mobile-web/src/features/voice/components/recorder/silenceHelpModel.ts`.

The only speech signal while recording is the open microphone's level: `useMicLevel` (`features/voice/hooks/useMicLevel.ts:43`, 0..1 every 90 ms, `undefined` when not measurable) already reaches `RecorderFace` as `level` (`AudioRecorderStreaming.tsx:90,309`, `AudioRecorder.tsx:47`). **There are no live transcript partials during recording:** `LiveCaption` / `liveCaption` only fill in the post-stop transcribe stage (`useVoiceRecorder.ts:244-285`), which never runs today (`useStreamingParse: false`, `infrastructure/voice/types.ts:181`).

```ts
export const SPEECH_LEVEL = 0.12;        // useMicLevel's GAIN 3.2 lifts normal speech well above this (tune at Gate 2)
export const SPEECH_MIN_MS = 300;        // this long above SPEECH_LEVEL = he is speaking
export const COACH_MS = [4000, 9000, 16000] as const;
export const QUIET_DONE_MS = 5000;
export const LONG_TALK_MS = 60000;
export type SilenceStage = 'none' | 'coachOne' | 'coachPrompts' | 'stopNote' | 'doneAsk';
export interface SilenceState { startedAt: number; aboveSince: number | null; spoke: boolean; lastSpeechAt: number | null; doneAskShownAt: number | null }
export function silenceStart(now: number): SilenceState;
export function silenceStep(s: SilenceState, level: number | undefined, now: number): SilenceState;
export function silenceStage(s: SilenceState, now: number): SilenceStage;
```
Rules: `level === undefined` → stage `none` forever (P5: no fake hints); before `spoke`: `≥4 s` coachOne, `≥9 s` coachPrompts, `≥16 s` stopNote; once `spoke`, coaching stops; `doneAsk` when quiet `≥ QUIET_DONE_MS` after speech, or once at `LONG_TALK_MS`; speaking again hides `doneAsk`.

- [ ] **Step 1: Failing tests** `recorder/__tests__/silenceHelpModel.test.ts`: the table above at the exact millisecond edges; a 200 ms blip does not count as speech; 400 ms does; `undefined` levels → always `none`; `doneAsk` at 5 s quiet after speech, hidden on new speech; once at 60 s even while talking, not repeated.
- [ ] **Step 2: Run, fail; implement; run → PASS** (`npx vitest run src/features/voice/components/recorder/__tests__/silenceHelpModel.test.ts`), the checks. Commit `feat(voice): silence help model driven by the real mic level`.

### Task 3: Silence help on the recording face (hints only)

**Files:** new `src/clients/mobile-web/src/features/voice/components/recorder/SilenceHelp.tsx`; `RecorderFace.tsx:59-102` (the `Recording` sub-component only) and `:121` (pass `flowV2?.silenceHelp` into `Recording`). **Lane rule:** T3 edits only `Recording` (`:59-102`) and `:121`; T4 owns `:104-167` — merge T3 first if both are ready.

- `Recording` gets `silenceHelp?: boolean`. When true: keep a `SilenceState` in a ref, step it on every `level` change (`useEffect` on `level`) and on a 500 ms interval (so silence with a steady level still advances; interval cleared on unmount); render `<SilenceHelp stage=… />`:
  - `coachOne`: one line under the clock; `coachPrompts`: a dashed card with the 3 prompts (`PartIcon` for crop / labour / inputs from `voiceResult/HisWords.tsx:24`); `stopNote`: one amber line. All `role="status" aria-live="polite"`, `pointer-events-none`.
  - `doneAsk`: a bubble **in the flow above `VoiceLevelRing`** (never absolutely positioned over it), `pointer-events-none`, plus `attention` on `VoiceLevelRing` (existing prop, `VoiceLevelRing.tsx:42,72`, `motion-safe:animate-ping`).
  - When `silenceHelp` is true the old 10 s hint (`hintOn`, `:62`, `:83-90`) is not drawn (spec V2-4); when false, `Recording` is exactly today's.
  - First seconds after an **auto-start** (prop `autoStarted`, set by T4): Sathi bubble `sathiListening` until speech is detected or 4 s pass. No sound. No haptic here (T4 fires one at start).

- [ ] **Step 1: Failing tests** `recorder/__tests__/RecorderFace.silenceHelp.test.tsx` (fake timers; rerender with `level` values): no hint with `level` undefined; coachOne at 4 s, prompts card at 9 s with the 3 questions, stopNote at 16 s; after `level` 0.3 for 0.5 s then 0 for 5 s → `doneAsk` bubble + `mic-stop-attention` present; `mic-stop` is still clickable (`fireEvent.click` → `onStop` called once) while the bubble shows; old `mic-stop-hint` never appears with `silenceHelp`; without `silenceHelp` at 10 s the old `mic-stop-hint` appears exactly as before.
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/voice/components` (existing `AudioRecorder*.test.tsx`, `AudioRecorderStreaming.*.test.tsx` unchanged) → PASS; the checks. Commit `feat(voice): calm hints while he is silent, a nudge to stop when done`.

### Task 4: The mic card with the 7-second ring

**Files:** new `src/clients/mobile-web/src/features/voice/components/recorder/useAutoStartCountdown.ts`, new `recorder/MicCard.tsx`; `RecorderFace.tsx:104-167` (idle branch); `AudioRecorderStreaming.tsx:137` (after `setIsRecording(true)`: `noteMicGranted()`), same line in `AudioRecorder.tsx` after its successful start.

- `useAutoStartCountdown({ armSeq, enabled, seconds = 7, onFire })` → `{ secondsLeft: number | null, hold: () => void }`: restarts on every new `armSeq > 0`; deadline = `Date.now() + 7000` (no tick counting, P11); ticks every 250 ms for the ring; `null` when not running. Never runs when: `armSeq === 0`, `!enabled`, `document.hidden` (a `visibilitychange` to hidden **holds** it; coming back does not restart it), or after `hold()` until the next `armSeq`. Fires `onFire` once.
- Permission gate (spec V2-2): `enabled` requires `readDevicePermission('microphone') === 'granted'` (`features/consent/separation/devicePermissions.ts:81-97`, reads without prompting) **or** `micGrantedThisSession()` — a module flag in `useAutoStartCountdown.ts`, set by `noteMicGranted()` from the recorders' successful start. Any other answer (incl. `'unavailable'` on WebViews that refuse to answer) → the card shows no ring and waits for a tap.
- `MicCard` (props: `spec: MicCardSpec`, `disabled`, `held` (typing sheet open), `onStart`, `onRequestContextSelection`): heading `cardTitle`; `spec.placeLabel(language)`; the mic button 148 px (`[@media(max-height:720px)]` 120 px), same green gradient as `RecorderFace.tsx:130`; an SVG ring around it whose `stroke-dashoffset` follows `secondsLeft/7` (reduced motion: no sweep, show the number only); `tapToStart`; `autoIn(n)` in the language's digits (`shared/utils/marathiDigits.ts:30` `digitsFor`) only while running; the example box (`exampleLabel` / `example`); the `holdLink` button (`min-h-[48px]`) → `hold()`; after hold, `held`. `data-testid`s: `mic-card`, `mic-button` (keep the id so existing selectors still find the mic), `mic-card-ring`, `mic-card-hold`. On fire: `hapticFeedback.selection?.()` then `onStart()`; the recorder is told `autoStarted` (a ref in `RecorderFace` passed to `Recording`, for T3's bubble).
- `RecorderFace` idle: when `flowV2?.card` is set → `<MicCard …/>` + the existing error block, `TypedLink`, `TypedSheet` (`:138-164`) unchanged; `held={typedOpen}`; otherwise today's idle card, untouched.

- [ ] **Step 1: Failing tests.**
  - `recorder/__tests__/useAutoStartCountdown.test.ts` (fake timers, mock `readDevicePermission`): fires once at 7000 ms with `granted`; never with `prompt`/`unavailable`/`denied` unless `noteMicGranted()` was called; `armSeq` 0 → never; a new `armSeq` at 5 s restarts to 7 s; `hold()` stops until the next `armSeq`; `document.hidden` → held, visible again → still held; unmount clears.
  - `recorder/__tests__/RecorderFace.micCard.test.tsx`: with `flowV2.card` the card shows title, place line, example, hold link; ring + "७ सेकंदात" text shown only when permitted; after 7 s `onStart` called once and `hapticFeedback.selection` once (spy); tap on `mic-button` at 2 s → `onStart` once and no second call at 7 s; opening "बोलता येत नसेल तर इथे लिहा" at 3 s → no auto start; `disabled` → no ring, tap calls `onRequestContextSelection`; without `flowV2` the idle DOM equals today's (assert `mic-instruction` text = `MIC_INSTRUCTION`).
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/voice/components` → PASS; the checks. Commit `feat(voice): mic card that starts listening by itself after 7 s`.

### Task 5: Arm the ring only on a plot tap on the log tab

**Files:** `src/clients/mobile-web/src/features/logs/components/entry/LogEntryFlow.tsx:45-48` (`RecorderHooks` + `armSeq?: number`), `:50-86` (new prop `micCountdown?: boolean`), `:143` (hooks), `:177-181` (`onSelectionChange`); `src/clients/mobile-web/src/core/navigation/mainView.tsx:254-294` (`<LogEntryFlow …>`; `renderRecorder` at `:294`).

- `LogEntryFlow`: `const [armSeq, setArmSeq] = useState(0)`; in `onSelectionChange`, when `plots.length > 0 || newCrops.includes('FARM_GLOBAL')`, `setArmSeq(n => n + 1)`; `hooks = { onRecordingChange: setRecording, ...(micCountdown && !recordingSegment ? { armSeq } : {}) }`. Arriving with a selection (back from a result, `pinnedQuestion`, labour door, `startAt="entry"`) leaves `armSeq` at 0 → card without ring (spec V2-1). The segment branch (`:145-153`) passes no `armSeq`.
- `mainView.tsx`: `micCountdown={FEATURE_FLAGS.voiceFlowV2 && logIntent !== 'labour'}` and `renderRecorder={({ onRecordingChange, armSeq }) => renderLogRecorder(ctx, { onRecordingChange, armSeq })}`. `SpeakHost` (`core/speak/SpeakHost.tsx:177-192`) is **not** changed: the ONE mic ("आणखी सांगा", a red part, Sathi's question) keeps today's idle face plus the silence help (from T0's `renderLogRecorder`).
- `CropPlotStepper.tsx:419-424` (`flow-mic-slot`) needs **no** change: the card is the footer `LogEntryFlow` already renders there.

- [ ] **Step 1: Failing tests** `entry/__tests__/LogEntryFlow.micCountdown.test.tsx`: a fake `renderRecorder` records the `armSeq` it gets: 0 on mount with a selection; 1 after one plot tap; 2 after a second plot tap; undefined when `micCountdown` is false; undefined in the segment branch. `core/navigation/__tests__/mainView.voiceFlowV2.test.tsx` (mock `featureFlags` with `voiceFlowV2: true`, pattern of `mainView.dailyLoop.test.tsx:106`): `logIntent 'labour'` → `micCountdown` false.
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/logs/components/entry src/core/navigation src/features/context` → PASS (existing `LogEntryFlow.test.tsx`, `CropPlotStepper*.test.tsx`, `mainView.*.test.tsx` unchanged); the checks. Commit `feat(log): the mic ring starts only when he taps a plot`.

### Task 6: The calm step list after stop

**Files:** new `src/clients/mobile-web/src/features/logs/components/voiceFlowV2/journeyModel.ts`, new `voiceFlowV2/VoiceJourney.tsx`; `src/clients/mobile-web/src/core/navigation/logRecorder.tsx:82-113`.

- `journeyModel.ts` (pure):
  - `journeyFactsOf(draft, scope, crops, profile, language)` → `{ excerpt: string | null; parts: string[]; products: { name: string; kind: 'spray'|'drip'|'other'; typeWord: string }[] }` built **only** from existing code: logs = `previewLogs(draft, scope, crops, profile)` (`checkSave/checkSaveModel.ts:75`, the save's own factory); primary = `primaryOf(logs)` (`voiceResult/resultModel.ts:481`); parts = `partEntriesOf(primary, language, true)` → `entryText(e, language, true)` (`resultModel.ts:319`, `partNames.ts:27`); products = `logs.flatMap(productBoxesOf)` (`productModel.ts:170`) → each item `productName(item, language)` + `resultCopy(language).typeNames[typeKeyOf(identityOf(item))]` (`inputIdentityModel.ts:52,66`); excerpt = first 8 words of `draft.fullTranscript` + " …", `null` when empty.
  - `journeyStepsOf(snap, facts, mountedAt)` → ordered steps `{ key, state: 'done'|'active'|'waiting'|'skipped', sub?, chips? }` and `progress = done / visible`. Rules: a snapshot with `startedAt < mountedAt - 2000` counts as none (stale, spec §3); `kept` → step 1 done (sub `keptSub(round(durationMs/1000))` when known; text input → `stepKeptTyped`); `understood` → words (done if `excerpt`, else `skipped`), parts (done, chips), products (drawn only if `products.length > 0`); `place: 'same'` → place done; `writtenAt` → saved done. Exactly one `active` step = the first not done. **No step depends on time.**
- `VoiceJourney` (props: `crops`, `farmerProfile`, `logScope`): `useSyncExternalStore(subscribeVoiceJourney, readVoiceJourney)`; `mountedAt` from a `useRef(Date.now())`; renders the head (Sathi orb video as `ResultHero.tsx:47-54` — copy the 6-line `SathiOrb` or export it from there), `journeyTitle`/`journeySub`, the vertical list with ✓ / number / spinner-free dot, chips (`PartIcon`), the bar (`width = progress*100%`, `transition` only under `motion-safe`), `waiting` line under the active step. `data-testid`: `voice-journey`, `vj-step-<key>` with `data-state`.
- `logRecorder.tsx:82-90`: `if (FEATURE_FLAGS.voiceFlowV2) return <VoiceJourney crops={ctx.crops} farmerProfile={ctx.farmerProfile} logScope={ctx.logScope} />;` before the `dailyLoop` branch. `ShramSathiUnderstanding` and the legacy spinner stay for flag off.

- [ ] **Step 1: Failing tests.**
  - `voiceFlowV2/__tests__/journeyModel.test.ts`: with a fixture draft (Confidor 250 ml + Uthane M-45 500 g in 200 L spray; 19:19:19 5 kg drip; 10 labour) facts list the 3 products with `फवारणी`/drip kind and type words, parts include labour; no snapshot → step 1 active, progress 0; `kept` only → 1 done; `understood` → words/parts/products done in the same call; no inputs → products step absent and the total shrinks; empty transcript → words `skipped`; `place:'otherPlot'` → place stays active (never done); `written` → all done, progress 1; snapshot older than mount-2 s → treated as none; calling twice with the same inputs at different times gives the same steps (no time dependence).
  - `voiceFlowV2/__tests__/VoiceJourney.test.tsx`: emitting events via `noteVoiceJourney` ticks `vj-step-*` `data-state` live; the bar's style width moves only in whole steps; text has no `%`.
  - `core/navigation/__tests__/logRecorder.voiceFlowV2.test.tsx`: flag on → `voice-journey`; flag off + `dailyLoop` → `ShramSathiUnderstanding` (stub) as today.
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/logs/components/voiceFlowV2 src/core/navigation` → PASS; the checks. Commit `feat(voice): calm step list after stop, each tick a real event`.

### Task 7: Extract the latest-recording pieces (same DOM, both screens use them)

**Files:** new `src/clients/mobile-web/src/features/logs/components/voiceResult/LatestParts.tsx`; `VoiceResultScreen.tsx:116-126, 240-252, 309-328`.

Move, verbatim (same classes, same `data-testid`s): `plotIdOf` / `plotsOf` (`:116-126`) as exports; `LatestBadges` = the badge row `:240-251` (props: `primary`, `sync`, `confirmed`); `EditButtons` = `:309-328` (props: `current`, `primary`, `syncQueuedOf`, `onEdit`). `VoiceResultScreen` imports and renders them in the same places — its rendered DOM must not change.

- [ ] **Step 1:** Run the screen suites first and keep the output: `npx vitest run src/features/logs/components/voiceResult src/core/navigation/__tests__/mainView.voiceResult.test.tsx src/core/navigation/__tests__/voiceResultView.honesty.test.tsx`.
- [ ] **Step 2: Failing test** `voiceResult/__tests__/LatestParts.test.tsx`: `LatestBadges` shows `vr-remembered`, `vr-on-server` only for `onServer`, `vr-needs-fix` only for `needsFix`, `vr-confirmed-badge` vs `vr-not-confirmed-badge`, `vr-latest-typed` for typed; `EditButtons` draws one `vr-edit-<id>` per log when several, else `vr-edit`.
- [ ] **Step 3: Implement; run** Step 1's suites again → identical pass counts; the checks. Commit `refactor(result): share the latest-recording badges and edit buttons`.

### Task 8: `ResultHero` can leave the parts to the caller

**Files:** `src/clients/mobile-web/src/features/logs/components/voiceResult/ResultHero.tsx:59-84` (props), `:149-176` (`Meter`), `:188-195`.

Add `parts?: boolean` (default `true`). When `false`: no `PartsGrid` and no `UntoldPartButtons` (the saved screen's own grid has real buttons, Task 9). Everything else (server score via `useDayUnderstanding`/`usePlotDayUnderstanding`, `RingStage`, `meterPending`, `noWorkDay`) unchanged. No projected numbers exist here and none are added (P4).

- [ ] **Step 1: Failing tests** in `voiceResult/__tests__/ResultHero.test.tsx` (add cases, do not edit existing ones): `parts={false}` → no `vr-parts`, no `vr-parts-untold`, `vr-meter-pending` still shown with a null score.
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/logs/components/voiceResult` → PASS; the checks. Commit `feat(result): let the meter be shown without its parts grid`.

### Task 9: The eight parts with what he said, or red "सांगितलं नाही"

**Files:** new `src/clients/mobile-web/src/features/logs/components/voiceFlowV2/SavedPartsGrid.tsx`.

Props `{ day: DayView; onTellMore: (p: PartKey) => void }`. Re-uses `PARTS` (`resultModel.ts:52`), `PartIcon` (`HisWords.tsx:24`), `partNameIn` and `entryText` (`partNames.ts:20,27`), the tile look of `ResultHero.tsx:97-125`. Two columns (`grid-cols-2`, readable value text at 320 px). Told part: tint background, name, the newest `day.byPart[k]` value (`entryText(e, language, true)`), "+N" when more. `day.unsure` part: amber "नक्की समजलं नाही" (`RS.unsurePart`), not a button (saying it again would record it twice — same rule as `ResultHero.tsx:107-109`). `day.missing` part: red button `RS.noneYet` + `RS.tellMore`, `onClick → onTellMore(k)`. `data-testid` `v2-part-<key>` with `data-told="yes|unsure|no"`.

- [ ] **Step 1: Failing test** `voiceFlowV2/__tests__/SavedPartsGrid.test.tsx` (build `DayView` with `buildDayView` from `resultModel.ts:638` over fixture logs): 8 tiles; labour shows "१० जण"-style value in Marathi digits; a missing part is a button that calls `onTellMore('machinery')`; unsure is not a button; English mode shows English names.
- [ ] **Step 2: Run, fail; implement; run → PASS;** the checks. Commit `feat(result): eight parts with his values, untold ones in red`.

### Task 10: The 30-second self-close

**Files:** new `src/clients/mobile-web/src/features/logs/components/voiceFlowV2/useIdleClose.ts`, new `voiceFlowV2/IdleCloseBar.tsx`.

- `useIdleClose({ seconds = 30, paused, onClose, rootRef })` → `{ secondsLeft, paused }`: deadline-based (`Date.now()`), 250 ms tick; resets to 30 on `pointerdown`, `keydown`, `touchstart`, `wheel` and `scroll` inside `rootRef` (capture phase, passive) and whenever `paused` turns false again; while `paused` or `document.hidden` the clock is frozen and resumes from 30 on return; calls `onClose` once at 0; cleans up on unmount.
- `IdleCloseBar` (sticky bottom, `style={{ bottom: BOTTOM_BAR_CLEARANCE }}` from `shared/utils/bottomBar.ts:33`): left a big round green mic (≥ 72 px, label `RS.addAnother`, `onAddAnother`), right `closesIn(n)` / `closesSub` with a draining bar (`width = secondsLeft/30`; `motion-safe` transition), or `paused` / `pausedSub` while paused. `data-testid` `v2-idle-bar`, `v2-add-another`, `v2-idle-left`.

- [ ] **Step 1: Failing tests** `voiceFlowV2/__tests__/useIdleClose.test.tsx` (fake timers + `vi.setSystemTime`): closes once at 30 s; a `pointerdown` at 20 s pushes it to 50 s; `paused` true from 10 s to 40 s → closes at 70 s; hidden for 60 s then visible → does not close on return, closes 30 s later; unmount before 30 s → never closes. `IdleCloseBar.test.tsx`: shows "३० सेकंदात बंद होईल" in Marathi digits, "थांबवलं" when paused, the mic calls `onAddAnother`.
- [ ] **Step 2: Run, fail; implement; run → PASS;** the checks. Commit `feat(result): the saved screen closes itself after 30 s untouched`.

### Task 11: The saved screen (re-composed)

**Files:** new `src/clients/mobile-web/src/features/logs/components/voiceFlowV2/SavedScreen.tsx` (target ≤ 250 lines; if it grows, move the lower half to `SavedScreenLower.tsx`).

Props = what `VoiceResultContainer` already computes, nothing new from outside: `day, recordingKey, placeLabel, farmId, nodes, unclear, clips, playingId, progress, lengthOf, onTogglePlay, sync, syncQueuedOf, confirmed, onEdit, onAddAnother, onTellMore, onChangeDay?, questionPanel?, extras?, answerKit?, mixRules?, notices?: React.ReactNode (refused + money banners), audience?: React.ReactNode, onOpenDetail, onAutoClose`.

Order (each line = the existing piece it re-uses):
1. Place chip + day chip (button when `onChangeDay`) + count — copy the 9 lines of `VoiceResultScreen.tsx:213-221` (same strings `RS.todayCount/firstToday`, `resultDayStr` for a past day). Speakers row — `:223-231`.
2. Card `v2-saved-card`: ✓ + `savedTitle`; `LatestBadges` (T7) + `NotQueuedForServerBadge` for a single plot (`core/navigation/mainViewComponents`, as `:252`); `LegacyNote` if `legacyPartial`; `listenTitle`/`listenSub` + `ClipPlayer big` (`ClipPlayer.tsx:100`, testId `v2-play`) — or `TypedNote` for typed, nothing when no clip; `ResultHero` with `parts={false}`, `onSettled={() => undefined}` (no scroll jump), same props as `VoiceResultScreen.tsx:236-237`.
3. `givenTitle` / `givenHint`, then for each `dayLinesOf(day, language, 'now')` line with `box && boxEntry` (`DaySummaryLines.tsx:55`): `ProductTank` (`ProductRows.tsx:192`) when `answerKit`, else `ProductBoxCard` (`:69`); under each tank its `MixBox`es (`MixBox.tsx:48`, matched with `lineKeyOfVerdict`, `DaySummaryLines.tsx:95`). Card state `{ item, logId } | null` → `ProductCard` (`ProductCard.tsx:151`).
4. `RS.addedTitle` + `SavedPartsGrid` (T9) → `onTellMore`.
5. `WordsFold` open by default, no `player` (the clip is in the card), children = `Words` / `MoneyWordsWithheldCard`, `PartLinks`, the unclear box — as `VoiceResultScreen.tsx:260-276`.
6. `questionPanel`; `MixBanner` (`MixBox.tsx:85`; `onOpen` scrolls to the matching tank with `scrollBelowHeader`); `extras`; `EditButtons` (T7); `audience`; `notices`.
7. Earlier recordings: one `<details>` titled `RS.earlierTitle` (N) holding `EarlierRecording` rows (`DayParts.tsx:198`).
8. `copy.speakerDone` when `answerKit && !answerKit.canCheck && hasAnswerable` (rule of `VoiceResultScreen.tsx:197, 254-256`).
9. Big blue button `v2-open-detail`: `detailButton` / `detailSub` → `onOpenDetail`.
10. `IdleCloseBar` (T10) with `useIdleClose({ paused: !!playingId || !!card, onClose: onAutoClose, rootRef })`.

No "पक्कं आहे" here (it stays on the detail page); no projected numbers; no save calls.

- [ ] **Step 1: Failing tests** `voiceFlowV2/__tests__/SavedScreen.test.tsx` (fixture: spray Confidor 250 ml + Uthane M-45 500 g in 200 L, drip 19:19:19 5 kg, two speakers, one earlier recording; container-style mocks as `VoiceResultContainer.test.tsx:31-60`): sections appear in the order above (compare `data-testid` order); `v2-saved-card` holds `vr-remembered` and `v2-play`; tapping a product row opens `ProductCard`; the idle bar pauses while the card is open and while `playingId` is set; a red part calls `onTellMore` with its key; `v2-open-detail` calls `onOpenDetail`; no element contains "→" followed by a digit and "/१०" or "/10" (P4); `vr-confirm` is absent; the speaker line shows for a non-checker with products and not for a checker; typed recording shows `vr-typed-note` and no player.
- [ ] **Step 2: Run, fail; implement; run → PASS;** the checks. Commit `feat(result): saved screen built from the existing result pieces`.

### Task 12: Wire the saved screen, the detail page and the auto-close

**Files:** `src/clients/mobile-web/src/features/logs/components/voiceResult/VoiceResultContainer.tsx:54-83` (prop `onAutoClose?: () => void`), `:89` (state `const [detail, setDetail] = useState(false)`), `:183-251` (render); `src/clients/mobile-web/src/core/navigation/voiceResultView.tsx:132-174`; `src/clients/mobile-web/src/features/logs/components/entry/LogEntryFlow.tsx:41` (`export const EMPTY_SCOPE`).

- Container: `const v2 = FEATURE_FLAGS.voiceFlowV2 && !detail;` When `v2`: render `SavedScreen` with the values the container already has (`day`, `nodes`, `clips`, `playback.*`, `sync`, `syncQueuedById`, `confirmed`, `answerKit`, `moveDay`, `questionPanel`, `extras`, the refused / money banners moved into `notices`, the `AudienceRow` block (`:192-199`, same condition) into `audience`), `onOpenDetail={() => setDetail(true)}`, `onAutoClose={leave(() => { window.dispatchEvent(new CustomEvent('agrisync:toast', { detail: { message: voiceFlowWords(language).closedToast, type: 'success' } })); (onAutoClose ?? onBack)(); })}` (the toast event is the app's own, `app/compositionRoot.ts:37`; `leave` stops playback, `:177`). Otherwise: today's render. In detail mode, `VoiceResultScreen` gets `onBack={() => setDetail(false)}` (only when the flag is on) and `useBackDismiss(FEATURE_FLAGS.voiceFlowV2 && detail, () => setDetail(false))` (LIFO stack, `core/navigation/backStack.ts:11-25`) so Android back returns to the saved screen. The owner's "पक्कं आहे" there is unchanged; playing the clip on the saved screen already counts as `heard` (same `playback`, `:176`).
- `voiceResultView.tsx`: pass `onAutoClose={() => { ctx.handleReset(); ctx.setLogScope(EMPTY_SCOPE); }}` — `ctx.handleReset` here is the saved-screen reset (`mainView.tsx:331`: reset + voice mode); with an empty scope `LogEntryFlow` mounts on the work home (`LogEntryFlow.tsx:104`), so the mic never re-arms (spec V2-5).
- **Where "शेतीचा आढावा" is (verified):** the page "पूर्ण शेतीचा आढावा" is `ReflectPage` (`mainView.tsx:87-128`, nav label `i18n/oversightTranslations.ts:636`). It reads the same `ctx.history` (`mainView.tsx:106`) that `handleAutoSave` updates on the write (`useLogCommands.ts:340-343`, `confirmAndSave(newLogs, setHistory)`), and opens on today, so a just-saved log is there. It is a read view (no owner confirm). The blue button opens the detail result page, not ReflectPage → name clash, spec V2-6.

- [ ] **Step 1: Failing tests.**
  - `voiceResult/__tests__/VoiceResultContainer.voiceFlowV2.test.tsx` (mock flags `voiceFlowV2: true`): `v2-saved-card` shown, `voice-result` not; `v2-open-detail` → `voice-result` (the unchanged screen) with `vr-confirm` for the primary owner; its `vr-back` returns to the saved screen; after 30 s untouched → `onAutoClose` called once and one `agrisync:toast` event with the Marathi text; flag off (existing file) unchanged.
  - `core/navigation/__tests__/mainView.voiceFlowV2.test.tsx` (extend T5's file): a success status with a voice result + the 30 s close → `log-entry-flow` with `data-step="home"`.
- [ ] **Step 2: Run, fail; implement; run** `npx vitest run src/features/logs/components/voiceResult src/core/navigation src/features/logs/components/entry` → PASS (all existing files unchanged); the checks. Commit `feat(result): saved screen first, today's screen one tap away, closes to home`.

### Task 13: Click the whole journey on localhost without a backend (dev-only preview)

**13a — fixtures (no dependency).** New `src/clients/mobile-web/src/features/oversight/preview/voiceFlowV2Fixtures.ts` (Marathi allowed here; `previewAppFixtures.ts` stays Latin-only by its own rule, `:15-16`):
- `PREVIEW_V2_DRAFT: AgriLogResponse` — transcript "आज प्लॉट दोन मध्ये सात बाया आणि तीन गडी होते, सकाळी चार तास फवारणी केली, कॉन्फिडॉर अडीचशे एमएल आणि युथेन एम पंचेचाळीस पाचशे ग्रॅम, दोनशे लिटर पाण्यात, दुपारी ठिबकने एकोणीस एकोणीस एकोणीस पाच किलो सोडलं, दोन तास पाणी दिलं, ट्रॅक्टरने ब्लोअर चालवला, डिझेलला सहाशे रुपये गेले, परवा साफ फवारणी करायची आहे."; `labour` 10 (7 women, 3 men); `inputs`: one Spray row, `carrierType: 'Liters'`, 200 L, `mix` [Confidor 250 ml, Uthane M-45 500 g]; one `fertigation`/Drip row `mix` [19:19:19 5 kg, `npkGrade: '19:19:19'`]; `irrigation` drip 2 h; `machinery` tractor (blower); `activityExpenses` diesel ₹600; `plannedTasks` one; `cropActivities` spraying 4 h; `unclearSegments` one ("मागच्या बाजूचं उद्या बघू").
- `buildPreviewV2EarlierLog(today)`: a `DailyLog` on `plot-grapes-a` at 07:10 by `op-jadhav` (second speaker), labour 6 + pruning, with `fullTranscript` "सकाळी सहा बाया छाटणीला आल्या, दहा वाजता संपलं." — so `day.earlier` and the speakers row have two people.

**13b — wiring (after T5, T6, T12).**
- `src/clients/mobile-web/src/app/providers/DataSourceProvider.tsx:33-41` — `export type { DataSourceContextValue }` and add `export const DataSourceValueProvider: React.FC<{ value: DataSourceContextValue; children: React.ReactNode }>` (wraps `DataSourceContext.Provider`). Production code path unchanged.
- `src/clients/mobile-web/src/features/oversight/OversightAppPreview.tsx:313` — `const [history, setHistory] = useState(() => [...buildPreviewLogs(), ...(FEATURE_FLAGS.voiceFlowV2 ? [buildPreviewV2EarlierLog(getTodayKey())] : [])])`; pass `setHistory` down; wrap `PreviewMain` in `DataSourceValueProvider` with a stub whose `dataSource.logs` write methods reject with "Saving is disabled in this preview" and `auditPort.append` resolves (the screen then shows its honest failure line, never a fake success).
- `src/clients/mobile-web/src/features/oversight/preview/usePreviewRouterCtx.ts:77-87` (`PreviewDataState.setHistory`), `:107-118` (voice stub), `:282-284`, `:219-305` (ctx): new state `voiceResult`, `lastSavedLogIds`, `lastSavedLogSummary`. When `FEATURE_FLAGS.voiceFlowV2`, `handleAudioReady` / `handleTextReady` call `runPreviewVoiceJourney` from new `preview/previewVoiceJourney.ts`: `setStatus('processing')`; `noteVoiceJourney kept` (audio duration from `AudioData.durationMs` when present) → after 1.2 s `understood` (`PREVIEW_V2_DRAFT`) → `placeChecked same` → logs = `LogFactory.createFromVoiceResult(draft, scope, crops, profile)` with `meta.createdByOperatorId = profile.activeOperatorId` → `setHistory(prev => [...logs, ...prev])` → `written` → `setVoiceResult({ logIds, clipId: null, key: 'preview|<now>', unclear, written: logs })`, `lastSavedLogIds`, `lastSavedLogSummary` with `syncQueued: null` (honest: nothing is queued) → `setStatus('success')`. The delays live **only** in this dev-only harness (tree-shaken, `featureFlags.ts:43`); production ticks only on real events. Add `voiceResult`, `farmRole: undefined`, `moveSavedDay: undefined` to the ctx. Without the flag the preview behaves exactly as today (the notice).
- Known preview limits (say them in the PR): no clip player (clips are read from Dexie and the preview never writes Dexie); no "पक्कं आहे" (needs `syncQueued: true` and an owner role); meter shows "अजून समजतंय…" (no server). These are checked on the TEST app at Gate 2.

- [ ] **Step 1: Failing tests** `features/oversight/preview/__tests__/previewVoiceJourney.test.ts`: the harness emits `kept → understood → placeChecked → written` in order, appends the logs, sets `status` to `success` last, and the logs carry 3 products (2 spray, 1 drip) through `productBoxesOf`; `voiceFlowV2Fixtures` earlier log is on `plot-grapes-a` with another operator.
- [ ] **Step 2: Run, fail; implement; run → PASS;** the checks; then by hand: `printf 'VITE_VOICE_FLOW_V2=1\nVITE_UNDERSTANDING_METER=1\n' > .env.development.local && npm run dev`, open `http://localhost:3000/?preview=oversight` (port from `vite.config.ts:92`; the preview's own header says 3001, which is stale), allow the mic, and click: work home → "झालेले काम सांगा" → Grapes → Grapes A (card + ring) → wait 7 s (auto start) → stay silent (hints at 4/9/16 s) → speak, go quiet 5 s ("काम सांगून झालं?") → stop → step list → saved screen → product card → red part → "शेतीचा आढावा बघा" → मागे → wait 30 s → work home + toast. Commit `chore(preview): click the voice flow v2 journey on localhost`.

### Task 14 (stretch — ship without it if not merged by T15): the plot question as two buttons

**Files:** `src/clients/mobile-web/src/features/logs/components/checkSave/CheckSaveScreen.tsx:70-76` (optional props `onPickChosen?`, `onPickGuess?` → two `min-h-[52px]` buttons "<chosen> बरोबर" / "<guess>" under `otherPlotBody`); `src/clients/mobile-web/src/core/navigation/checkSaveView.tsx:77-93, 98-116` (when `FEATURE_FLAGS.voiceFlowV2 && kind === 'otherPlot' && startPlace && guess`: each button runs the existing `save()` path with that scope — `ctx.saveCheckedDraft` exactly as `:81`). Words: `checkSaveWords.ts` gets `pickMine(label)` `${label} बरोबर` (PROPOSED, both languages). The existing place picker stays.

- [ ] **Step 1: Failing test** `checkSave/__tests__/CheckSaveScreen.twoButtons.test.tsx` + a `checkSaveView` test: both buttons call `saveCheckedDraft` once with the right `scope`; flag off → no buttons. **Step 2:** implement, run `npx vitest run src/features/logs/components/checkSave src/core/navigation` → PASS; the checks. Commit `feat(check): answer the other-plot question with one tap`.

### Task 15: Integration, evidence, PR

- [ ] **Step 1:** On `task/voice-flow-v2` with all lanes merged: `npm run typecheck`, `npm run lint`, `npx vitest run` (whole suite), `npm run check:file-sizes` (same 3 base failures only), `node scripts/check-storage-discipline.mjs`, `npm run build:fieldtest` (needs a local `.env.fieldtest` with `VITE_VOICE_FLOW_V2=1`) and `npm run build:prod` with the flag absent; `grep -c "v2-saved-card" dist/assets/*.js` is ≥ 1 in both builds (code present, flag-gated) and the prod build's `FEATURE_FLAGS.voiceFlowV2` folds to false (open the app with `vite preview` and see today's screens). `dotnet` is not available in this container: say so in the PR; nothing under `src/apps/**` changed (`git diff --stat task/plr-d10-rc1 -- src/apps src/AgriSync.Bootstrapper` is empty).
- [ ] **Step 2:** Screenshots at 320 px and 412 px wide (Chrome device toolbar on the localhost preview), Marathi and English: mic card running, coach card (9 s), "काम सांगून झालं?", step list mid and end, saved screen top / products / parts / words / earlier, detail page, home + toast. Attach to the PR.
- [ ] **Step 3:** Open the PR `task/voice-flow-v2` → `task/plr-d10-rc1`. Body: `Spec: voice-flow-v2-2026-11-23` (first line), the Change Surface table, the checks output, the screenshots, the preview limits, the list of new Marathi strings for review, the spec §5 not-feasible list, and the session's PR attribution footer.
- [ ] **Step 4:** Merge only after code review **and Gate 1** below. Merging behind the flag is not a deployment; the TEST APK build (D1) is.

---

## Risks

| Risk | Mitigation in this plan |
|---|---|
| **Auto-start on Android WebView:** `navigator.permissions.query({name:'microphone'})` may answer `prompt`/throw inside the Capacitor WebView even when the app holds RECORD_AUDIO | Spec V2-2: no ring unless `granted` **or** a recording already started this session (`noteMicGranted`). Worst case on some phones: the first recording of a session needs a tap, the next ones auto-start. Checked at Gate 2 on both phones. |
| **Mic opens when he did not intend it** (back from a result, auto-close, typing) | Arm only on a plot tap (T5); typing sheet holds (T4); auto-close goes to the work home (T12); hidden page holds (T4). |
| **Timers in the background / phone sleeps** | All timers are deadline-based; hidden → countdown held, idle-close frozen; no auto-start while hidden. |
| **Field noise** (wind, tractor) keeps the level above `SPEECH_LEVEL` → no "done?" popup, no coaching | Hints are optional (P9); threshold is one constant tuned at Gate 2. Nothing blocks the stop. |
| **Quiet speaker** below the threshold → coaching while he speaks | Coaching stops at the first detected speech; Gate 2 checks a soft-spoken read; constant can drop to 0.08. |
| **Old phones (P11)** | No new canvas or video; the one SVG ring and the bar animate via CSS under `motion-safe`; `ResultHero`'s existing ring is the only heavy piece and already runs on the result screen today. 320 px screenshots required. |
| **Accessibility** | Hints `role="status"` polite; countdown text readable; all buttons ≥ 48 px; reduced motion = no sweep/pulse; haptics via `hapticFeedback` (off switch respected). |
| **Owner confirms less often** (screen closes before he opens the detail page) | No trust change: the record stays "पक्कं नाही" and reaches the owner's review list as today. Watch at Gate 2; founder may lengthen the timer or move "पक्कं आहे" up in a follow-up. |
| **Step list looks "stuck" on step 2** for long notes (encode ≈ speech length for ≤ 60 s, then server) | That is the true pipeline (spec §3); a calm "थोडं थांबा…" line; Phase A speed work (separate plan) shortens it. |
| **Merge conflicts in `RecorderFace.tsx`** (T3 and T4) | Region split (T3 `:59-102`, T4 `:104-167`), T0 already added the shared prop. |
| **`useVoiceRecorder.ts` growth** | Not touched by any task. |

## Rollback

- **Runtime:** set `VITE_VOICE_FLOW_V2=0` (or remove it) in the PC's `.env.fieldtest` and rebuild the TEST APK — every new path is behind `FEATURE_FLAGS.voiceFlowV2`; saved records are identical either way (no save, sync or schema change), so nothing needs migrating back.
- **Code:** revert the merge commit on `task/plr-d10-rc1`. No DB rollback exists to rehearse (E8 n/a: no migration).

---

## Founder Acceptance Gate

**Gate 1 — localhost preview, before the merge (founder on his PC, Chrome, phone-size window 360 px and 320 px):** `http://localhost:3000/?preview=oversight` with `VITE_VOICE_FLOW_V2=1` and `VITE_UNDERSTANDING_METER=1` in `.env.development.local`.
- [ ] Work home → "झालेले काम सांगा" → crop → plot: the card shows "आता बोला", the crop·plot line, the big mic, the 7 s ring, the example, "थांबा, अजून प्लॉट निवडायचे आहेत".
- [ ] A second plot tap restarts the ring; "थांबा…" stops it; "बोलता येत नसेल तर इथे लिहा" still opens "लिहून सांगा" and stops the ring.
- [ ] No tap: listening starts by itself at 7 s with Sathi's "आता बोला — मी ऐकतोय" bubble (no sound).
- [ ] Silent: one example at 4 s, the 3-question card at 9 s, the stop line at 16 s. Speak, then quiet 5 s: "काम सांगून झालं? तर खालचं लाल बटण दाबा" above the red button and the button pulses; the red button works on the first tap.
- [ ] After stop: the step list with chips for parts and products (Confidor, Uthane M-45, 19:19:19 with their type words); step 1 says "फोनवर सुरक्षित".
- [ ] Saved screen in the approved order (place/day/count, speakers, जतन झालं card + badges, meter, तुम्ही काय दिलं, 8 parts with red untold, his words + why-tiles + unclear box, earlier recording fold, blue button, bottom bar).
- [ ] A product row opens its card and the 30 s bar says "थांबवलं"; closing it restarts at 30.
- [ ] "शेतीचा आढावा बघा" opens today's full result screen; मागे returns. **Rule V2-6:** keep the label, or rename to "सविस्तर बघा" — `[ ] keep` / `[ ] rename`.
- [ ] Untouched for 30 s → work home + toast "आजचं काम जतन झालं ✓ — …"; the mic does not start by itself there.
- [ ] Marathi strings (list in the PR) approved or corrected.

**Gate 2 — TEST APK on two real phones (founder's + one ≤ 3 GB Android), after D1:**
- [ ] Auto-start works after the first recording of a session on both phones (and on the first, if the phone reports the permission).
- [ ] Hints appear and disappear correctly outdoors (wind/field noise) and for a soft voice.
- [ ] Real recording: step list ticks honestly (no tick before its event); saved screen plays his voice ("तुमचा आवाज ऐका") and the 30 s bar pauses while it plays; the meter shows the server score (or "अजून समजतंय…", never a made-up number).
- [ ] Owner: "शेतीचा आढावा बघा" → "पक्कं आहे" works ("ऐका आणि पक्कं करा" after playing on the saved screen). Worker / मुकादम: speaker line shown, no confirm.
- [ ] A recording Sathi thinks is another plot → "तपासा आणि जतन करा" as today (or Task 14's buttons).
- [ ] The just-saved log is visible on "पूर्ण शेतीचा आढावा".
- [ ] Flag off build (rebuild with `=0`) looks exactly like today.

## Deployment (gated on the founder — do not tick before Gate 1)

The TEST app is built on the founder's PC (test stack), never from CI and never pointed at the live server (`.env.fieldtest.example:1-9`, `android/app/build.gradle:34-43`). `scripts/deploy-s3.sh` is the **production** web deploy and is **not** used here.

- [ ] **D0 (after Gate 1):** merge PR into `task/plr-d10-rc1`; record the merge SHA.
- [ ] **D1 — TEST APK:** on the PC, in `src/clients/mobile-web`: add `VITE_VOICE_FLOW_V2=1` to `.env.fieldtest` → `npm run build:fieldtest` → `npx cap sync android` → `cd android && ./gradlew assembleFieldtest` → `adb install -r <the APK path Gradle prints for the fieldtest variant>` on both phones (path not verified in this checkout). **Evidence (paste into the tracker row):** merge SHA; `dist/assets/index-*.js` hash; `adb shell dumpsys package com.agrisync.shramsafal.test | grep versionName` (ends `-test`); `chrome://inspect` console boot marker (`BUILD_TAG`, `src/buildInfo.ts:13`); test server `GET /version` → HTTP 200 with the **unchanged** server SHA (proves no server change rode along).
- [ ] **D2 — tracker:** a `DEPLOYMENT_TRACKER.md` row (the tracker lives in the private cofounder OS, not in this checkout; the CTO session writes it): date, "voice-flow-v2 TEST APK", merge SHA, bundle hash, phones, flag value, Gate 1 ✓.
- [ ] **Gate 2** ticked (above) → founder decides on promotion. **Production is out of scope for this plan:** `.env.production.example` stays `=0` and the flag is not added to `release.yml` / `android-release.yml`; a promotion needs its own decision, the prod `/version` SHA (`https://api.shramsafal.in/version`) and its own tracker row.
