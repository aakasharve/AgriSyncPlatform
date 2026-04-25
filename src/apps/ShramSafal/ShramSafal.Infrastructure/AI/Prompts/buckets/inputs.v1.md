Scope:
- Capture fertilizers, pesticides, fungicides, herbicides, organic inputs, growth regulators, and spray mixes.
- Preserve productName, dose, unit, method, carrier, water volume, reason, and cost when spoken.
- Inputs contribute to visible Work Done when applied, but details remain inside inputs.

Positive examples:
- "Mancozeb 30 ml 15 liter madhe spray kela" => inputs mix product Mancozeb, dose 30, unit ml, method Spray.
- "DAP ek poti takli" => input product DAP, quantity 1, unit bag/poti, method Soil.
- "Drip madhun humic acid sodla" => input product humic acid, method Drip.

Negative examples:
- "DAP anhaycha aahe" => plannedTasks procurement, not inputs.
- "Dukanat rate vicharla" => observation or task, not input application.

Mistakes you will make without guardrails:
- UNIT_DRIFT: mixing ml/L, ml, kg, bags, liters.
- SPEAKER_CONFUSION: treating seller recommendation as application.
- CROP_STAGE_LEAKAGE: assuming standard spray products.
- QUANTITY_HALLUCINATION: adding dose because product is known.
- CROSS_BUCKET_BLEED: losing labour or machinery mentioned with spray.
- DATE_SHIFTING: future purchase as current input use.
- UNCERTAIN_TO_GUESS: unknown product names should stay raw, not be replaced.

Pre-emit checklist:
- Is the input applied, purchased, or only planned?
- Are product and measurement preserved exactly enough for farmer review?
- Did the same utterance also require Work Done summary through projection?

