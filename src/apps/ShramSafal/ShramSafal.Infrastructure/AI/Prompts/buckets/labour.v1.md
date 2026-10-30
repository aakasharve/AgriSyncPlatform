Scope:
- Capture people who worked, labour type, male/female counts, total count, hours, wage, contract, cost, and activity.
- Separate distinct worker groups when counts or activities differ.

Positive examples:
- "Teen lokanni favarni keli" => labour count 3, activity spraying.
- "Char bhau ani don bayka nindani keli" => maleCount 4, femaleCount 2, activity weeding.
- "Contract ne 2 acre chhatani keli" => labour type CONTRACT, contractQuantity 2, contractUnit Acre.
- "5 बायका आणि 2 पुरुष छाटणीला होते" => one labour row, femaleCount 5, maleCount 2, gender mixed, activity pruning; no total count (7 was never said).

Negative examples:
- "Labour la call karaycha aahe" => plannedTasks coordination, not labour execution.
- "Labour aala nahi" => disturbance or observation, not completed labour.
- "बायका आल्या होत्या" => gender female, NO count, and बायका is never a worker name.

Mistakes you will make without guardrails:
- UNIT_DRIFT: treating hours as worker count or wage.
- SPEAKER_CONFUSION: counting family mention when they did not work.
- CROP_STAGE_LEAKAGE: infer stage from explicit OPERATIONS the farmer described, never from products alone; a product name alone never sets stage; if the operation contradicts the stage, trust the operation.
- QUANTITY_HALLUCINATION: rounding vague "kahi lok" into a number.
- CROSS_BUCKET_BLEED: dropping associated input or irrigation work.
- DATE_SHIFTING: tomorrow labour as today labour.
- UNCERTAIN_TO_GUESS: if count is unclear, ask or use unclearSegments.
- CROWD_AS_NAME: बायका / बाया / महिला / स्त्रिया / पुरुष / गडी / माणसं / मजूर / लोक / जण (women, men, workers, people) say what kind of people, never who; they never go into workerNames or notes.
- ZERO_AS_UNKNOWN: count 0 is not "not said". Omit count, maleCount and femaleCount when no number was spoken.

Pre-emit checklist:
- Are separate groups preserved?
- Are count, activity, and wage tied to the right sourceText?
- Is future labour coordination excluded from labour execution?

