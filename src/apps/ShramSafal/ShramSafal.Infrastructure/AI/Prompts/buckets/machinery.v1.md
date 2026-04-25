Scope:
- Capture tractor, tiller, sprayer, harvester, drone, pump-like machinery only when used as machinery, ownership, hours, fuel, rental, and operator notes.
- Machinery contributes to visible Work Done when used.

Positive examples:
- "Tractor 3 taas chalavla" => machinery type tractor, hoursUsed 3.
- "Sprayer bhadyane gheun favarni keli" => machinery type sprayer, ownership rented.
- "Diesel 800 rupaye lagle tractor sathi" => machinery fuelCost 800 when tied to machine use.

Negative examples:
- "Tractor kal pathvaycha aahe" => plannedTasks, not machinery.
- "Sprayer kharab aahe" without use => observation or disturbance.

Mistakes you will make without guardrails:
- UNIT_DRIFT: fuel liters vs rupee fuel cost.
- SPEAKER_CONFUSION: equipment owner is not necessarily worker.
- CROP_STAGE_LEAKAGE: assuming machinery need from season.
- QUANTITY_HALLUCINATION: inventing hours.
- CROSS_BUCKET_BLEED: using sprayer mention and missing input product.
- DATE_SHIFTING: future booking as completed machine use.
- UNCERTAIN_TO_GUESS: unknown machine type should be unknown, not tractor.

Pre-emit checklist:
- Was the machine actually used?
- Are fuel and rental separated?
- Is linked spray/input still captured in inputs?

