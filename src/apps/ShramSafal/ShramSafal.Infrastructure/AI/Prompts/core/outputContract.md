Return this JSON shape exactly:

{
  "summary": "string",
  "dayOutcome": "WORK_RECORDED|DISTURBANCE_RECORDED|NO_WORK_PLANNED|IRRELEVANT_INPUT",
  "cropActivities": [],
  "irrigation": [],
  "labour": [],
  "inputs": [],
  "machinery": [],
  "activityExpenses": [],
  "observations": [],
  "plannedTasks": [],
  "disturbance": null,
  "missingSegments": [],
  "unclearSegments": [],
  "questionsForUser": [],
  "fieldConfidences": {},
  "confidence": 0.0,
  "fullTranscript": "verbatim transcript",
  "english": "string",
  "english_redacted": "string",
  "referenced_date": "YYYY-MM-DD",
  "referenced_date_confidence": 0.0,
  "referenced_date_reason": "string"
}

Required contract:
- Arrays must be arrays, never null.
- Unknown scalar values should be omitted or set to null only when schema expects nullable values.
- Confidence values must be between 0.0 and 1.0.
- Every extracted object should include sourceText and systemInterpretation when possible.
- Past execution goes to execution buckets.
- Future intent goes to plannedTasks and reminder observations.
- Non-execution facts go to observations.
- Blockers go to disturbance and may also appear as issue observations.
- Do not emit zero-duration or issue-only irrigation rows for failed watering. Use disturbance.blockedSegments=["irrigation"] instead.

ADDITIONAL VOICE-SPINE FIELDS (Sarvam pipeline, Phase 1.12):

These five top-level fields sit alongside the bucket structure above. They are optional in the wire schema (legacy responses without them still parse) but the structurer SHOULD emit them on every call. Omit a field entirely (do not emit empty strings) when no signal supports it.

- `english` (optional, string): Full transcript translated to natural English.
  Use for cross-language analytics and admin dashboards. Translate names,
  amounts, and quantities literally. Do NOT redact PII here — that goes in
  `english_redacted`. Keep the translation faithful to dialect (e.g. preserve
  "spray" as "spray", not "sprayed pesticide"). Numbers, dates, currency
  values stay literal in figures (write "250 rupees", not "two hundred fifty").
  Example: input "आज द्राक्षांना spray मारला, 250 रुपये खर्च" →
  english: "Today sprayed the grapes, spent 250 rupees."

- `english_redacted` (optional, string): Same English text as `english` but
  with named entities replaced by ordered tokens. Use exactly these token
  families: `[FARMER_N]`, `[PHONE_N]`, `[PLOT_N]`, `[WORKER_N]`, `[VENDOR_N]`.
  N is the 1-indexed occurrence-order within this clip — first farmer
  mentioned = [FARMER_1], second different farmer = [FARMER_2], same farmer
  mentioned again later = [FARMER_1] (preserve identity across occurrences).
  Numbers, dates, currency amounts STAY literal — they are not PII.
  Plot names that are generic ("उत्तरेकडचा प्लॉट" / "north plot") may stay
  literal; only redact plots when the farmer uses a proper-noun nickname
  (e.g. "रामूचा प्लॉट" → "[PLOT_1]"). When in doubt, redact.
  Example: input "रामूने 9876543210 वर call केला, 250 रुपयांसाठी" →
  english_redacted: "[FARMER_1] called [PHONE_1] for 250 rupees."

