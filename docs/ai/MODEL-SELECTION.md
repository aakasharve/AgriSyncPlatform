# AI model selection: decision record

Last updated: 28 Nov 2026. Spec: `plr-d10-schedule-mechanism-pilot-2026-11-22`.

> **Rule: before any change of model for any AI step, re-run the side-by-side test on the golden set and update this file.**
> A model name or a vendor claim is a perishable fact. A change is made on measured results on our own data, not on brand
> or on published numbers, and the new result goes in the "Measured baseline" section below in the same change. A candidate
> has to beat that baseline.

## Decision (founder, 28 Nov 2026, for the 3 Dec pilot)

| Step | Who does it | Model | Setting (where) |
|---|---|---|---|
| Hearing the voice (speech to text) | Sarvam | `saaras:v4`, codemix, `mr-IN` | `Sarvam:SttModel`, `Sarvam:SttMode`, `Sarvam:SttLanguage` (unchanged) |
| **Sorting** the Marathi transcript into the structured log (work, labour, water, products with dose, tank, done vs planned) | **Google Gemini** | **`gemini-3.5-flash-lite`** | `Ai:Structurer:Provider` = `Gemini`, model in `Gemini:StructurerModelId` |
| Backup sorting, once, only if Gemini fails | Sarvam | `sarvam-105b-conversations` | `Ai:Structurer:Fallback` = `Sarvam`, model in `Sarvam:ChatModel` |
| Bills and sale slips (photos) | Gemini | `gemini-3.5-flash-lite` | `Gemini:OcrModelId` (unchanged) |

**Gemini never receives audio.** The 23 Nov order ("no Gemini on voice") is reversed for the text-sorting step only.
Gemini is handed the words Sarvam heard, as plain text, and nothing else. This is enforced three times: the orchestrator asks
providers a separate question for recordings (`CanHandle`, which Gemini answers false) and for transcripts
(`CanStructureTranscript`, true), the sorting call only ever carries `text/plain`, and `GeminiAiProvider.ParseVoiceAsync`
refuses any input that is not `text/*` before reading it or contacting Google.

The pilot decision keeps Sarvam for what it is best evidenced for (hearing Indian voices) and moves only the step where its
4,096-token answer cap forces long talks into blind pieces.

## Why Gemini 3.5 Flash-Lite for sorting

