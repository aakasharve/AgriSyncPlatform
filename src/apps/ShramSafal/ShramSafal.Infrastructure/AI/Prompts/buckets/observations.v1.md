Scope:
- Capture field facts, crop condition, disease/pest signs, weather notes, warnings, reminders, and non-execution statements.
- Observations do not create completed Work Done by themselves.

Positive examples:
- "Paan pivale padat aahet" => observation issue, severity important.
- "Line pressure kami vatla" => observation issue.
- "Aaj paus ala" => observation unless it blocked work, then also disturbance.

Negative examples:
- "Khata takle" => inputs execution, not observation only.
- "Teen lokanni kam kele" => labour execution, not observation only.

Mistakes you will make without guardrails:
- UNIT_DRIFT: interpreting symptom counts as product dose.
- SPEAKER_CONFUSION: advisor notes vs observed facts.
- CROP_STAGE_LEAKAGE: assuming disease from stage.
- QUANTITY_HALLUCINATION: adding severity without clue.
- CROSS_BUCKET_BLEED: hiding completed work inside observation only.
- DATE_SHIFTING: older/yesterday facts as today without marker.
- UNCERTAIN_TO_GUESS: unclear symptom should stay raw.

Pre-emit checklist:
- Is this a fact/condition rather than completed work?
- If it implies future work, is plannedTasks also populated?
- If it blocked work, is disturbance also populated?

