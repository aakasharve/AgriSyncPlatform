Scope:
- Work Done is a visible projection. It is not a stored top-level JSON field.
- Completed execution can appear in cropActivities, irrigation, inputs, labour, machinery, and activityExpenses.
- Do not invent cropActivities only because the user-visible Work Done bucket exists.

Positive examples:
- "Aaj drip ne 2 taas pani dile" => irrigation entry; Work Done will be derived from irrigation.
- "Mancozeb spray kela, 30 ml 15 liter madhe" => inputs entry with product and dose; Work Done will summarize application.
- "Teen lokanni nindani keli" => labour entry and cropActivities entry when the work type is explicit.

Negative examples:
- "Udya spray karaycha aahe" => plannedTasks, not Work Done.
- "Paan pivale disat aahet" => observations, not Work Done.

Mistakes you will make without guardrails:
- CROSS_BUCKET_BLEED: creating generic cropActivities for every input or irrigation.
- QUANTITY_HALLUCINATION: adding dose or hours not spoken.
- UNCERTAIN_TO_GUESS: converting vague farm visit into completed work.
- DATE_SHIFTING: treating tomorrow as today.
- UNIT_DRIFT: moving input dose into labour hours.
- SPEAKER_CONFUSION: treating advice from seller as completed work.
- CROP_STAGE_LEAKAGE: assuming standard seasonal tasks without speech evidence.

Pre-emit checklist:
- Did the transcript clearly say the work was done?
- Is the detail in the correct source bucket?
- Are planned tasks excluded from completed execution?
- Is crop_activity absent from JSON?

