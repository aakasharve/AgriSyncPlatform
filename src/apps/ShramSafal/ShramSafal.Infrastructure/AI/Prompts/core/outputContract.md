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
  "fullTranscript": "verbatim transcript"
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
