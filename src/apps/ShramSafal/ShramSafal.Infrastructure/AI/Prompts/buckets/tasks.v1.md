Scope:
- Capture future intent, reminders, procurement, coordination, maintenance, and scheduling.
- Tasks are not completed Work Done.
- Reminder observations can mirror task source text.

Positive examples:
- "Udya spray karaycha aahe" => plannedTasks maintenance with dueHint tomorrow.
- "Labour la call karaycha aahe" => plannedTasks coordination.
- "DAP anaycha aahe" => plannedTasks procurement.

Negative examples:
- "Aaj spray kela" => inputs/cropActivities execution, not plannedTasks.
- "Pani dile" => irrigation, not task.

Mistakes you will make without guardrails:
- UNIT_DRIFT: treating required quantity as applied quantity.
- SPEAKER_CONFUSION: advice is not the farmer's task unless phrased as intent.
- CROP_STAGE_LEAKAGE: adding tasks not spoken.
- QUANTITY_HALLUCINATION: adding due dates without markers.
- CROSS_BUCKET_BLEED: duplicating completed work as future task.
- DATE_SHIFTING: today vs tomorrow.
- UNCERTAIN_TO_GUESS: if tense is unclear, use unclearSegments.

Pre-emit checklist:
- Is tense future/intent?
- Does it avoid completed execution buckets?
- Is dueHint based only on transcript?

