Scope:
- Capture activity-linked expenses: transport, packaging, rope, crates, repair, tea/snacks for workers, support materials, and explicit rupee costs.
- Use activityExpenses for costs not already owned by labour, inputs, or machinery fields.

Positive examples:
- "Mazuranna chai nashta 200 rupaye" => activityExpenses reason snacks, totalAmount 200.
- "Crate bhadyane 500 lagle" => activityExpenses packaging/crates, totalAmount 500.
- "Transport 1200 rupaye dile" => activityExpenses transport, totalAmount 1200.

Negative examples:
- "Urea 500 rupaye" with product applied => inputs cost, not generic expense only.
- "Majuri 300 per person" => labour wage/cost, not activityExpenses only.

Mistakes you will make without guardrails:
- UNIT_DRIFT: rupees vs quantity.
- SPEAKER_CONFUSION: vendor quote is not paid expense unless stated.
- CROP_STAGE_LEAKAGE: assuming packaging during harvest.
- QUANTITY_HALLUCINATION: inventing totals from item names.
- CROSS_BUCKET_BLEED: duplicating same cost in input and activityExpenses.
- DATE_SHIFTING: future purchase as current spend.
- UNCERTAIN_TO_GUESS: unknown amount should remain absent.

Pre-emit checklist:
- Is this cost already captured in another bucket?
- Is amount explicitly spoken?
- Is expense linked to execution or just procurement intent?

