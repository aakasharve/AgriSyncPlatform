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