Sources: web research on 28 Nov 2026 of the official pages
([Gemini pricing](https://aistudio.google.com/docs/pricing), [Gemini deprecations](https://aistudio.google.com/docs/deprecations),
[Sarvam 105B](https://docs.sarvam.ai/api/getting-started/models/sarvam-105b.md),
[Sarvam pricing](https://docs.sarvam.ai/api-reference-docs/getting-started/pricing)), plus our own code and notes.
The full comparison note is in the private cofounder repo:
`_COFOUNDER/Projects/AgriSync/Operations/PreLaunchRepair/plans/repairs/part03/SORTING-MODEL-SARVAM-VS-GEMINI-2026-11-28.md`.

- **Long talks.** Gemini 3.5 Flash-Lite takes a million tokens in and 65,536 out, so a whole talk is sorted in ONE call. On
  Sarvam 105B our plan allows a 4,096-token answer and a 32K window, so a talk longer than about 190 spoken tokens (roughly 30
  seconds) is cut into pieces that cannot see each other: a tank of water in one sentence and the spray in the next can be lost
  (accuracy risk D6-2).
- **Answers in a fixed format.** Gemini enforces JSON at the API (JSON mode, and a response schema where we give one). Sarvam
  offers `json_schema` with a strict flag that is off by default; whether strict is truly enforced on 105B is unverified.
- **Cost of sorting one 25-second log** (8-acre farm, about 11,000 tokens in and 930 out; Rs 96 = $1):

  | Model | Per log | With prompt caching |
  |---|---|---|
  | Sarvam 105B | Rs 0.13 | n/a |
  | Gemini 3.1 Flash-Lite (what the live app runs) | Rs 0.40 | n/a |
  | **Gemini 3.5 Flash-Lite (chosen)** | **Rs 0.54** | about Rs 0.30 |
  | Gemini 3.8 Flash | Rs 1.13 | about Rs 0.52 (Rs 2.25 uncached from 1 Jan) |

  For an 8-acre farm (about 240 logs a month) the chosen model costs about Rs 40 a month more than Sarvam if cached. Prices of
  both vendors change on 1 Jan 2027; Sarvam's 105B price (Rs 10 in / Rs 25 out per 1M tokens) is an introductory price through
  the end of 2026.
- **Published numbers** (VENDOR = published by the maker; INDEP = Artificial Analysis or LMArena). Nobody has published
  Marathi, code-mixed or JSON-reliability numbers for any of the four models, and the intelligence-index pages conflict, so
  they cannot rank the models. The most reliable independent figures are speed: the Gemini Flash-Lite models answer in about
  3 s (output 333 to 427 tokens/s, INDEP), while Sarvam's 17.4 s first token was measured with reasoning ON; our setup has
  reasoning off, which nobody has measured. Sarvam's own claim (about 90% wins in pairwise Indic comparisons across 22 languages)
  is VENDOR, judged by Gemini 3, with no Marathi figure.
- **Data.** Gemini paid API: not used for training; processing is global (a Mumbai region for 3.x is unconfirmed); every
  outbound call is logged in `ssf.cross_border_transfers`. Sarvam: API hosting and retention are not published; ask in writing.
- **No live internet lookups in the sorting step.** Facts shown to a farmer come only from the checked product library.

### What was investigated

- **Long-talk piece-cutting.** Sarvam's 4,096-token answer cap, measured live (2026-10-31): a segment of about 547 estimated
  transcript tokens produced 3,721 answer tokens and was cut off; six complete segments of at most 257 tokens answered at
  8.5 to 12.9 answer tokens per spoken token. The plan therefore cuts at about 187 spoken tokens and splits any cut-off answer in
  half. This keeps the result complete but not coherent across pieces. With Gemini the same talk goes in one call.
- **The speed problem.** Server stage timing exists since 23 Nov (`[voice-timing]`: raw-audio write, speech-to-text, sorting,
  total), and speech-to-text pieces and sorting parts already run in parallel (`Ai:Structuring:MaxParallel`). What is NOT yet
  known is how long Gemini 3.5 Flash-Lite takes on our real prompt: the figures above are independent and generic. The
  `[voice-timing]` line now names the sorting provider and model, so the first runs on the test stack give the real number.

## How it is wired

- **Choosing the sorter.** `Ai:Structurer:Provider` (`Gemini` or `Sarvam`) decides who sorts the transcript. When it is empty
  the `ssf.ai_provider_configs.structurer_provider` column decides, as before (set to Sarvam by migration
  `20261124090000_SetVoiceProvidersToSarvam`). **No migration is needed for the pilot**: the setting wins over the column, so the
  database row stays `Sarvam / Sarvam` and a rollback is a settings change (`Ai__Structurer__Provider=Sarvam`,
  `Ai__Structurer__Fallback=None`) plus a restart. The admin-page model switch is a post-pilot item and does not override this
  setting.
- **Backup.** If Gemini times out (60 s), answers 5xx, or still gives an unusable answer after its own one retry, the SAME
  transcript is sorted once by `Ai:Structurer:Fallback` (Sarvam 105B), text only, so the farmer still gets a result. An unsure
  (low-confidence) answer is kept and shown with its "not sure" marks, not re-sorted. A refused input is not re-sorted. The admin
  kill switch for fallbacks (`FallbackEnabled`) also switches the backup off. If both fail the note is stored and the phone is
  told to send it again later (HTTP 503). The attempt that answered is on the job (`FallbackSucceeded` when it was the backup).
- **One call per talk.** With Gemini the whole transcript is sorted in one call (`GeminiAiProvider.ParseVoiceAsync`). Only an
  answer that is actually cut off at the output cap is split in half and retried (logged, never silent). The answer cap is
  `Gemini:StructurerMaxOutputTokens` = 32,768 (half the model's 65,536; thinking tokens count against it). Sarvam
  speech-to-text piece-cutting (pieces of at most 30 seconds, `Sarvam:SttMaxParallelPieces`) is unchanged.
- **Answer format.** Gemini JSON mode (`responseMimeType: application/json`) plus an ENFORCED response schema
  (`responseJsonSchema`, `StructurerResponseSchema.cs`, switch `Gemini:StructurerResponseSchema`, on in the pilot). The schema
  fixes the skeleton only: the answer is an object, `dayOutcome` is present and is one of the four values the app knows, and
  the eight row buckets (`cropActivities`, `irrigation`, `labour`, `inputs`, `machinery`, `activityExpenses`, `observations`,
  `plannedTasks`) are arrays of objects. The rows themselves are OPEN objects (`additionalProperties: true`, no property
  list), and keys it does not name (`summary`, `disturbance`, `missingSegments`, `referenced_date`, ...) stay free, because a
  field the schema forgot to name would be silently dropped by the model. The prompt text is not changed. The verification
  (CoVe) prompt asks for a score, not a day, and gets no schema. Sarvam gets none (its strict mode is unverified).
- **A broken answer is a failure, never a day** (CTO scope add, 28 Nov 2026, after the 20-sample test). Every answer, from
  either sorter, is checked by `AiAnswerInspector` inside the call that has its own one retry; the normalizer checks again and
  throws `BrokenModelAnswerException`.
  - *Not JSON, not an object, empty, or no usable `dayOutcome` with no work row and no disturbance:* a failed call. It used to
    become an empty `WORK_RECORDED` day that reported success (live: a 3.5 Flash-Lite answer with a stray
    `- "femaleCount": 3` line lost the labour).
  - *A key repeated with a different value:* a failed call. It used to keep the LAST value (live: Sarvam wrote
    `"inputs":[2 products]` and later `"inputs":[]`, and the saved log had no products). A key repeated with the SAME value is
    collapsed silently.
  - What happens next is the normal chain: one retry, then the Sarvam backup (text only), and if everything fails the call
    fails as a retryable "the AI failed this time" (HTTP 503 or 400 `AiParsingFailed`). The phone keeps the recording and his
    words and understands them later (the unheard-voice path, आवाज नोंदी, decision D-59). No phone change is needed.
  - Both cases are logged with the provider and model so they can be counted:
    `[answer-check] provider=Gemini|Sarvam model=... problem=Unparseable|Empty|NotAnObject|ConflictingDuplicateKeys|NoDayOutcome|IdenticalRepeatedKeys`.
  - Unchanged on purpose: an answer with work in it but no `dayOutcome` still defaults to `WORK_RECORDED`; the receipt and
    sale-slip path (`NormalizeGenericJson`) keeps its old tolerance.
- **Thinking.** Off (`Gemini:StructurerThinkingBudget` = 0): sorting is extraction, and thinking tokens cost money and eat the
  answer cap. If the API rejects a budget for this model, set `Gemini:StructurerThinkingLevel` (`minimal` or `low`) instead; it
  replaces the budget. A negative budget sends neither.
- **Caching.** Gemini's automatic (implicit) caching serves the repeated start of a request. The fixed prompt is sent as the
  system instruction, first. The explicit cache API (`cachedContents`) is NOT implemented; each sorting call logs
  `promptTokens` and `cachedTokens` as Gemini reports them, so the first real runs show whether the saving is real. Follow-up:
  explicit caching if `cachedTokens` stays 0.
- **Timing.** The server `[voice-timing]` line now ends its stage numbers with `structProvider`, `structModel` and
  `structFallback` (`none` when no sorting stage ran). The `Server-Timing` header is unchanged.
- **Typed text** (no recording) and the streaming and evaluation parses go through the same sorter and backup.

## Measured baseline (golden set, 28 Nov 2026): a candidate has to beat this

**How it was measured.** The 20 golden-set sentences, 3 passes each (60 calls per model), with the byte-identical prompt of the
test branch at `8c5c1a6e`. Scoring map written before any answer existed. A sentence passes when all of its main checks pass
(product names, doses, tank water, labour, done vs planned, mix grouping, day outcome). "Clean 15" leaves out the 5 sentences
that appear inside the prompt's own examples. Raw data and the scorer (outside the repo, read-only):
`E:\APPS\Running App Versions\.tmp-evalcmp\` (`SCORING-MAP.md`, `scored-summary.json`, `examples.txt`). That run had no response
schema and no answer check; the pilot settings above are what the baseline now stands for.

| | Sarvam 105B (`sarvam-105b-conversations`) | Gemini 3.1 Flash-Lite (live app today) | **Gemini 3.5 Flash-Lite (pilot)** | Gemini 3.8 Flash |
|---|---|---|---|---|
| Sentences passed, all 20 x 3 | 44 / 60 (73%) | 54 / 60 (90%) | **56 / 60 (93%)** | 59 / 60 (98%) |
| Sentences passed, clean 15 x 3 | 36 / 45 (80%) | 42 / 45 (93%) | **41 / 45 (91%)** | 44 / 45 (98%) |
| Product names | 40 / 51 | 48 / 51 | **51 / 51** | 50 / 51 |
| Doses and units | 9 / 9 | 9 / 9 | **9 / 9** | 9 / 9 |
| Tank water | 1 / 3 | 3 / 3 | **3 / 3** | 3 / 3 |
| Labour | 13 / 15 | 15 / 15 | **13 / 15** | 15 / 15 |
| Done vs planned | 75 / 75 | 75 / 75 | **75 / 75** | 75 / 75 |
| Mix grouping | 2 / 9 | 6 / 9 | **9 / 9** | 9 / 9 |
| Day outcome | 15 / 15 | 15 / 15 | **12 / 15** | 15 / 15 |
| Broken answers | 0 (but a repeated `inputs` key lost the products twice) | 0 | **1** (pass 2, earthing-up: not valid JSON, labour lost) | 1 (cut off at the 4,096-token cap: thinking ran past it) |
| Seconds per call, median / worst | 0.62 / 2.1 | 1.53 / 2.4 | **1.42 / 2.3** | 8.4 / 36.8 |
| Rupees per call, median (cached tokens counted at full price) | 0.085 | 0.217 | **0.292** | 0.868 |

**Decision from it.** 3.5 Flash-Lite stays the pilot's sorter: 93% against Sarvam's 73%, as fast as the live model, about a third
of the price of 3.8 Flash, which scored 98% but had an 8.4 s median, a 36.8 s worst call and one answer that ran out of room.

**Rule for a change.** A candidate is run the same way (same sentences, 3 passes, byte-identical prompt, the pilot settings) and
has to beat 56 / 60 overall without scoring lower than the pilot model on any row above; its broken-answer count and its
seconds per call are reported next to it, and a worse number needs the founder's word. Replace the pilot column here in the same
change.

**Known prompt-side items (recorded, NOT fixed here: a prompt change needs the founder's word).**
- 3.5 Flash-Lite answers `IRRELEVANT_INPUT` for "आज काही काम नव्हतं" where `NO_WORK_PLANNED` is expected (day outcome 12 / 15).
- The prompt's own Ethrel mix example (`MarathiPromptData.cs`, line 152) carries no `mixId`.

## Not part of this decision (after the pilot)

Admin-page model switches, once-only internet product lookups into the product library, and schedule brand lines.

## Not verified yet

No real Gemini or Sarvam call was made for this change (all tests use fakes). To check with the real key: the model id
`gemini-3.5-flash-lite` answers; `thinkingBudget: 0` is accepted for it; the response schema is accepted (in particular
`additionalProperties: true` on the open rows; if the API refuses it, set `Gemini:StructurerResponseSchema` to `false` and the
call falls back to JSON mode plus the answer check) and does not change what real answers contain (a row still carries `mixId`,
`carrierVolume`, `sourceText`); the answer is valid JSON for a real Marathi talk; a 90-second talk is one call; `cachedTokens`
appears in the log; the backup fires when Gemini is made to fail; the `[answer-check]` lines appear when an answer is broken.
After the schema, re-run the golden-set test and replace the pilot column above.