- `referenced_date` (optional, ISO-8601 date "YYYY-MM-DD"): The date the
  farmer is talking ABOUT, which may differ from `captured_at` (the
  timestamp when the recording happened — supplied in the prompt context).
  Resolve from temporal cues:
    - "आज" / "today" / "aaj" → captured_at date (same day).
    - "काल" / "yesterday" / "kal" → captured_at date - 1 day.
    - "परवा" / "day before yesterday" → captured_at date - 2 days, BUT
      ONLY when the surrounding verb is past-tense (e.g., "परवा फवारणी
      केली होती"). If the verb is future-tense ("परवा फवारणी करणार"),
      परवा means "day after tomorrow" — for AgriSync's voice-diary use
      case (logging completed work), this is rare; if encountered, OMIT
      `referenced_date` rather than guess. Set `referenced_date_confidence`
      ≤ 0.7 if you resolved परवा and cite the verb evidence in the reason.
    - "मागच्या सोमवारी" / "last Monday" → most recent Monday strictly
      before captured_at.
    - Explicit dates ("15 मे" / "May 15") → that calendar date in the year
      of captured_at (or the most recent past occurrence if the date is
      ambiguous about year).
  If NO temporal cue is present, OMIT this field entirely. Do NOT default
  to captured_at — the absence of a signal is itself a signal.

- `referenced_date_confidence` (optional, number 0.0–1.0): Your confidence
  in the date resolution. Reference scale:
    - 1.0 for explicit, unambiguous dates ("15 मे 2026" / "May 15 2026").
    - 0.9 for "yesterday" / "काल" on a clear utterance.
    - 0.75 for "last Monday" style relative-weekday cues.
    - 0.6 for ambiguous phrases like "मागे" / "recently" / "the other day".
    - Below 0.5: prefer omitting `referenced_date` entirely.

- `referenced_date_reason` (optional, short string, max ~120 chars):
  One-line explanation of how you derived the date. Format suggestion:
  `User said '<cue>' on <captured_at_date> → <referenced_date>`.
  Example: "User said 'काल' on 2026-05-22 → 2026-05-21".
  This field is human-readable audit metadata; it is not parsed by code.

WAVE-2 PER-EVENT FIELDS (additive, optional):

These fields sit INSIDE the existing bucket rows (inputs[], labour[],
irrigation[], machinery[], cropActivities[]) — they do NOT add any new
top-level array or change the top-level shape above. Every field is
OPTIONAL and back-compatible: legacy responses that omit them still parse.
Emit a field ONLY when the farmer's words support it; otherwise OMIT it
(or set null where a nullable value is expected). Three governing rules
apply to the whole section:

  - NO-GUESS: never infer a value the farmer did not state. Absence of a
    signal is itself a signal — leave the field out rather than default it.
  - NO-MULTIPLY: never fabricate a total by doing arithmetic the farmer did
    not do out loud (e.g. rate × count). Store amounts exactly as spoken.
  - ABSTENTION: when the farmer clearly performed an operation but a detail
    is unstated, keep the row and omit the unstated field — do not invent it,
    and do not drop the whole event.

Inputs (inputs[] rows and their mix[] items)
- `mix[].basisQty` (optional, number): the reference quantity a dose is
  stated *per* (e.g. "4 ml प्रति लिटर" → dose 4, basisQty 1). OMIT when the
  farmer states only a bare dose with no "per <X>" basis (dose-basis
  abstention). Never back-compute a tank total from dose × basis.
- `mix[].basisUnit` (optional, string): the unit of `basisQty` (e.g. "L",
  "vine", "pump"). Pairs with `basisQty`; omit both when no basis is spoken.
- `mix[].npkGrade` (optional, string): the N-P-K grade string EXACTLY as
  spoken (e.g. "19:19:19", "0:52:34", "13:0:45"). Preserve it as a grade
  string — never reinterpret the digits as a time, dose, or count.
- `mixId` (optional, string): groups products sprayed together in ONE tank
  mix. Assign the SAME `mixId` to every inputs[] row (or mix[] item) the
  farmer combined in a single tank on a single pass; distinct tanks get
  distinct ids. OMIT when there is only one product / no grouping signal.
- `passId` (optional, string): groups inputs applied in the SAME spray pass
  over the field (a pass may contain several sequential tank mixes). OMIT
  when no multi-pass / sequencing signal is present.
- `carrierMedium` (optional, enum `water|oil|none`): the medium the input was
  carried in. Spray water is `water`; a neat/undiluted application is `none`.
  OMIT when the carrier is not stated.
- `method` gains an additional value `paste_manual` (alongside the existing
  `Spray|Drip|Drenching|Soil`): use for hand-applied pastes (e.g. cut-paste,
  wound dressing) daubed manually rather than sprayed or drenched.
- `reason` gains grape-purpose values (snake_case, intentional):
  `defoliation`, `root_growth`, `nutrient_correction`, `fruit_sizing`,
  `disease_control` (alongside the existing reasons). Choose the one the
  farmer's stated PURPOSE maps to; OMIT when the purpose is not stated.
- `recommendedBy` (optional, string): who advised the input, EXACTLY as
  spoken (e.g. "दुकानदार" / "shopkeeper", an agronomist's name). OMIT when
  no advisor is mentioned — do not attribute to the farmer by default.

Labour (labour[] rows) — no-multiply governor is strict here
- `count` (optional, number): number of workers, as spoken.
- `gender` (optional, enum `male|female|mixed|unknown`): worker gender as
  stated; `mixed` when both are present; OMIT (or `unknown`) when unstated.
- `engagementType` (optional, enum
  `hired_daily|contract_piece|self|exchange`): how the labour was engaged.
  OMIT when the engagement basis is not stated.
- `rate` (optional, number): the per-unit rate spoken (e.g. 500 for
  "५०० रुपये रोजाने"). Store the rate itself, never a computed total.
- `rateBasis` (optional, enum
  `per_person_day|per_vine|per_row|per_acre|lump_sum`): the unit the `rate`
  is charged per. OMIT when the basis is not spoken.
- `totalCost` stays NULL unless the farmer states an explicit total. Do NOT
  derive it from rate × count (no-multiply) — a rate-per-vine with a vine
  count is NOT an unambiguous total unless the farmer says the total out loud.

Irrigation (irrigation[] rows)
- `role` (optional, enum `spray-carrier|irrigation|fertigation`): the WATER
  ROLE. Water that merely carries a spray is `spray-carrier` (and generally
  belongs on the input row, not as an irrigation event); actual watering is
  `irrigation`; nutrients dosed through the water line is `fertigation`.
  OMIT when the role is ambiguous.
- `weatherAdjusted` (optional, boolean): `true` ONLY when the farmer says the
  watering duration/volume was changed because of weather (e.g. rain cut the
  run short). OMIT (do not emit `false`) when no weather adjustment is stated.

Crop activities (cropActivities[] rows) — continuity progress
- `progress` (optional, object): tracks multi-day continuation of the same
  task. Shape: `{ phase?, unitsDone?, unitsTotal?, unit? }`.
  - `progress.phase` (optional, enum `LAND_PREPARATION|CROP_CYCLE`).
  - `progress.unitsDone` (optional, number): units completed in THIS session,
    as spoken (e.g. "आज ८ ओळी" → 8).
  - `progress.unitsTotal` (optional, number): the total target when stated
    (e.g. "एकूण १२ पैकी" → 12). OMIT when the total is not stated.
  - `progress.unit` (optional, string): the unit ("rows", "vines", "acres").
  OMIT the whole `progress` object when there is no continuation signal.

Machinery (machinery[] rows) — no-fabrication governor
- `implement` (optional, string): the attached implement/tool as spoken
  (e.g. "blower", "rotavator", "sprayer"). OMIT when not stated.
- `nozzlesActive` (optional, number): count of active nozzles as spoken
  (e.g. "१० nozzle चालू" → 10). OMIT when not stated.
- `fanState` (optional, enum `on|off|unknown`): blower/air-assist fan state.
  Set `off` ONLY when the farmer says it was off, `on` when on; OMIT (or
  `unknown`) when the fan is not mentioned — never fabricate "unknown" as if
  it were an observed state.
- `fuelType` (optional, enum `diesel|petrol|unknown`): fuel type as stated;
  OMIT when unstated.
- `fuelQuantity` (optional, number): fuel amount as spoken; NULL/OMIT when
  not mentioned — never estimate from hours or area.
- `operationPerformed` (optional, string): what the machine did, as spoken
  (e.g. "फवारणी", "नांगरणी"). OMIT when not stated.
