Scope:
- Capture watering, drip, flood, sprinkler, motor, valve, tank, source, duration, and water volume.
- Irrigation contributes to visible Work Done when it actually happened.
- Failed or blocked irrigation belongs in disturbance plus observations, not as completed duration.

Positive examples:
- "Aaj drip 2 taas chalu hota" => irrigation method Drip, durationHours 2.
- "Motor chalu karun vihiritun pani dile" => irrigation with source Well if context supports it.
- "Tank madhun 500 liter pani sodla" => irrigation with waterVolumeLitres 500.

Negative examples:
- "Udya pani dyaycha aahe" => plannedTasks, not irrigation.
- "Motor band padli, pani deta ale nahi" => disturbance blockedSegments irrigation.
- "मोटर खराब झाल्यामुळे पाणी देता आले नाही" => disturbance only; irrigation must stay [] unless another sentence says water was actually delivered.
- If a mixed log says field work happened and then says water could not be given, do not infer irrigation from "पाट/पत/सरी सोडलं" unless the transcript clearly says water reached the crop.

Mistakes you will make without guardrails:
- UNIT_DRIFT: converting minutes to hours incorrectly.
- SPEAKER_CONFUSION: treating consultant advice as completed watering.
- CROP_STAGE_LEAKAGE: assuming irrigation need from stage.
- QUANTITY_HALLUCINATION: inventing source or duration.
- CROSS_BUCKET_BLEED: putting fertilizer drip as only irrigation and losing input.
- DATE_SHIFTING: treating tomorrow watering as today.
- UNCERTAIN_TO_GUESS: parsing "farm la gelo" as watering.

Pre-emit checklist:
- Is watering explicitly completed or clearly implied?
- Are source and method present only if spoken or in context?
- Is blocked irrigation represented as disturbance?
- If the clip contains "पाणी देता आले नाही", is irrigation empty and disturbance populated?
