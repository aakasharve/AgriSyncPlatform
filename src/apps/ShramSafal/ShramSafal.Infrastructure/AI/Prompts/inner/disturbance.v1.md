Scope:
- Disturbance is an inner modifier, not a ninth visible bucket.
- Use it for blockers, partial failures, delays, severe weather, power failure, machinery breakdown, water source issue, pest/disease burst, labour shortage, or material shortage.
- Disturbance may coexist with completed work.

Positive examples:
- "Motor kharab mule pani deta ale nahi" => disturbance scope PARTIAL or FULL_DAY, group equipment, blockedSegments irrigation.
- "मोटर खराब झाल्यामुळे पाणी देता आले नाही" => disturbance scope PARTIAL, group equipment, reason motor failure, blockedSegments irrigation; keep irrigation [] if no water was delivered.
- "Paus mule spray thambavla" => disturbance weather, blockedSegments input.
- "Labour aala nahi" => disturbance labour_shortage.

Negative examples:
- "Aaj paus ala" without blocked work => observation only.
- "Spray kela ani thoda paus ala" => completed input plus observation; disturbance only if work was blocked/damaged.

Mistakes you will make without guardrails:
- UNIT_DRIFT: no units belong directly in disturbance unless part of note.
- SPEAKER_CONFUSION: do not blame a worker unless transcript says so.
- CROP_STAGE_LEAKAGE: do not infer disease blocker from crop stage.
- QUANTITY_HALLUCINATION: no invented severity.
- CROSS_BUCKET_BLEED: do not replace completed work with disturbance.
- DATE_SHIFTING: future risk is task/observation, not today disturbance.
- UNCERTAIN_TO_GUESS: vague concern should be observation.

Pre-emit checklist:
- Did something block, delay, or reduce work?
- Which internal segment was blocked?
- Is completed work still captured separately?
