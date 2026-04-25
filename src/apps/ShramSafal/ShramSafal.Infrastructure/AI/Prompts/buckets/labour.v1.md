Scope:
- Capture people who worked, labour type, male/female counts, total count, hours, wage, contract, cost, and activity.
- Separate distinct worker groups when counts or activities differ.

Positive examples:
- "Teen lokanni favarni keli" => labour count 3, activity spraying.
- "Char bhau ani don bayka nindani keli" => maleCount 4, femaleCount 2, activity weeding.
- "Contract ne 2 acre chhatani keli" => labour type CONTRACT, contractQuantity 2, contractUnit Acre.

Negative examples:
- "Labour la call karaycha aahe" => plannedTasks coordination, not labour execution.
- "Labour aala nahi" => disturbance or observation, not completed labour.

Mistakes you will make without guardrails:
- UNIT_DRIFT: treating hours as worker count or wage.
- SPEAKER_CONFUSION: counting family mention when they did not work.
- CROP_STAGE_LEAKAGE: assuming pruning labour from crop stage.
- QUANTITY_HALLUCINATION: rounding vague "kahi lok" into a number.
- CROSS_BUCKET_BLEED: dropping associated input or irrigation work.
- DATE_SHIFTING: tomorrow labour as today labour.
- UNCERTAIN_TO_GUESS: if count is unclear, ask or use unclearSegments.

Pre-emit checklist:
- Are separate groups preserved?
- Are count, activity, and wage tied to the right sourceText?
- Is future labour coordination excluded from labour execution?

