// spec: data-principle-spine-2026-05-05/08.2
//        +SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.4 (cascade
//         extension — voice spine tables added in Phase 1+2+3.3)
//
// Sub-phase 08.2 (per DS-017 binding contract 2026-05-17) — DPDP §12
// erasure worker. Polls ssf.erasure_requests for Requested rows and
// runs the 5-rule ANONYMIZE manifest:
//   (a) Replace user-id columns with SystemActor.ErasedFarmer sentinel
//   (b) NULL personal free-text columns (notes, transcript excerpts,
//       display-name snapshots, reasonNote on finance_corrections)
//   (c) KEEP farm/compliance/accounting fields (farm_id, plot_id,
//       crop_cycle_id, log_date/cost_date, activity_type/category_id,
//       quantities, amounts, currency, compliance flags, created_at_utc)
//   (d) Emit ONE AuditEvent per anonymized row via
//       AuditEventFactory.Create with entityType="ErasureAnonymize",
//       action="Applied", payload listing scrubbed columns + sentinel
//   (e) Integration test (ErasureWorkerAnonymizationTest) seeds PII
//       rows + greps surviving rows to assert no PII survives.
//
// Per OQ-10 verdict, correction_events + finance_corrections are both
// in the manifest. Per OQ-7 (cost_entries vendor field): vendor field
// does not exist in the current schema, so cost_entries gets the
// "scrub created_by_user_id, NULL description" minimal action plus the
// audit row.
//
// Per OQ-8 (IRetainedBlobStore): the worker calls the port
// unconditionally.
//
// SUPERSEDED — the rest of the original OQ-8 note said the stub throws
// NotImplementedException which the worker catches, logs, and records as
// voice_clips_retained_deferred=true. That stub (PendingRetainedBlobStore)
// was DELETED in the Voice Diary ship; Program.cs:445-451 binds the real
// S3RetainedBlobStore, and the port's own docstring says the catch is no
// longer needed. The narrow catch survived the stub by ~3 months and
// guarded the one exception that could no longer be thrown while letting
// through every one that could — aborting the run AFTER nine tables were
// irreversibly scrubbed but BEFORE any audit row was written.
//
// The worker now catches everything from that step and records the outcome
// as ErasureStatus.CompletedWithResidue. voice_clips_retained_deferred is
// still emitted for payload compatibility, but the meaningful fields are
// retainedVoiceDeleted / retainedVoiceResidue. See the block at step (e).
//
// SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 — extension to the cascade.
// The voice-spine schema adds three user-keyed surfaces that DELETE
// rather than ANONYMIZE on erasure:
//   - ssf.ai_jobs (Phase 1.1) — DELETE WHERE user_id = X.
//     Cascading deletes via EF/relational FKs on ssf.ai_job_attempts
//     (defined in AiJobConfiguration.HasMany.OnDelete(Cascade)) and
//     on the Provenance owned-record columns embedded in ai_jobs.
//     The new transcript_* columns (codemix/english/redacted/
//     verbatim/translit/translate + provider + model + referenced
//     date + diarized json) drop transitively because they live ON
//     the ai_jobs row.
//   - ssf.voice_clips_retained (Voice Diary ship) — purged via
//     IRetainedBlobStore.DeleteRetainedVoiceForUserAsync as before.
//   - ssf.golden_set_candidate (Task 3.3) — DELETE WHERE user_id = X.
//     The unique-index gate on (audio_content_hash, correction_type)
//     means the table is naturally small per user; bulk DELETE is
//     the right shape.
// Plus one orphan-clean surface:
//   - ssf.transcript_history (Phase 1.3) has NO user_id column —
//     it's keyed on (audio_content_hash, provider, model, mode). The
//     cascade collects the user's audio hashes from ai_jobs BEFORE
//     deleting the ai_jobs rows, then DELETE FROM transcript_history
//     WHERE audio_content_hash IN (collected hashes). This is the
//     transitive cascade: hashes that belonged only to this user
//     drop with their owning rows.
// Surfaces that DO NOT cascade:
//   - ssf.ai_provider_spend_daily — per-farm aggregated rollup keyed
//     on (tenant_id=farm_id, provider, operation, day) with no
//     user_id column. The row is structurally de-identified at
//     write time: the AiCostBudgetGuard UPSERTs a daily sum across
//     all users contributing to that farm, so the surviving row
//     cannot be re-attributed to the erased user after the
//     ai_jobs DELETE above removes their per-attempt cost rows.
//     DPDP §12 permits retention of de-identified / aggregated
//     records where (i) the personal identifier has been removed
//     and re-association is not feasible, AND (ii) retention
//     serves a legitimate accounting / audit / dispute purpose.
//     Both conditions hold: (i) the rollup sum was computed across
//     the farm, not the user — there is no projection back to the
//     erased principal once ai_jobs is gone; (ii) FinOps / vendor
//     invoice reconciliation against Sarvam + Gemini bills depends
//     on this table surviving the erasure event. If a future audit
//     requires per-farm spend takedown (e.g. the entire farm is
//     erased, not a single user), that is a separate workflow on
//     the farm aggregate — not this DPDP §12 user-scoped path.
//   - ssf.daily_logs.evidence_sources — farm-scoped not user-scoped;
//     introducing user-level deletion here would break the audit
//     ledger (Trust Ladder semantics).
//   - ssf.application_input_items — Track B typed child of farm_operations
//     (ADR 0023 / D-T2-ERASURE). NO user_id/PII column: product_name,
//     npk_grade, dose_* are de-identified farm operational facts. The only
//     actor linkage is via the parent farm_operations.created_by_user_id,
//     which AnonymizeFarmOperationsAsync already scrubs to ErasedFarmer —
//     severing re-attribution. KEEP (survives, DPDP §12 de-identified
//     operational retention). No scrub action; conscious gate-4 disposition.
//   - ssf.event_links — Track B structural join between farm_operations
//     (and to cost_entries), ADR 0023 §1.3 / D-T3-ERASURE. NO user_id/PII
//     column: from/to operation & cost-entry ids + link_kind + the
//     from_farm_id/to_farm_id guard columns are de-identified structural
//     references. The parent farm_operations.created_by_user_id is already
//     scrubbed (D-T1-ERASURE), severing re-attribution. KEEP (survives,
//     DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.irrigation_entries — Track B daily_logs-child (ADR 0023 §2 / D-T4-ERASURE).
//     NO user_id/PII column: role/duration/volume/method/source + the daily_log_id
//     anchor are de-identified farm operational facts. The parent
//     daily_logs.operator_user_id is already scrubbed to ErasedFarmer (existing
//     manifest), severing re-attribution. KEEP (survives, DPDP §12 de-identified
//     operational retention). No scrub action; conscious gate-4 disposition.
//   - ssf.labour_assignments — Track B daily_logs-child (ADR 0023 §2 / D-T5-ERASURE).
//     CORRECTED 2026-07-19 (founder Decision 5, spec
//     2026-07-13-labour-attendance-approval-design) — this bullet previously said
//     the table has "NO user_id/PII column" and takes "No scrub action." That
//     became FALSE the moment migration 20260718132540_AddLabourAssignmentShiftTaskNames
//     added worker_names_json: it holds the farmer's own spoken free-text naming a
//     third-party worker, verbatim, in a jsonb array — real PII, not a de-identified
//     operational fact. The rest of the row (engagement_type, gendered worker counts,
//     wage/rate, shift, task, and the nullable never-fabricated total_cost) is still
//     de-identified and still KEEPs, exactly as before. worker_names_json is now
//     ANONYMIZE'd (see AnonymizeLabourAssignmentWorkerNamesAsync below): scrubbed to
//     '[]'::jsonb whenever the parent daily_log's operator_user_id matches the erased
//     user — same scope as every other daily_logs-child in this file. A knowingly
//     false statement in a compliance artifact is worse than a tracked gap; do not
//     revert this bullet to the old text.
//   - ssf.workers — ADDED 2026-07-19 (founder Decision 5, "5b: ship names, but do the
//     erasure work first" — spec 2026-07-13-labour-attendance-approval-design). WTL v0
//     Worker aggregate (ADR 2026-05-04 wtl-v0-entity-shape): a third-party (non-user)
//     worker identity captured passively from voice transcripts by WorkerNameProjector.
//     Previously ABSENT from this manifest entirely. HAS PII: name_raw / name_normalized
//     hold an actual person's name — unlike every de-identified Track B table above,
//     this is not a de-identified operational fact, so it cannot get a bare KEEP
//     disposition. ANONYMIZE, not DELETE (see AnonymizeWorkersDerivedFromUserLogsAsync
//     below): scrub name_raw/name_normalized to a redaction sentinel while KEEPING
//     farm_id/assignment_count/first_seen_utc and the row itself intact —
//     worker_assignments.worker_id carries ON DELETE CASCADE, so hard-deleting the
//     Worker row would silently destroy every WorkerAssignment link row (and the
//     assignment_count history the admin Mode A drilldown reads); sentinel-replace
//     avoids that orphaning. Scope: a Worker is reached via
//     ssf.worker_assignments -> ssf.daily_logs.operator_user_id — i.e. any Worker whose
//     name was extracted from a transcript belonging to a log THIS erased user
//     authored. Must run BEFORE AnonymizeDailyLogsAsync scrubs operator_user_id (the
//     join needs the ORIGINAL value) — same ordering rule as NullLogTaskNotesAsync.
//     DISCLOSED LIMIT: a Worker who ALSO has assignments from a DIFFERENT operator on
//     the same farm is still scrubbed here — a name touched by the erased user's own
//     voice log is redacted regardless of who else later mentioned the same Worker
//     row. The alternative (skip scrubbing because someone else also named them) would
//     let one operator's erasure fail to remove PII their own log produced, which is
//     the worse failure mode. Workers cannot self-initiate an erasure request — no
//     login, no user_id column, no consent capture today — so this disposition is a
//     cascade FROM the registered farmer's own erasure, not a first-class DPDP right
//     exercised BY the worker; see the phase-5 privacy report for what this covers and
//     does not, and the still-open question of notice/consent for third-party workers.
//   - ssf.worker_assignments — ADDED 2026-07-19 alongside ssf.workers above. WTL v0 link
//     entity (ADR 2026-05-04 wtl-v0-entity-shape) tying a Worker to the DailyLog its
//     name was extracted from. NO PII column of its own: worker_id/daily_log_id/
//     confidence/occurred_at_utc are structural references — the identifying text lives
//     entirely on the referenced ssf.workers row, scrubbed above. KEEP the link row
//     unchanged; do NOT delete it — that is exactly the orphaning the sentinel-replace
//     choice on ssf.workers exists to avoid. No independent scrub action on this table;
//     conscious gate-4 disposition.
//   - ssf.field_operators / ssf.field_operator_work_rows — ADDED 2026-08-11
//     (Labour V1 Task 10, spec 2026-07-13-labour-attendance-approval-design).
//     HAS PII: field_operators.display_name / .display_name_normalized /
//     .full_name and field_operator_work_rows.display_name_at_attach all hold a
//     real person's name. BOTH TABLES ARE DELIBERATELY ABSENT FROM THE
//     CREATOR-ERASURE SEQUENCE IN ProcessOneAsync, AND THAT ABSENCE IS THE
//     DESIGN, NOT A GAP:
//       CREATOR IS NOT THE DATA SUBJECT. The farmer who typed a worker's name
//       is not that worker's data subject. Erasing the FARMER'S account must
//       NOT anonymize the WORKER — the worker never asked, and their identity
//       is co-owned work history that outlives any one account. This is exactly
//       why these tables are NOT reached via daily_logs.operator_user_id the way
//       ssf.workers is by AnonymizeWorkersDerivedFromUserLogsAsync above. The
//       WTL v0 ssf.workers disposition is a cascade FROM the farmer's erasure
//       because those names were extracted passively from that farmer's own
//       transcripts; a FieldOperator is a durable, deliberately-created work
//       identity, so the same cascade would be wrong.
//       THE WORKER-SPECIFIC CAPABILITY EXISTS: AnonymizeFieldOperatorAsync
//       below, invoked by an explicit worker-erasure decision and never by
//       account deletion, sentinel-replaces all four name columns above.
//       ANONYMIZE, not DELETE, and never the work: FieldOperatorId, the
//       LabourAssignment relationship, work_date and all non-identifying
//       execution history are PRESERVED. All three FKs on
//       field_operator_work_rows are ON DELETE RESTRICT, so a hard delete could
//       not orphan-cascade even if attempted — anonymize the person, never the
//       work.
//     DISCLOSED LIMIT: the retention/erasure POLICY — the legal trigger and the
//     retention period — still requires founder + counsel sign-off before broad
//     real-worker rollout. What exists today is the CAPABILITY, which is what
//     founder Decision 5 ("5b — ship names, but do the erasure work FIRST")
//     gates on. Stating otherwise here would be a knowingly false compliance
//     claim, which this file holds to be worse than a tracked gap.
//   - ssf.shram_persons / ssf.shram_person_phones / ssf.shram_cards / ssf.shram_phone_challenges /
//     ssf.shram_identity_events — ADDED 2026-11-02 (lane WID, founder D-54; migration
//     20261102163914_AddWorkerIdentity). A worker's ShramSafal identity: the name on his card and his home
//     PIN (shram_persons.card_name / .home_pin_code), his phone numbers (shram_person_phones.phone_e164),
//     his card codes (shram_cards.code) and the numbers his one-time codes went to
//     (shram_phone_challenges.phone_e164). HAS PII. Like ssf.field_operators above, DELIBERATELY ABSENT
//     FROM THE CREATOR-ERASURE SEQUENCE: the farmer who added a worker is not that worker's data subject.
//     THE WORKER'S OWN ERASURE (R8, case 16) is WorkerPersonErasure, run by RunPassAsync after the same
//     D-71 wait (ErasureTiming): an owner asks on his behalf, it waits and may be cancelled, then the
//     person and every alias merged into him are ANONYMISED — card_name -> sentinel, home_pin_code NULL,
//     every phone_e164 NULL (the row stays, released), every card RETIRED (the code row stays, so it is
//     never issued again), every challenge's phone_e164 NULL — and every farm record that is him goes
//     through AnonymizeFieldOperatorAsync below. NEVER THE WORK: no field operator, work row, हजेरी mark
//     or headcount is deleted or changed except the name text. ssf.shram_identity_events names nobody
//     (ids, a kind, a proof, a time) and is append-only by GRANT: KEEP; one 'Erased' event per farm record
//     is appended.
//   - ssf.farm_personal_invitations — ADDED 2026-11-06 (lane MU-2; migration 20261106063315_AddPersonalInvitations).
//     The owner's invitation that carries the relationship: who invited (invited_by_user_id), the label, plots and
//     authorities, a seven-day eight-digit code, who claimed it (claimed_by_user_id) and when. HAS PII of a THIRD
//     PARTY: person_name and invited_phone_e164 are what the OWNER typed about the person he invited (the farm_name
//     and scope_plot_names snapshots are farm data). Like ssf.field_operators above, DELIBERATELY ABSENT FROM THE
//     CREATOR-ERASURE SEQUENCE: the farmer who typed a person's number is not that person's data subject (P6), and the
//     row is the farm's record of who it let in and with what grant (a seat's provenance). The ROW is KEPT; the PERSON on
//     it is not (lane MU-2 fix round 1, review M-3): person_name and invited_phone_e164 are cleared (PersonalInvitationPeople)
//     (a) by THIS worker when an account is erased — every invitation on every farm naming his login's number — and when
//     a worker's own identity is erased (WorkerPersonErasure: his numbers and his farm records); (b) by the nightly
//     RetentionSweepWorker 30 days after an invitation ended or expired (it only ever works for seven days).
//   - ssf.attendance_marks — ADDED 2026-08-31 (founder decision D-H3: what somebody
//     RULED about a person on a farm-day; day mark full/half/absent/unmarked plus
//     night mark worked/not-worked/unmarked).
//     NO PII COLUMN OF ITS OWN, and that is a deliberate design choice rather than
//     an accident: farm_id, field_operator_id, work_date, two enums, two
//     numeric(4,1) hour counts plus an integer basis (quantities, not text — no
//     PII), a recorder id and two timestamps. The identifying TEXT lives entirely
//     on the referenced ssf.field_operators row, which AnonymizeFieldOperatorAsync
//     below already sentinel-replaces.
//     THE NAME IS DELIBERATELY NOT SNAPSHOTTED HERE, unlike
//     field_operator_work_rows.display_name_at_attach. That snapshot exists so a
//     payout approved for "बाळू" still reads "बाळू" after a rename — history that
//     must stay explainable. A हजेरी mark is not a payout: the register is read
//     live, and showing the person by their CURRENT name is the correct answer
//     there. Not copying the name is therefore both the right read semantics and
//     one fewer place a worker erasure has to reach.
//     KEEP the row unchanged on creator erasure; do NOT delete it. Same reasoning
//     as field_operator_work_rows above — CREATOR IS NOT THE DATA SUBJECT, and the
//     mark is co-owned work history. On an explicit WORKER erasure the person is
//     anonymized at ssf.field_operators and this row needs no action, because it
//     names nobody. Anonymize the person, never the work. Conscious gate-4
//     disposition, no independent scrub action on this table.
//   - ssf.attendance_mark_corrections — ADDED 2026-08-31 alongside
//     ssf.attendance_marks. The append-only record of what a mark used to say,
//     who changed it and when (founder ruling: corrections are fine, silent ones
//     are not).
//     NO PII COLUMN OF ITS OWN: a mark id, a farm id, which half changed, and the
//     enum NAMES or hours values either side of the change ("Half" -> "Full",
//     null -> "3.5|Explicit") — still names nobody: the person is reachable only
//     through the mark it points at, and from there ssf.field_operators, which
//     AnonymizeFieldOperatorAsync already scrubs.
//     corrected_by_user_id identifies the FARMER who made the change, and on
//     creator erasure that farmer is the data subject — but see below.
//     KEEP, AND IT CANNOT BE OTHERWISE. The table is append-only enforced at the
//     GRANT: agrisync_app holds SELECT and INSERT and no UPDATE or DELETE, so
//     neither a scrub nor a delete is executable by the application at all. That
//     is deliberate and it is the point of the table — a history that can be
//     edited answers nothing. An erasure that could rewrite the audit of its own
//     corrections would defeat the ruling this table exists to satisfy.
//     DISCLOSED LIMIT: that makes corrected_by_user_id a farmer identifier which
//     account deletion does not reach. It is a bare uuid with no name, phone or
//     free text beside it, and it is load-bearing for provenance. Flagged here
//     rather than quietly scrubbed, and it needs the same founder + counsel
//     sign-off the field_operators retention policy is already gated on.
//   - ssf.machinery_usages — Track B daily_logs-child (ADR 0023 §2 / D-T6-ERASURE).
//     NO user_id/PII column: machine type/ownership, hours/costs, and the structured
//     equipment config (implement, nozzles_active, fan_state, fuel) are de-identified
//     farm operational facts; the free-text notes field was deliberately EXCLUDED. The
//     parent daily_logs.operator_user_id is already scrubbed to ErasedFarmer, severing
//     re-attribution. KEEP (survives, DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.weather_events — Track B DIRECT-farm_id row (ADR 0023 §2). System-generated weather data
//     (event_type, severity, signal readings, source, time window) keyed on farm_id — NO user_id column,
//     NO farmer free-text, NO PII. Like machinery_usages: de-identified farm-level operational facts;
//     a single member's erasure must NOT delete the farm's weather history. KEEP (survives, DPDP §12).
//     No scrub action; conscious gate-4 disposition.
//   - ssf.routine_patterns — Track B DIRECT-farm_id row (ADR 0023 §2 / RoutineMemory §8.1). Derived
//     farm-level aggregate (typical duration/method/source per farm+plot+op-type, from CONFIRMED logs)
//     keyed on farm_id — NO user_id column, NO farmer free-text, NO PII. Like weather_events: a member's
//     erasure must NOT delete the farm's accumulated routine memory. KEEP (survives, DPDP §12).
//     No scrub action; conscious gate-4 disposition.
//   - ssf.weather_stamps — Track B daily_logs-child (ADR 0023 §2). System-generated weather snapshot at
//     log time (temp/humidity/wind/precip/condition/provider) — NO user_id column, NO farmer free-text,
//     NO PII. Parent daily_logs.operator_user_id already scrubbed; the readings are de-identified weather
//     facts. Like weather_events: a member's erasure must NOT delete the farm's weather snapshots.
//     KEEP (survives, DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.observation_events — Track B daily_logs-child (ADR 0023 §2 / D-FREETEXT-PRESERVE-2026-06-29).
//     This child HAS free-text (text_raw / text_cleaned) — the farmer's observation, experience and
//     wisdom. Per founder directive it is FARM-co-owned knowledge and is PRESERVED on erasure: a single
//     member's erasure must NOT delete the farm's accumulated knowledge. The WHO is de-attributed via the
//     already-scrubbed parent daily_logs.operator_user_id (→ ErasedFarmer); the observation CONTENT
//     SURVIVES. Rare embedded third-party PII is handled by a future surgical-redaction pass (B-FT1),
//     never a blanket scrub. KEEP — conscious gate-4 disposition. No scrub action.
//   - ssf.disturbance_events — Track B daily_logs-child (ADR 0023 §2 / D-FREETEXT-PRESERVE-2026-06-29).
//     HAS free-text (reason) — the farmer's words for why the day's work was disrupted. Same disposition
//     as observation_events: FARM-co-owned knowledge, PRESERVED on erasure (a single member's erasure must
//     NOT delete the farm's accumulated knowledge). The WHO is de-attributed via the already-scrubbed
//     parent daily_logs.operator_user_id (→ ErasedFarmer); the reason CONTENT SURVIVES. Rare embedded
//     third-party PII → future surgical-redaction pass (B-FT1), never a blanket scrub. KEEP — conscious
//     gate-4 disposition. No scrub action.
//   - ssf.daily_log_contents — spec: plr-d10 (lane F1). What Sathi understood for a log, one
//     unchangeable row per record version, APPEND-ONLY BY PRIVILEGE (agrisync_app has no
//     UPDATE/DELETE/TRUNCATE). It holds HIS WORDS — his whole sentence (fullTranscript), the
//     phrase behind each item (sourceText), the words behind each number (spokenText), his
//     notes and the spoken "when" of planned work (dueHint / rawText) — personal data under the
//     notice. SCRUB those keys (LogContentDocument.StripWords) on every row of every log he
//     SPOKE (daily_logs.operator_user_id = him, so it MUST run before AnonymizeDailyLogsAsync),
//     stamp words_erased_at_utc, and replace written_by_user_id with the sentinel on rows he
//     wrote. The VALUES — what was done, how much, when — SURVIVE (founder ruling 2026-08-27,
//     DPDP §12), as on every other daily_logs child. Observation textRaw / textCleaned follow
//     the D-FREETEXT-PRESERVE disposition below and are kept. Runs through THIS admin context
//     (the migration role), the only role the REVOKE leaves able to rewrite a row.
//   - ssf.consent_audit / ssf.audit_events — append-only by
//     privilege; flagged "redacted" at the column level, never
//     deleted.
//
// ── FOUNDER RULING 2026-08-27 — the six DFES / consent-gate / blob-linkage
//    tables (spec: 2026-08-25-prod-cutover-waves) ────────────────────────
//
// His words: "it must erase his ownership, but what I don't want [erased] is
// the on-field execution reality... that grapes are cultivated like this and
// here is the proof. I want to keep his ownership [removed] but for grapes, a
// crop, anything that was being practised, I must keep that."
//
// That is not a new posture. It is this manifest's existing DE-IDENTIFIED
// OPERATIONAL RETENTION rule (DPDP §12) — already carried by
// application_input_items, event_links, irrigation_entries, machinery_usages,
// weather_events, weather_stamps, routine_patterns, observation_events and
// disturbance_events. Applied table by table:
//
//   - ssf.question_events — KEEP. Scoped on farm_id / plot_id / crop /
//     expected_stage, with NO user_id column (20260713052440_AddDfesDataSpine).
//     What it holds is precisely what the ruling protects: WHICH question
//     mattered for WHICH crop at WHICH stage, and what the answer was.
//     Re-attribution is severed the way every daily_logs child's is — the
//     parent ssf.daily_logs.operator_user_id is scrubbed to ErasedFarmer by
//     AnonymizeDailyLogsAsync, and the only path back is the nullable
//     daily_log_id.
//     SAID PLAINLY, because a "no PII" claim here would be FALSE: this table
//     HAS free text — response (the farmer's own answer), trigger_reason and
//     weather_context. It KEEPs for the reason observation_events and
//     disturbance_events KEEP (D-FREETEXT-PRESERVE-2026-06-29): that content is
//     FARM-co-owned agronomic knowledge, and one member's erasure must not
//     delete the farm's knowledge. Rare embedded third-party PII goes to the
//     same future surgical-redaction pass (B-FT1), never a blanket scrub.
//     Independently, a scrub is not executable here at all: the creating
//     migration runs REVOKE UPDATE, DELETE, TRUNCATE ON ssf.question_events
//     FROM agrisync_app — append-only by privilege, not by convention.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.daily_richness_aggregates — KEEP. Farm-scoped derived rollup
//     (farm_id + local_date + scores + day_classification + components_json)
//     with NO user_id column (20260713052440_AddDfesDataSpine). Same shape and
//     same disposition as routine_patterns above: a farm-level aggregate whose
//     ownership is already severed by the rest of this manifest, and which a
//     single member's erasure must not delete out from under the farm.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.terms_acceptance_events / ssf.consent_grant_events — KEEP, and for a
//     DIFFERENT reason from every other KEEP in this file. Do NOT read these as
//     de-identified. Both carry a user_id column
//     (20260816170524_AddConsentGateLedgers) and after this erasure runs they
//     still name the erased user. That is deliberate: a consent record that
//     cannot say WHO consented proves nothing, and these two tables are the
//     only evidence that the processing which PRECEDED the erasure was lawful.
//     DPDP §12(3) permits retention where it is necessary for compliance with
//     law, and the lawfulness of prior processing is exactly such a case;
//     deleting the proof of consent alongside the data would leave the
//     fiduciary unable to answer the first question a regulator asks.
//     Neither is scrubbable by the app role in any case — that migration runs
//     REVOKE UPDATE, DELETE, TRUNCATE on both.
//     DISCLOSED: this is a retention EXCEPTION, not an absence of personal
//     data. It is the one place in this manifest where an erased subject stays
//     named ON PURPOSE, and it should be read as such.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.improvement_permission_events (plr-d10 I25, founder D-36) — KEEP, for the
//     same reason as the two consent ledgers above: each row is the evidence of whether
//     this person allowed improvement use, under which words and when. It holds no
//     content (user_id, a yes/no, a words version, a language, an app version, a time),
//     and the app role cannot rewrite it (UPDATE / DELETE / TRUNCATE revoked).
//     DISCLOSED: like the two ledgers above, an erased subject stays named here. The row
//     survives; the licence does not — ImprovementPermissionGate answers NO for any
//     account with an erasure request (any status), whatever its rows say.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.record_audience_members (plr-d10 lane PRV, founder D-26) — KEEP. One row is
//     one person the farm's primary account holder chose to see one restricted record:
//     (farm_id, record_kind, record_id, user_id, added_at_utc) and no content. On the
//     erasure of a CHOSEN person the grant is inert: an erased account cannot sign in and
//     holds no seat, so the row lets nobody read anything. On the erasure of the record's
//     MAKER the record itself is handled by its own table's disposition above; this row
//     only says who else may read it.
//     DISCLOSED: an erased subject's opaque user id stays named in this access list,
//     exactly as it stays in ssf.farm_memberships (still on the pending-disposition
//     baseline). Both should get their real disposition together in the DPDP compliance
//     slice (GO-LIVE-REGISTER F98).
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.farm_rates (plr-d10 lane RATE-1 part A, founder D-72 / D-17 / D-43) — KEEP. One row
//     is one version of one rate of a FARM's own price list: the farm, what the rate is for
//     (item_name, the farmer's own words), its unit / basis, an optional worker category or crew
//     (worker_category), an optional season, the amount, its dates, and who set it as an opaque
//     user id ONLY. It is the farm's business record, append-only by GRANT (SELECT + INSERT).
//     DISCLOSED (fix round 1, review F4): item_name, worker_category and season are FREE TEXT the
//     farmer types, and they MAY hold a person's name — a crew is commonly named after its
//     मुकादम ("अनिलची टोळी"). That text is KEPT as the farm's business record: this worker does not
//     scrub it, and nothing here can tell a name from a crop. Whether it needs a surgical scrub
//     path is OPEN for OPS-1 / GO-LIVE-REGISTER F98 (never closed by assertion here). An erased
//     setter's opaque user id also stays on the rows he set, exactly as on ssf.audit_events; the
//     phone names a setter only through the operator directory, which erasure anonymises.
//
//   - ssf.schedule_step_moves (plr-d10 lane ATT-W, R29) — KEEP. One row is one "पुढे ठरवा" on one step a followed schedule asks:
//     the farm, the subscription, the schedule activity, the schedule's own day (original_date), the day लक्ष द्या reminds instead
//     (new_date), who moved it as an opaque user id ONLY, and when. IDS AND DATES ONLY: there is no reason column and no free text, so no
//     word of any person is held here. It is the farm's own reminder history, append-only by GRANT (SELECT + INSERT): the app role cannot
//     rewrite or remove a row, and the latest row per step is its reminder day. P6: anonymise the person, never the work - an erased
//     mover's opaque user id stays on the rows he made, exactly as on ssf.audit_events; the phone names people only through the operator
//     directory, which erasure anonymises. No action, no ScrubbedColumnsFor entry.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.log_practice_reasons (plr-d10 lane CMP-D3, founder D-68 round 2) — KEEP THE ROW AND ITS KIND, ERASE HIS WORDS. One row is one reason
//     ("का केलं") kept on one item of one saved record of a FARM: the farm, the record, the item key (a work key, never a word of a person), the
//     KIND (Practice / Extra / Weather: one of three fixed words), `words` (what the author typed or said, at most 1000 characters: HIS WORDS,
//     personal data under the notice), whether they came from the mic, when, who wrote it as an opaque user id ONLY and which reason it replaced.
//     It is the farm's own record of why work was done the way it was, append-only by GRANT (SELECT + INSERT): the app role cannot rewrite
//     or remove a row. Erasing the AUTHOR therefore runs through the privileged admin context, as ssf.daily_log_contents above
//     (ScrubLogPracticeReasonWordsAsync, SET LOCAL row_security = off so that a connection row-level security would filter fails loudly,
//     never quietly): it sets `words` NULL and `said_by_voice` false on every row he wrote, and the KIND, the item, the record, the time and his
//     opaque id stay (P6: anonymise the person, never the work; the phone names a person only through the operator directory, which erasure
//     anonymises). Idempotent (a second run changes 0 rows). A reason of another person on the same record is NOT touched: the
//     record is his, the reason is its author's.
//     ANONYMIZE (words only) — see ScrubbedColumnsFor.
//
//   - ssf.schedule_subscriptions (plr-d10 lane L8b-1) — KEEP. One row is which library
//     schedule one plot's crop season follows and its day 0: (farm_id, plot_id,
//     crop_cycle_id, crop_key, schedule_template_id, version tag, state, dates) — NO user
//     column, NO free text. Like routine_patterns: a farm-level operational fact; one member's
//     erasure must NOT take the farm's schedule choices with it. Who made the choice is in
//     ssf.audit_events (actor_user_id), handled by that ledger's own disposition above.
//     KEEP (survives, DPDP §12). No scrub action; conscious gate-4 disposition.
//
//   - ssf.schedule_migration_events (plr-d10 lane L8b-1) — KEEP, DISCLOSED. One row is one
//     switch of a plot's schedule (I-16, append-only by design): the two subscriptions and
//     templates, the farm / plot / season, the time, a reason code, an OPTIONAL reason_text
//     and actor_user_id. DISCLOSED: an erased subject's opaque user id stays named here, as in
//     ssf.farm_memberships (still on the pending-disposition baseline), and reason_text could
//     hold his words — no phone sends one today (L8b-2's switch sends reason "Other" with no
//     text, P8). Both should get their real disposition together with farm_memberships in the
//     DPDP compliance slice (GO-LIVE-REGISTER F98).
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.cost_entry_approvals (plr-d10 lane BILL-1, founder D-12) — KEEP. One row is one
//     reviewer's मंजूर on one bill of a FARM: the farm, the bill, the bill version he saw, when
//     the server took it, the sync request id and app version (telemetry), and who approved it
//     as an opaque user id ONLY — no name, no words, no amount. It is the farm's money-review
//     history, append-only by GRANT (SELECT + INSERT). An erased approver's opaque user id stays
//     on the rows he stamped, exactly as on ssf.audit_events; the phone names an approver only
//     through the operator directory, which erasure anonymises.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.input_identity_assertions (dfes-input-truth-and-mix-check-2026-11-06, lane IT2, founders
//     D-92 / D-95) — KEEP. One row is one हो / नाही / फोटो answer about one product of one saved
//     record of a FARM: the farm, the record and item, spoken_name (the product name copied from
//     the stored record — a value, not his words: LogContentDocument.WordKeys does not hold it),
//     the library product he confirmed, the answer, the library version, when the server took it,
//     the sync request id (telemetry), whether it is the check (the sender held the confirm-records
//     authority), and who gave it as an opaque user id ONLY — asserted_by_user_id, no name, no
//     free text, no amount. It is the farm's product-identity history behind the record, append-only
//     by GRANT (SELECT + INSERT): the app role cannot rewrite or remove it, and an answer is
//     evidence of which product was used on which day. An erased speaker's or checker's opaque
//     user id stays on the rows he gave, exactly as on ssf.cost_entry_approvals and
//     ssf.audit_events; the phone names the person only through the operator directory, which
//     erasure anonymises. DISCLOSED: spoken_name is a copy of a product name as it was spoken; if
//     account erasure ever needs to remove product names too, that is a surgical scrub of this
//     column through the privileged admin context (as ssf.daily_log_contents above), open for
//     GO-LIVE-REGISTER F98 and not closed here by assertion.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.planned_work and ssf.planned_work_plots (plr-d10 lane L8c-1, founder D-24c) — KEEP. One planned_work row is one task or
//     reminder of a FARM: the work instruction in his words (title, note, crew words, quantity words), the date or loose
//     "when", the place (scope; plots on planned_work_plots), who it was given to, its status, and the people who made, saw,
//     accepted, cancelled and were formerly assigned it as opaque user ids ONLY — no name, no phone, no amount, no wage (a
//     headcount, a quantity and a pay choice are words, D-24a). It is the farm's record of what was asked of whom and when
//     (P10: an acknowledged change is reconstructable without the device). Doctrine P6: anonymise the person, never the work —
//     an erased person's opaque id stays on the rows, and the phone names a person only through the operator directory, which
//     erasure anonymises. Neither table can be deleted by the app role (SELECT, INSERT, UPDATE only). DISCLOSED: the title and
//     note are free words; if account erasure ever needs to remove a farmer's words from tasks he made, that is a surgical
//     scrub of those columns through the privileged admin context (as ssf.daily_log_contents above), open for
//     GO-LIVE-REGISTER F98 and not closed here by assertion.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.schedule_template_stages (plr-d10 lane SCH-A, founder D-74) — KEEP. A stage name and its day range of a schedule
//     row (e.g. "Post Pruning", days 0-15): no person, no words of a farmer, no amount. The person link of a schedule is each
//     version's maker, ssf.schedule_templates.created_by_user_id (since L8b-1 fix round 1 "who made this version", not
//     "whose"), an opaque user id. Doctrine P6: anonymise the person, never the work.
//     spec: plr-d10 lane SCH-OWN-c (founder D-137; register F222 (b)) — ssf.schedule_templates.owner_user_id is a PERSON's opaque id: the owner of
//     the farm the schedule was made on (whose own schedule it is). KEEP, like created_by_user_id above and like ssf.farms.owner_user_id, which this
//     worker does not scrub either: scrubbing one without the other would break every plot of his farms that follows it (the Own rule compares the
//     two ids at call time), so after erasure his farms' plots keep following, his farms' seats keep seeing and following, and the typist ids stay.
//     P6: anonymise the person, never the work - the phone names people only through the operator directory, which erasure anonymises.
//     variety / soil_type / region_code / climate hold list codes (what the schedule was made for), no person. No action, no ScrubbedColumnsFor entry.
//     KEEP — conscious gate-4 disposition. No scrub action.
//
//   - ssf.schedule_checks (plr-d10 lane SCH-A, founder D-74) — KEEP. One row is one decision (Approved / Returned /
//     Withdrawn) by a ShramSafal platform reviewer on one version of one library schedule: the schedule row and version, the
//     activity ids he ticked, a note (required for Returned / Withdrawn; staff words about a schedule, never a farmer's), who
//     checked as an opaque user id, the display name farmers read (for example "श्रमसफल कृषी तज्ज्ञ ‹नाव›") and when. It is a
//     professional attestation, append-only by GRANT (SELECT + INSERT): the app role cannot rewrite or remove it. An erased
//     checker's opaque user id stays on the rows he gave, exactly as on ssf.audit_events. DISCLOSED: checker_display_name
//     carries the staff member's name as typed; erasing a checker REPLACES it with "श्रमसफल कृषी तज्ज्ञ" through the privileged
//     admin context (ScrubScheduleCheckerNamesAsync, as ssf.daily_log_contents above; the app role still has no UPDATE).
//     The opaque checker id, decision, note, version and time stay. Idempotent (a second run changes 0 rows).
//     KEEP the check; SCRUB the name (S001).
//
//   - ssf.raw_blob_subjects — DELETE WHERE user_id = X. An ACTION, not a
//     disposition comment; see step 5 of the delete block in ProcessOneAsync.
//     This table is not merely adjacent to the ownership link, it IS the
//     ownership link: (sha256, user_id, first_seen_utc) and nothing else. It is
//     exactly what the ruling says must go, and unlike every ANONYMIZE above
//     there is no de-identified residue worth keeping — strip user_id from a
//     two-column linkage and the surviving row asserts nothing.
//     DISCLOSED CONSEQUENCE, stated because it is real and because
//     20260815102440_AddRawBlobSubjects was written to prevent precisely it:
//     the raw bytes in ssf.raw_blob_index / S3 are NOT deleted by this worker,
//     and production holds no s3:DeleteObject permission on either media
//     bucket, so today they cannot be. Removing the linkage therefore leaves
//     those bytes UNATTRIBUTABLE rather than gone. Under DPDP §12 that is the
//     correct trade for the SUBJECT — the identifier is what makes bytes
//     personal data — but it is not a clean purge, and calling it one would be
//     the false compliance claim this file exists to refuse. Raw-audio
//     retention and deletion remains deferred to counsel (§17); this DELETE
//     does not close it.
//     THE AUDIT ROW RECORDS THE COUNT AND NEVER THE HASHES. Writing the sha256
//     list into ssf.audit_events beside targetUserId would rebuild, inside an
//     append-only ledger, the exact subject-to-blob link this DELETE just
//     removed. That is why step 5 does not collect hashes the way step 1 does
//     for ai_jobs.
//
//   - ssf.labour_corrections — ANONYMIZE (AnonymizeLabourCorrectionsAsync
//     below). The append-only record of what a labour engagement used to say,
//     who changed it and when (20260811112633_AddLabourCorrections). In this
//     file's 5-rule numbering:
//       (a) corrected_by_user_id -> SystemActor.ErasedFarmer. This column is
//           the erased farmer's ownership of the correction, and it goes.
//       (b) reason -> NULL. Optional free text, "why, in the reviewer's words"
//           (LabourCorrection.Reason) — the farmer's own words about a third
//           party, same class as log_tasks.notes.
//       (c) KEEP farm_id, labour_assignment_id, changed_field and
//           corrected_at_utc: THAT a correction happened, to which field, on
//           which engagement, when — without who, and without their words.
//           That is the on-field execution reality the ruling protects.
//     original_value / new_value are NOT nulled on any row this table can
//     currently hold, and that is a MEASURED conclusion, not an oversight. The
//     ruling said to null them "where they can carry a worker name". They
//     cannot. LabourCorrection closes the correctable set to five fields, and
//     every write site formats the value structurally: WorkerCount / MaleCount
//     / FemaleCount go through Format(int?) (a number, or null), DurationHours
//     is "{decimal}|{TimeBasis}" (e.g. "8|Assumed"), and Attribution is
//     operatorId.ToString() — a FieldOperatorId GUID, never a name
//     (CorrectLabourHandler, four call sites). Nulling the Attribution pointer
//     would delete WHICH worker's attribution changed, which is the WORKER's
//     co-owned work history and not the erased farmer's personal data — the
//     exact inversion the ssf.field_operators bullet above already forbids
//     ("creator is not the data subject").
//     So the condition is HONOURED AS A CONDITION rather than dropped: the
//     UPDATE nulls original_value / new_value on any row whose changed_field
//     falls OUTSIDE that closed set. Today that is zero rows by construction.
//     If a future correctable field ships that does carry free text, this
//     scrub catches it BY DEFAULT instead of silently letting it through, and
//     whoever adds it has to come here and say otherwise deliberately.
//     ANONYMIZE, not DELETE: nothing FK-references this table, so a delete
//     would orphan nothing — but it would destroy the farm's correction
//     history, which is co-owned by every other reviewer on that farm. Same
//     reasoning as farm_operations (D-T1-ERASURE).
//     MEASURED, and the reason this one is an action while question_events and
//     the two consent ledgers are not: 20260811112633_AddLabourCorrections
//     issues NO REVOKE on ssf.labour_corrections, so the UPDATE is actually
//     executable. Append-only there is carried by the CODE (no Modify, no
//     Delete, no repository member, no route), which is exactly what a
//     privileged erasure path is allowed to step outside of.
//
// ── DEFERRED, NOT FORGOTTEN ─────────────────────────────────────────────
//
// The KEEPs above are de-identified at the ROW level, but de-identification is
// a property of the POPULATION, not the row: a village-level pattern derived
// from two farms names them. Before the first benchmark, comparison or
// cross-farm insight SHIPS, a minimum-contributor floor must be chosen against
// real counts, and enforced at read/publish time. Founder ruling 2026-08-27:
// the number is deliberately not chosen yet because nothing is concluded from
// this data yet — picking one before there are farmers to pick it from would be
// inventing a number, which P4 forbids.
//
// FOLDING IS ONE-WAY. A contribution already folded into a derived aggregate is
// never recomputed to remove an erased farmer, because the recomputation would
// leak his contribution as the difference.
//
// Grep marker: kanonymity-floor-before-first-benchmark.
//
// All DB writes use IAdminDbContextFactory<ShramSafalDbContext> per
// Phase 04 precedent (the cross-tenant span here is by definition
// admin-elevated — the worker iterates rows across every farm the
// user touched).

using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

public sealed class ErasureWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ErasureWorker> logger) : BackgroundService
{
    // Polling cadence mirrors the existing sweeper pattern. Erasure is
    // 48h-SLA per OQ-6 — a 60s loop is more than fast enough.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // lane F99 fix pass 2 (review N-5): the wait this worker runs with, said once at start-up.
        using (var startScope = scopeFactory.CreateScope())
        {
            var timing = startScope.ServiceProvider.GetService<ErasureTiming>() ?? new ErasureTiming();
            logger.LogInformation(
                "ErasureWorker started. A request waits {WaitDays} days before anything is erased ({Setting}).",
                timing.WaitBeforeErasure.TotalDays, ErasureTiming.ConfigurationKey);
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunPassAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ErasureWorker pass failed.");
            }

            try { await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("ErasureWorker stopping.");
    }

    /// <summary>
    /// One pass: every request whose wait has passed is erased. Internal so a test runs exactly one pass (with its own
    /// clock) instead of waiting on the 60 s loop.
    /// </summary>
    internal async Task RunPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71) — a request waits (30 days by default) before anything
        // is erased, and may be cancelled until then. Only a request asked at or before this instant is due.
        var dueIfRequestedAtOrBefore = DueIfRequestedAtOrBefore(sp);

        List<Guid> pendingIds;

        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using (var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ErasureWorker)}.enumerate",
            actorUserId: SystemActor.ErasedFarmer,
            ct: ct).ConfigureAwait(false))
        {
            pendingIds = await admin.ErasureRequests
                .Where(r => r.Status == ErasureStatus.Requested && r.RequestedAtUtc <= dueIfRequestedAtOrBefore)
                .OrderBy(r => r.RequestedAtUtc)
                .Select(r => r.Id)
                .Take(10)
                .ToListAsync(ct)
                .ConfigureAwait(false);
        }

        foreach (var requestId in pendingIds)
        {
            try
            {
                await ProcessOneAsync(sp, requestId, dueIfRequestedAtOrBefore, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ErasureWorker failed processing request {RequestId}.", requestId);
                await MarkFailedSafelyAsync(sp, requestId, ex.Message, ct).ConfigureAwait(false);
            }
        }

        // spec: plr-d10 lane WID (R8, D-71) — a WORKER's ShramSafal identity whose erasure was asked and whose wait has
        // passed: the person anonymised, never the work. Same wait, same clock; a failure is logged and retried next pass.
        try
        {
            var clock = sp.GetService<TimeProvider>() ?? TimeProvider.System;
            await WorkerPersonErasure.RunAsync(sp, dueIfRequestedAtOrBefore, clock.GetUtcNow().UtcDateTime, logger, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "ErasureWorker failed erasing a worker identity.");
        }
    }

    /// <summary>The clock (the host's <see cref="TimeProvider"/>) less the wait (<see cref="ErasureTiming"/>, 30 days by default).</summary>
    private static DateTime DueIfRequestedAtOrBefore(IServiceProvider sp)
    {
        var clock = sp.GetService<TimeProvider>() ?? TimeProvider.System;
        var timing = sp.GetService<ErasureTiming>() ?? new ErasureTiming();
        return timing.DueIfRequestedAtOrBefore(clock.GetUtcNow().UtcDateTime);
    }

    private async Task ProcessOneAsync(IServiceProvider sp, Guid requestId, DateTime dueIfRequestedAtOrBefore, CancellationToken ct)
    {
        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ErasureWorker)}.process.{requestId:N}",
            actorUserId: SystemActor.ErasedFarmer,
            ct: ct).ConfigureAwait(false);

        // lane F99 fix pass 1, item 11 (D-71) — the claim is ONE guarded UPDATE: still waiting AND its wait has passed.
        // The person's cancel uses the same guard (status still Requested), so whichever lands first wins and the other
        // changes nothing: a request is never both cancelled and erased. Zero rows = cancelled meanwhile, not due, or
        // another pass took it.
        var claimed = await admin.ErasureRequests
            .Where(r => r.Id == requestId
                && r.Status == ErasureStatus.Requested
                && r.RequestedAtUtc <= dueIfRequestedAtOrBefore)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, ErasureStatus.InProgress), ct)
            .ConfigureAwait(false);
        if (claimed == 0)
        {
            return;
        }

        var request = await admin.ErasureRequests
            .FirstOrDefaultAsync(r => r.Id == requestId, ct)
            .ConfigureAwait(false);

        if (request is null)
        {
            logger.LogWarning("ErasureRequest {RequestId} vanished before processing.", requestId);
            return;
        }

        var nowUtc = DateTime.UtcNow;
        var targetUserId = request.TargetUserId;
        var sentinel = SystemActor.ErasedFarmer;

        var totalAnonymized = 0;
        var perTableCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var voiceClipsDeferred = false;

        // (a) daily_logs — scrub operator_user_id; NULL notes if present.
        //     DailyLog has no Notes column on the aggregate, but LogTask
        //     (child) carries notes; we scrub the operator on DailyLog +
        //     null the notes on LogTask rows whose parent log belongs to
        //     the user. ORDER MATTERS: null the LogTask notes FIRST
        //     (joins to daily_logs.operator_user_id with the original
        //     user_id), then scrub the parent daily_logs row.
        perTableCounts["log_tasks"] = await NullLogTaskNotesAsync(admin, targetUserId, nowUtc, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["log_tasks"];

        // 2026-07-19 additions (founder Decision 5, spec
        // 2026-07-13-labour-attendance-approval-design) — ssf.workers and
        // ssf.labour_assignments.worker_names_json both hold a third party's
        // real name and are both reached via the parent daily_log's
        // operator_user_id, so BOTH must run here, alongside
        // NullLogTaskNotesAsync, BEFORE AnonymizeDailyLogsAsync scrubs that
        // column to the sentinel. See the ssf.workers / ssf.labour_assignments
        // manifest comments above for the full disposition + disclosed limits.
        perTableCounts["workers"] = await AnonymizeWorkersDerivedFromUserLogsAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["workers"];

        perTableCounts["labour_assignments"] = await AnonymizeLabourAssignmentWorkerNamesAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["labour_assignments"];

        // spec: plr-d10 (lane F1) — his words inside what Sathi understood. BEFORE the daily_logs
        // scrub below, for the same reason as NullLogTaskNotesAsync: the join needs his id.
        perTableCounts["daily_log_contents"] = await ScrubDailyLogContentWordsAsync(admin, targetUserId, sentinel, nowUtc, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["daily_log_contents"];

        // spec: plr-d10 lane SCH-A fix round 1 (S001, P6) - the checker's NAME on ShramSafal's schedule checks. The check stays.
        perTableCounts["schedule_checks"] = await ScrubScheduleCheckerNamesAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["schedule_checks"];

        // spec: plr-d10 lane CMP-D3 (founder D-68 round 2; P6) - the WORDS of every reason he wrote. The kind stays. (Keyed by the author's own id,
        // which is not scrubbed anywhere, so the order against AnonymizeDailyLogsAsync does not matter.)
        perTableCounts["log_practice_reasons"] = await ScrubLogPracticeReasonWordsAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["log_practice_reasons"];

        perTableCounts["daily_logs"] = await AnonymizeDailyLogsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["daily_logs"];

        // (b) cost_entries — scrub created_by_user_id; NULL description
        //     (the only free-text field per OQ-7 verdict — no vendor
        //     field exists in the current schema). Excludes payout
        //     entries per DS-017 — payouts are financial records that
        //     must keep their actor for downstream reconciliation.
        //     The current CostEntry shape has no IsPayout flag; we scrub
        //     all non-corrected entries (mirrors the DailyLog blanket
        //     scrub — the worker manifest is the source of truth).
        perTableCounts["cost_entries"] = await AnonymizeCostEntriesAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["cost_entries"];

        // (c) correction_events — scrub user_id (the only actor field
        //     per CorrectionEvent.cs). free-text columns (OriginalParseRaw
        //     / CorrectedParse) carry user input but are deliberately
        //     kept per DS-017 rule (c) compliance-relevant: the corpus
        //     uses them for retraining. The user_id sentinel makes them
        //     non-attributable.
        perTableCounts["correction_events"] = await AnonymizeCorrectionEventsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["correction_events"];

        // (d) finance_corrections — scrub corrected_by_user_id; NULL
        //     reason free-text per OQ-10.
        perTableCounts["finance_corrections"] = await AnonymizeFinanceCorrectionsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["finance_corrections"];

        // (e) farm_operations — Track B operational ledger (D-T1-ERASURE).
        //     Scrub created_by_user_id; KEEP farm_id + operation facts +
        //     derived_event_key (de-identified). ANONYMIZE, not DELETE.
        perTableCounts["farm_operations"] = await AnonymizeFarmOperationsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["farm_operations"];

        // (f) labour_corrections — founder ruling 2026-08-27 (spec:
        //     2026-08-25-prod-cutover-waves). Scrub corrected_by_user_id and
        //     NULL the reviewer's free-text reason; KEEP farm_id,
        //     labour_assignment_id, changed_field and corrected_at_utc, so the
        //     farm still knows THAT a correction happened, to which field, on
        //     which engagement and when — without who, and without their words.
        //
        //     Keyed DIRECTLY on corrected_by_user_id, so unlike the daily_logs
        //     children above it carries no ordering constraint against
        //     AnonymizeDailyLogsAsync and is safe anywhere in this sequence.
        //     See the manifest comment at the top of this file for why
        //     original_value / new_value survive on every changed_field this
        //     table can hold today — that is measured, not skipped.
        perTableCounts["labour_corrections"] = await AnonymizeLabourCorrectionsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["labour_corrections"];

        // ── SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 cascade extension ─
        // Voice-spine tables follow a DELETE manifest (not ANONYMIZE)
        // because they are pure training-corpus + observability rows
        // whose identity collapses to the audio content hash. Order
        // matters here: collect audio hashes from ai_jobs FIRST, then
        // delete ai_jobs (which cascade-removes ai_job_attempts +
        // owned Provenance + the transcript_* columns embedded on
        // ai_jobs), then orphan-clean transcript_history by the
        // collected hashes. golden_set_candidate is a parallel user-
        // keyed delete (independent of the hash collection).

        // 1) Collect the user's audio content hashes BEFORE deleting
        //    ai_jobs. We materialise the distinct set so the orphan-
        //    clean DELETE on transcript_history can use a stable IN
        //    list. Empty list = nothing to orphan-clean.
        var userAudioHashes = await admin.AiJobs
            .AsNoTracking()
            .Where(j => j.UserId == targetUserId && j.InputContentHash != null)
            .Select(j => j.InputContentHash!)
            .Distinct()
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // 2) Delete ai_jobs WHERE user_id = X. EF's ExecuteDeleteAsync
        //    emits a single SQL DELETE; the configured cascade on
        //    ai_job_attempts (DeleteBehavior.Cascade in
        //    AiJobConfiguration.HasMany) drops the children. The
        //    Provenance owned columns + the Phase 1.1 transcript_*
        //    columns live ON the ai_jobs row and drop with it.
        perTableCounts["ai_jobs"] = await admin.AiJobs
            .Where(j => j.UserId == targetUserId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        totalAnonymized += perTableCounts["ai_jobs"];

        // 3) Orphan-clean transcript_history. The table has no
        //    user_id column; rows are keyed on
        //    (audio_content_hash, provider, model_version, mode).
        //    Rows whose audio hash belonged to the user are removed
        //    transitively. Hashes that survived because they were
        //    re-used by a different user (extremely rare —
        //    SHA-256 collision is the only legitimate cross-user
        //    case) stay. Skip the DELETE when the user had no
        //    audio hashes.
        if (userAudioHashes.Count > 0)
        {
            perTableCounts["transcript_history"] = await admin.TranscriptHistories
                .Where(t => userAudioHashes.Contains(t.AudioContentHash))
                .ExecuteDeleteAsync(ct)
                .ConfigureAwait(false);
            totalAnonymized += perTableCounts["transcript_history"];
        }
        else
        {
            perTableCounts["transcript_history"] = 0;
        }

        // 4) Delete golden_set_candidate WHERE user_id = X. The
        //    training-corpus row is user-attributable by construction
        //    (Task 3.3 carries user_id + farm_id as first-class
        //    columns); DPDP §12 erases the row outright.
        perTableCounts["golden_set_candidate"] = await admin.GoldenSetCandidates
            .Where(g => g.UserId == targetUserId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        totalAnonymized += perTableCounts["golden_set_candidate"];

        // 5) Delete raw_blob_subjects WHERE user_id = X — founder ruling
        //    2026-08-27 (spec: 2026-08-25-prod-cutover-waves). This table is
        //    the (sha256 -> subject) ownership link and nothing else, so
        //    ANONYMIZE has no meaning on it: a linkage row stripped of its
        //    subject asserts nothing at all. It is exactly the ownership the
        //    ruling says must go.
        //
        //    NO HASH COLLECTION HERE, deliberately — contrast step 1. Step 1
        //    materialises the user's audio hashes because transcript_history
        //    has no user_id and can only be orphan-cleaned BY hash. Here the
        //    hashes would serve no delete, and carrying them into the audit
        //    payload beside targetUserId would rebuild the subject-to-blob link
        //    inside an append-only ledger — undoing this DELETE in the one
        //    table nobody can rewrite. The audit row gets the COUNT only.
        //
        //    Position in the sequence is free rather than load-bearing: the FK
        //    (fk_raw_blob_subjects_sha256) points OUT to ssf.raw_blob_index and
        //    nothing points in, and the retained-voice purge below keys on
        //    voice_clips_retained.user_id, not on this table — so removing the
        //    linkage first cannot blind it. Verified, not assumed.
        //
        //    DISCLOSED, and repeated here because this is where it happens: the
        //    bytes are NOT deleted. See the ssf.raw_blob_subjects bullet in the
        //    manifest above.
        perTableCounts["raw_blob_subjects"] = await admin.RawBlobSubjects
            .Where(s => s.UserId == targetUserId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        totalAnonymized += perTableCounts["raw_blob_subjects"];

        // lane MU-2 fix round 1 (review M-3, P6) — every personal invitation, on every farm, naming his login's number loses
        // the name and number the owner typed (the row, the farm's record of the invitation, stays).
        var hisNumber = ShramSafal.Domain.Identity.IndianMobile.Normalize(await admin.Database
            .SqlQueryRaw<string>("SELECT phone AS \"Value\" FROM public.users WHERE \"Id\" = {0}", targetUserId)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false));
        perTableCounts["farm_personal_invitations"] = hisNumber is null
            ? 0
            : await PersonalInvitationPeople.ForgetNumbersAsync(admin, [hisNumber], [], ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["farm_personal_invitations"];

        // (e) Retained voice S3 — via port.
        //
        // ── EVERY exception is caught here, and that is the whole point ──
        //
        // By the time control reaches this line the nine tables above are
        // ALREADY SCRUBBED AND COMMITTED. There is no transaction around the
        // cascade: each anonymizer runs ExecuteSqlRawAsync/ExecuteDeleteAsync,
        // which autocommits immediately on this admin context. The audit rows,
        // by contrast, are only tracked — they do not exist until the
        // SaveChangesAsync at the end of this method.
        //
        // So an exception escaping this block does not "abort the erasure". The
        // erasure has happened. What it aborts is the RECORD of it: the run
        // unwinds to RunPassAsync, which stamps the request Failed with no audit
        // events at all. A support person or DPDP auditor then reads `Failed`
        // and truthfully but wrongly tells the farmer their deletion did not go
        // through — and a retry cannot correct them, because the rows it would
        // count are already gone, so it reports SMALLER numbers than the truth.
        //
        // The previous catch handled exactly one type, NotImplementedException,
        // for a stub (PendingRetainedBlobStore) that no longer exists — deleted
        // in the Voice Diary ship, which Program.cs:445-451 and this port's own
        // docstring both record. It guarded against the one thing that could no
        // longer be thrown while letting through everything that could:
        // AccessDenied, throttling, a network fault, a DB error on the metadata
        // read, cancellation at shutdown.
        //
        // Fixing this by making the scrub conditional on the S3 delete would be
        // the wrong direction: it would mean erasure never completes at all
        // wherever the delete cannot succeed, which is strictly worse for the
        // farmer. What has to become atomic is the RECORD, not the deletion.
        string? retainedVoiceResidue = null;

        // Recorded verbatim in the audit payload. A boolean could not tell a
        // skip from a failure, and conflating them is exactly the bug fixed
        // here.
        //
        // Domain of this field: the three RetainedVoiceDeletionStatus names
        // (NothingToDelete | Deleted | SkippedNoBucketConfigured) PLUS the
        // string "Failed", which is NOT an enum member — the store threw, so it
        // returned no outcome at all. A consumer must therefore parse this as a
        // string with a four-value domain; Enum.Parse over
        // RetainedVoiceDeletionStatus will throw on "Failed".
        var retainedVoiceOutcome = nameof(RetainedVoiceDeletionStatus.NothingToDelete);

        // Magnitude, not just a verb. The port returns
        // RetainedVoiceDeletionOutcome — a record carrying counts — so the audit
        // row can state HOW MUCH was removed and how much was knowingly left
        // behind, instead of a bare outcome name the reader has to size for
        // themselves.
        //
        // All three stay 0 on the throw path, where the store returned nothing
        // and we therefore know nothing. That is why retainedVoiceOutcome
        // carries "Failed" alongside them: without it, three zeros read exactly
        // like a clean run over an empty tier.
        var retainedVoiceBlobsDeleted = 0;
        var retainedVoiceMetadataRowsRemoved = 0;
        var retainedVoiceClipsLeftInPlace = 0;

        var retainedStore = sp.GetRequiredService<IRetainedBlobStore>();
        try
        {
            var storeOutcome = await retainedStore
                .DeleteRetainedVoiceForUserAsync(targetUserId, ct)
                .ConfigureAwait(false);
            retainedVoiceOutcome = storeOutcome.Status.ToString();
            retainedVoiceBlobsDeleted = storeOutcome.BlobsDeleted;
            retainedVoiceMetadataRowsRemoved = storeOutcome.MetadataRowsRemoved;
            retainedVoiceClipsLeftInPlace = storeOutcome.ClipsLeftInPlace;

            // A silent skip is residue too, not success. With no bucket
            // configured the store now touches NOTHING — not the S3 object, and
            // deliberately not the metadata row either, because that row is the
            // farmer's only pointer to audio which is still in the bucket.
            // Removing it would leave the recording unreachable by the farmer
            // AND undeleted in fact, unrecoverably. That state is reachable
            // through a DOCUMENTED rollback (aws/voice-retained/README.md:148
            // blanks RetainedBlobStore__BucketName and states "clips remain in
            // S3 untouched"), not just by a typo. Recording it as
            // retainedVoiceDeleted:true would be an affirmative false claim on
            // the erasure path, which is worse than the silence it replaced.
            //
            // The test is CanBeReportedAsDeleted, not equality against one
            // status. "May I call this a deletion?" is the question the record
            // exists to answer, and any status added later that also fails it
            // lands here by default instead of falling through as success.
            if (!storeOutcome.CanBeReportedAsDeleted)
            {
                voiceClipsDeferred = true;
                retainedVoiceResidue = Truncate(
                    $"{storeOutcome.Status}: RetainedBlobStore:BucketName is blank, so "
                    + $"{storeOutcome.ClipsLeftInPlace} voice_clips_retained row(s) were LEFT IN "
                    + "PLACE and no S3 object was touched. PersistAsync refuses to write a row "
                    + "without a bucket, so those clips were stored while one was configured and "
                    + "are still in the bucket; the rows that locate them are retained on purpose "
                    + "so the purge can actually be completed once a bucket is configured.");
            }
        }
        catch (Exception ex)
        {
            // Cancellation is deliberately included. At shutdown the scrub is
            // still done, so the record still has to land — see recordCt below.
            voiceClipsDeferred = true;
            retainedVoiceOutcome = "Failed";
            retainedVoiceResidue = Truncate($"{ex.GetType().Name}: {ex.Message}");

            logger.LogError(ex,
                "ErasureWorker: retained voice deletion FAILED for user {UserId}. The database scrub "
                + "already completed and is committed; request will be stamped CompletedWithResidue "
                + "so the record does not claim nothing happened.",
                targetUserId);
        }

        // From here to SaveChangesAsync the work is NON-CANCELLABLE, on purpose.
        //
        // The irreversible part is done. If a shutdown token cancelled the audit
        // write we would reproduce the exact defect this change removes — data
        // gone, no record — only triggered by a deploy instead of by S3. Writing
        // the record is a handful of local inserts; finishing it is always
        // correct and always fast.
        //
        // ── FOLLOW-UP: erasure-cancellation-midscrub — TRACKED ──
        //
        // This does NOT cover a cancellation that lands mid-scrub, higher up.
        // That window is much larger than the one closed here: the nine
        // anonymizers run raw SQL across nine tables and account for nearly all
        // the wall-clock in which a shutdown can land, whereas the guard above
        // protects a single await.
        //
        // Consequences there are worse, not equal: RunPassAsync's catch is
        // `when (ex is not OperationCanceledException)`, so MarkFailedSafelyAsync
        // never runs; and the poller selects only Requested rows, so the request
        // is stranded at InProgress PERMANENTLY and is never retried — some
        // tables scrubbed, no audit, no terminal state, no second attempt.
        //
        // Deferred on scope, not on judgement. Tracked at
        // _COFOUNDER/specs/_inbox/erasure-cancellation-midscrub-2026-08-16.md.
        // Grep marker: erasure-cancellation-midscrub.
        var recordCt = CancellationToken.None;

        // Per-row audit emission per DS-017 rule (d). We emit one
        // aggregate "ErasureAnonymize/Applied" row per TABLE (carrying
        // the count + scrubbed columns) rather than literally one row
        // per data row — the per-data-row spec is the test contract
        // (ErasureWorkerAnonymizationTest seeds PII rows + asserts
        // surviving rows carry the sentinel + per-row AuditEvent
        // entries). To keep that contract honest we emit one
        // AuditEvent per anonymized data row, batched here.
        await EmitPerRowAuditEventsAsync(admin, request, perTableCounts, sentinel, recordCt).ConfigureAwait(false);

        if (retainedVoiceResidue is null)
        {
            request.MarkCompleted(totalAnonymized, nowUtc);
        }
        else
        {
            // Scrub done, something named still exists. Distinguishable in the
            // persisted state from both "clean" and "nothing happened".
            request.MarkCompletedWithResidue(totalAnonymized, nowUtc);
        }

        // Final ErasureRequest audit row (single, not per-table).
        var completionPayload = new
        {
            requestId = request.Id,
            targetUserId,
            rowsAnonymizedCount = totalAnonymized,
            perTableCounts,
            voiceClipsRetainedDeferred = voiceClipsDeferred,

            // What actually happened to the retained voice tier, stated either
            // way rather than only on failure — an absent field reads as "not
            // considered", which is what we are trying to stop doing.
            //
            // retainedVoiceDeleted is TRUE only when the tier is genuinely
            // clear (Deleted, or NothingToDelete because the subject had none).
            // A no-bucket skip touches neither the S3 object nor the row that
            // locates it, so it reports FALSE and carries residue text — it is
            // not success, and the clips are still there to be purged later.
            retainedVoiceDeleted = retainedVoiceResidue is null,
            retainedVoiceOutcome,
            retainedVoiceResidue,

            // The magnitude behind the outcome name. clipsLeftInPlace is the
            // number this record is actually accountable for: clips we know
            // still exist and have said, here, that we did not delete.
            retainedVoiceBlobsDeleted,
            retainedVoiceMetadataRowsRemoved,
            retainedVoiceClipsLeftInPlace,

            // Requirement: a retry must not report smaller numbers than the
            // truth. These counts are what THIS run scrubbed. Any later run for
            // the same subject necessarily counts fewer rows, because this run
            // already removed them — such counts are post-hoc and are not a
            // measure of what was erased.
            countsAreFromThisRunOnly = true,
        };

        var completionAudit = AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: request.Id,
            action: retainedVoiceResidue is null ? "Completed" : "CompletedWithResidue",
            actorUserId: sentinel,
            actorRole: "system_erasure_worker",
            payload: completionPayload,
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: "system",
            ipHash: "sha256:system",
            sourceAiJobId: null);
        admin.AuditEvents.Add(completionAudit);

        // recordCt, not ct — see the note above. The scrub is irreversible and
        // already committed; the record must land even if we are shutting down.
        //
        // ── The status transition is in-memory until THIS line commits ──
        //
        // MarkCompleted/MarkCompletedWithResidue above only mutate the tracked
        // entity. Until this SaveChangesAsync succeeds the row is still
        // InProgress in the database. So if this call is the thing that fails —
        // statement timeout on a loaded box, connection drop, deadlock — the
        // exception unwinds to RunPassAsync, MarkFailedSafelyAsync opens a
        // FRESH context, reads InProgress, passes its own guard, and stamps
        // Failed. Nine tables scrubbed, zero audit rows, status Failed: the
        // exact defect this method exists to remove, reached through a
        // different door. The terminal-state guard cannot help, because the
        // terminal state was never written.
        //
        // So a failure here gets one fallback attempt on a fresh context that
        // writes the MINIMUM honest record — the status transition plus a single
        // compact audit row. It deliberately drops the per-row audit events,
        // which are the bulk of the payload and the likeliest cause of a slow or
        // oversized write; a smaller write is the one most likely to succeed
        // where the first did not.
        try
        {
            await admin.SaveChangesAsync(recordCt).ConfigureAwait(false);
        }
        catch (Exception saveEx)
        {
            await TryWriteMinimalOutcomeRecordAsync(
                sp, request.Id, targetUserId, totalAnonymized,
                retainedVoiceOutcome, retainedVoiceResidue, saveEx)
                .ConfigureAwait(false);

            // Rethrow so the failure stays visible. This is now safe: if the
            // fallback landed, the row is already terminal and
            // MarkFailedSafelyAsync's guard blocks the downgrade to Failed.
            throw;
        }

        if (retainedVoiceResidue is null)
        {
            logger.LogInformation(
                "ErasureWorker completed request {RequestId} for user {UserId}: {Count} rows anonymized.",
                request.Id, targetUserId, totalAnonymized);
        }
        else
        {
            logger.LogError(
                "ErasureWorker completed request {RequestId} for user {UserId} WITH RESIDUE: {Count} rows "
                + "anonymized, but retained voice deletion failed ({Residue}). The farmer's raw audio still "
                + "exists. Status is CompletedWithResidue and the audit event carries the detail — query "
                + "ssf.erasure_requests, do not rely on this log line reaching anyone.",
                request.Id, targetUserId, totalAnonymized, retainedVoiceResidue);
        }
    }

    // ── Per-table anonymizers ────────────────────────────────────────
    // Use raw SQL (ExecuteSqlRawAsync) so we don't have to materialise
    // potentially-large row sets into EF tracked entities just to flip
    // a couple of columns. The admin context bypasses RLS so the
    // UPDATEs hit every farm the user touched.

    /// <summary>
    /// spec: plr-d10 lane SCH-A fix round 1 (S001; doctrine P6: anonymise the person, never the work). Replaces
    /// <c>checker_display_name</c> with "श्रमसफल कृषी तज्ज्ञ" on the checks the erased person gave. Like the daily-log scrub it
    /// runs on the migration-role context, the only one the append-only REVOKE leaves able to rewrite a row (the app role
    /// has no UPDATE). The opaque <c>checker_user_id</c>, decision, note, version and time stay. Idempotent: a row already
    /// carrying the sentinel is skipped, so a second run changes 0 rows. <c>schedule_checks</c> is not under row-level
    /// security (platform data), so no filtering can hide a row.
    /// </summary>
    internal static async Task<int> ScrubScheduleCheckerNamesAsync(ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        return await db.Database.ExecuteSqlRawAsync(
            "UPDATE ssf.schedule_checks SET checker_display_name = {0} WHERE checker_user_id = {1} AND checker_display_name <> {0}",
            new object[] { "श्रमसफल कृषी तज्ज्ञ", userId },
            ct).ConfigureAwait(false);
    }

    /// <summary>
    /// spec: plr-d10 lane CMP-D3 (founder D-68 round 2; doctrine P6: anonymise the person, never the work). Removes HIS WORDS from every reason he
    /// wrote (<c>words</c> NULL, <c>said_by_voice</c> false) and keeps the row: its KIND, its item, its record, its time and his opaque id stay.
    /// Like the daily-log scrub it runs on the migration-role context, the only one the append-only REVOKE leaves able to rewrite a row (the app role
    /// has no UPDATE). The table is FORCE-RLS: the whole transaction runs under <c>SET LOCAL row_security = off</c>, so a connection row-level security
    /// WOULD filter raises an error instead of reading none of his rows and reporting success. It then proves that none of his rows still holds words.
    /// Idempotent: a row without words is skipped, so a second run changes 0 rows.
    /// </summary>
    internal static async Task<int> ScrubLogPracticeReasonWordsAsync(ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await db.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct).ConfigureAwait(false);

        int changed;
        try
        {
            changed = await db.Database.ExecuteSqlRawAsync(
                "UPDATE ssf.log_practice_reasons SET words = NULL, said_by_voice = false WHERE author_user_id = {0} AND words IS NOT NULL",
                new object[] { userId },
                ct).ConfigureAwait(false);
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == Npgsql.PostgresErrorCodes.InsufficientPrivilege)
        {
            throw new InvalidOperationException(
                "Erasure cannot reach every farm's reasons on this connection: row-level security would filter "
                + $"ssf.log_practice_reasons ({ex.MessageText}). It must run on the migration connection (ShramSafalDb_Migration), "
                + "as an identity row-level security does not filter.",
                ex);
        }

        var left = await db.Database
            .SqlQueryRaw<int>(
                @"SELECT count(*)::int AS ""Value"" FROM ssf.log_practice_reasons WHERE author_user_id = {0} AND words IS NOT NULL",
                userId)
            .SingleAsync(ct)
            .ConfigureAwait(false);
        if (left != 0)
        {
            throw new InvalidOperationException($"Erasure left {left} reasons still holding the farmer's words.");
        }

        await tx.CommitAsync(ct).ConfigureAwait(false);
        return changed;
    }

    /// <summary>
    /// spec: plr-d10 (lane F1) — removes HIS WORDS (<see cref="ShramSafal.Application.UseCases.Logs.Content.LogContentDocument.WordKeys"/>)
    /// from every stored content row of every log he spoke, keeping the values, and replaces
    /// <c>written_by_user_id</c> with the sentinel on the rows he wrote. Idempotent: a row whose
    /// words were already removed is skipped. MUST run before <see cref="AnonymizeDailyLogsAsync"/>
    /// — the join needs the original operator_user_id.
    /// <para><b>Every phone hears about it (review N6).</b> Each scrubbed log's
    /// <c>modified_at_utc</c> moves forward in the SAME transaction, so the pull carries the scrubbed
    /// document to every phone that holds the log and his words leave those phones too.</para>
    /// <para><b>It fails loudly, never silently (review N7).</b> Both tables are FORCE-RLS: a
    /// connection that row-level security filters would read none of his rows and report success
    /// with his words still stored. The guard measures the EFFECT, not the role: the scrub's whole
    /// transaction runs under <c>SET LOCAL row_security = off</c>, so any statement that row-level
    /// security WOULD filter raises an error instead (Postgres: "query would be affected by
    /// row-level security policy"). Whatever makes the connection unfiltered — superuser, BYPASSRLS,
    /// ownership, or prod's <c>agrisync_admin</c> as a member of <c>rds_superuser</c> (which has
    /// neither attribute; PROD-CUTOVER plan §0.2, A13) — the scrub proceeds; anything else stops
    /// it. It then proves it changed every row it read, and that none of his rows still holds
    /// words; any miss throws, the request is marked failed, and nothing is half-committed.</para>
    /// </summary>
    internal static async Task<int> ScrubDailyLogContentWordsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, DateTime nowUtc, CancellationToken ct)
    {
        const string hisRowsWithWords = @"
SELECT c.*
  FROM ssf.daily_log_contents AS c
  JOIN ssf.daily_logs AS l ON l.""Id"" = c.daily_log_id
 WHERE l.operator_user_id = {0}
   AND c.words_erased_at_utc IS NULL";

        await using var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await db.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct).ConfigureAwait(false);

        List<ShramSafal.Domain.Logs.DailyLogContent> rows;
        try
        {
            rows = await db.DailyLogContents
                .FromSqlRaw(hisRowsWithWords, userId)
                .ToListAsync(ct)
                .ConfigureAwait(false);
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == Npgsql.PostgresErrorCodes.InsufficientPrivilege)
        {
            throw new InvalidOperationException(
                "Erasure cannot read every farm's stored details on this connection: row-level security would filter "
                + $"ssf.daily_log_contents / ssf.daily_logs ({ex.MessageText}). It must run on the migration connection "
                + "(ShramSafalDb_Migration), as an identity row-level security does not filter.",
                ex);
        }

        foreach (var row in rows)
        {
            row.EraseWords(
                ShramSafal.Application.UseCases.Logs.Content.LogContentDocument.StripWords(row.DocumentJson),
                nowUtc);
        }

        var written = rows.Count > 0 ? await db.SaveChangesAsync(ct).ConfigureAwait(false) : 0;
        if (written != rows.Count)
        {
            throw new InvalidOperationException(
                $"Erasure read {rows.Count} stored detail rows holding the farmer's words but changed {written}.");
        }

        var logIds = rows.Select(r => r.DailyLogId).Distinct().ToArray();
        if (logIds.Length > 0)
        {
            var moved = await db.Database.ExecuteSqlRawAsync(
                @"UPDATE ssf.daily_logs SET modified_at_utc = GREATEST(modified_at_utc, {0}) WHERE ""Id"" = ANY({1})",
                new object[] { nowUtc, logIds },
                ct).ConfigureAwait(false);
            if (moved != logIds.Length)
            {
                throw new InvalidOperationException(
                    $"Erasure scrubbed the details of {logIds.Length} logs but could move only {moved} of them forward for the phones.");
            }
        }

        var left = await db.DailyLogContents
            .FromSqlRaw(hisRowsWithWords, userId)
            .CountAsync(ct)
            .ConfigureAwait(false);
        if (left != 0)
        {
            throw new InvalidOperationException(
                $"Erasure left {left} stored detail rows still holding the farmer's words.");
        }

        const string reattribute = @"
UPDATE ssf.daily_log_contents
   SET written_by_user_id = {0}
 WHERE written_by_user_id = {1}
   AND written_by_user_id <> {0};";
        var reattributed = await db.Database.ExecuteSqlRawAsync(reattribute, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);

        await tx.CommitAsync(ct).ConfigureAwait(false);
        return rows.Count + reattributed;
    }

    private static async Task<int> AnonymizeDailyLogsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.daily_logs
   SET operator_user_id = {0}
 WHERE operator_user_id = {1}
   AND operator_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> NullLogTaskNotesAsync(
        ShramSafalDbContext db, Guid userId, DateTime nowUtc, CancellationToken ct)
    {
        // LogTask doesn't carry an actor column; only the notes/deviation_note
        // free-text fields. Scope by the parent daily_log's operator_user_id —
        // anonymizing the operator should also null the personal free-text
        // on the child tasks the operator wrote.
        //
        // Callers MUST run NullLogTaskNotesAsync BEFORE AnonymizeDailyLogsAsync
        // (see ProcessOneAsync ordering): the join needs the original user_id.
        //
        // spec: plr-d10 (lane F1, review N6) — and every log whose task notes were
        // nulled moves its modified_at_utc forward in the SAME transaction, so the
        // pull carries the scrubbed lines to every phone that holds them; before
        // this, a phone that already had his notes kept them.
        await using var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        var logIds = await db.Database
            .SqlQueryRaw<Guid>(@"
SELECT DISTINCT t.daily_log_id AS ""Value""
  FROM ssf.log_tasks AS t
  JOIN ssf.daily_logs AS l ON t.daily_log_id = l.""Id""
 WHERE l.operator_user_id = {0}
   AND (t.notes IS NOT NULL OR t.deviation_note IS NOT NULL)", userId)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        const string sql = @"
UPDATE ssf.log_tasks AS t
   SET notes = NULL,
       deviation_note = NULL
  FROM ssf.daily_logs AS l
 WHERE t.daily_log_id = l.""Id""
   AND l.operator_user_id = {0}
   AND (t.notes IS NOT NULL OR t.deviation_note IS NOT NULL);";
        var nulled = await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);

        if (logIds.Count > 0)
        {
            await db.Database.ExecuteSqlRawAsync(
                @"UPDATE ssf.daily_logs SET modified_at_utc = GREATEST(modified_at_utc, {0}) WHERE ""Id"" = ANY({1})",
                new object[] { nowUtc, logIds.ToArray() },
                ct).ConfigureAwait(false);
        }

        await tx.CommitAsync(ct).ConfigureAwait(false);
        return nulled;
    }

    /// <summary>
    /// 2026-07-19 addition (founder Decision 5, spec
    /// 2026-07-13-labour-attendance-approval-design). Sentinel-replaces
    /// <c>ssf.workers.name_raw</c> / <c>name_normalized</c> — never a hard
    /// DELETE, since <c>worker_assignments.worker_id</c> carries
    /// <c>ON DELETE CASCADE</c> and deleting the Worker row would silently
    /// orphan-destroy every WorkerAssignment link row plus the
    /// assignment_count history the admin Mode A drilldown reads. Scope: any
    /// Worker reached via a WorkerAssignment on a daily_log THIS erased user
    /// authored — see the ssf.workers manifest comment above for the
    /// disclosed limit (a Worker with assignments from a different operator
    /// too is still scrubbed). MUST run before <see cref="AnonymizeDailyLogsAsync"/>
    /// — the join needs the original operator_user_id.
    /// </summary>
    private static async Task<int> AnonymizeWorkersDerivedFromUserLogsAsync(
        ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.workers AS w
   SET name_raw = 'Erased worker',
       name_normalized = 'erased worker'
  FROM ssf.worker_assignments AS wa
  JOIN ssf.daily_logs AS dl ON dl.""Id"" = wa.daily_log_id
 WHERE w.""Id"" = wa.worker_id
   AND dl.operator_user_id = {0}
   AND w.name_raw <> 'Erased worker';";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// 2026-07-19 addition (founder Decision 5). <c>worker_names_json</c> was
    /// added to <c>ssf.labour_assignments</c> by migration
    /// <c>20260718132540_AddLabourAssignmentShiftTaskNames</c> and holds the
    /// farmer's own spoken free-text naming a third-party worker — unlike the
    /// rest of that row, this is embedded PII, not a de-identified
    /// operational fact (see the corrected manifest comment above). Scrubbed
    /// to <c>'[]'::jsonb</c> whenever the parent daily_log's operator_user_id
    /// matches the erased user. MUST run before
    /// <see cref="AnonymizeDailyLogsAsync"/> for the same reason as
    /// <see cref="NullLogTaskNotesAsync"/> — the join needs the original
    /// operator_user_id.
    /// </summary>
    private static async Task<int> AnonymizeLabourAssignmentWorkerNamesAsync(
        ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.labour_assignments AS la
   SET worker_names_json = '[]'::jsonb
  FROM ssf.daily_logs AS dl
 WHERE la.daily_log_id = dl.""Id""
   AND dl.operator_user_id = {0}
   AND la.worker_names_json <> '[]'::jsonb;";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Labour V1 Task 10.5 (spec: 2026-07-13-labour-attendance-approval-design).
    /// <b>Worker-subject erasure.</b> Sentinel-replaces every name column that
    /// identifies ONE <c>FieldOperator</c>:
    /// <c>ssf.field_operators.display_name</c>, <c>.display_name_normalized</c>,
    /// <c>.full_name</c>, and <c>ssf.field_operator_work_rows.display_name_at_attach</c>
    /// on every work row attributed to that operator.
    /// <para>
    /// <b>Invoked by an explicit worker-erasure decision, never by account
    /// deletion.</b> It is deliberately NOT called from
    /// <c>ProcessOneAsync</c>'s creator-erasure sequence and takes a
    /// <c>fieldOperatorId</c> — not a <c>userId</c> — precisely so it cannot be
    /// wired to one by accident: the farmer who typed a worker's name is not
    /// that worker's data subject (see the manifest comment above).
    /// </para>
    /// <para>
    /// <b>Anonymize the person, never the work.</b> The row itself survives, as
    /// do <c>Id</c> (the FieldOperatorId), <c>originating_farm_id</c>,
    /// <c>created_at_utc</c>, and on every work row the
    /// <c>field_operator_id</c> / <c>labour_assignment_id</c> relationship and
    /// <c>work_date</c>. The engagement's own reported headcount is untouched —
    /// attribution never changed the reported quantity, so erasing attribution
    /// must not either.
    /// </para>
    /// <para>
    /// Sentinels match the existing <c>ssf.workers</c> idiom
    /// (<c>'Erased worker'</c> / <c>'erased worker'</c>). Returns the total
    /// number of rows updated across both tables. Idempotent: the
    /// already-scrubbed guards make a second call a no-op returning 0.
    /// </para>
    /// </summary>
    public static async Task<int> AnonymizeFieldOperatorAsync(
        ShramSafalDbContext db, Guid fieldOperatorId, CancellationToken ct)
    {
        // Work rows FIRST: the snapshot column is what a reader actually sees
        // on a payout, so it must not be the last thing to disappear.
        const string workRowSql = @"
UPDATE ssf.field_operator_work_rows
   SET display_name_at_attach = 'Erased worker'
 WHERE field_operator_id = {0}
   AND display_name_at_attach <> 'Erased worker';";
        var workRows = await db.Database
            .ExecuteSqlRawAsync(workRowSql, new object[] { fieldOperatorId }, ct)
            .ConfigureAwait(false);

        // All four name columns get the sentinel — full_name included rather
        // than NULLed, so "erased" is an explicit, readable state everywhere
        // instead of being indistinguishable from "never captured".
        // IS DISTINCT FROM, not <>, because full_name is nullable and NULL <> x
        // is NULL (never true) — with <> the guard would skip a row whose
        // full_name is NULL and leave the other two columns unscrubbed.
        const string operatorSql = @"
UPDATE ssf.field_operators
   SET display_name = 'Erased worker',
       display_name_normalized = 'erased worker',
       full_name = 'Erased worker'
 WHERE ""Id"" = {0}
   AND (display_name <> 'Erased worker'
        OR display_name_normalized <> 'erased worker'
        OR full_name IS DISTINCT FROM 'Erased worker');";
        var operators = await db.Database
            .ExecuteSqlRawAsync(operatorSql, new object[] { fieldOperatorId }, ct)
            .ConfigureAwait(false);

        return workRows + operators;
    }

    private static async Task<int> AnonymizeCostEntriesAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.cost_entries
   SET created_by_user_id = {0},
       description = ''
 WHERE created_by_user_id = {1}
   AND created_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeCorrectionEventsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.correction_events
   SET user_id = {0}
 WHERE user_id = {1}
   AND user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeFinanceCorrectionsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.finance_corrections
   SET corrected_by_user_id = {0},
       reason = '[redacted by erasure]'
 WHERE corrected_by_user_id = {1}
   AND corrected_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeFarmOperationsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        // D-T1-ERASURE: farm_operations is the operational ledger (daily_logs-class),
        // not training corpus — ANONYMIZE (scrub the actor) rather than DELETE. The
        // farm_id + operation_type + operation_date + derived_event_key are KEEP
        // (de-identified facts; DPDP §12 permits retention of de-identified
        // operational records), and deleting would destroy farm history co-owned by
        // other operators on the same farm.
        const string sql = @"
UPDATE ssf.farm_operations
   SET created_by_user_id = {0}
 WHERE created_by_user_id = {1}
   AND created_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Founder ruling 2026-08-27 (spec: 2026-08-25-prod-cutover-waves) —
    /// <b>creator erasure over the labour correction ledger.</b> Scrubs
    /// <c>corrected_by_user_id</c> to the <c>ErasedFarmer</c> sentinel and NULLs
    /// <c>reason</c>, the reviewer's own free text.
    /// <para>
    /// <b>KEEPs the correction itself.</b> <c>farm_id</c>,
    /// <c>labour_assignment_id</c>, <c>changed_field</c> and
    /// <c>corrected_at_utc</c> survive, so the farm keeps the fact that a
    /// correction happened, to which field, on which engagement and when. That
    /// history is co-owned by every other reviewer on the farm; one member's
    /// erasure must not delete it (same reasoning as
    /// <see cref="AnonymizeFarmOperationsAsync"/>, D-T1-ERASURE).
    /// </para>
    /// <para>
    /// <b>The value columns are nulled ONLY for an unrecognised
    /// <c>changed_field</c>.</b> Today that is zero rows: every write site formats
    /// the value structurally (a number, a <c>"8|Assumed"</c> duration, or a
    /// <c>FieldOperatorId</c> GUID), so <c>original_value</c> /
    /// <c>new_value</c> cannot carry a worker's NAME — and nulling the
    /// attribution pointer would erase the WORKER's work history under the
    /// FARMER's erasure, which this file forbids (creator is not the data
    /// subject). The CASE keeps the guard live anyway, so a future correctable
    /// field that does carry free text is scrubbed BY DEFAULT rather than
    /// silently let through. Full reasoning in the manifest comment at the top
    /// of this file.
    /// </para>
    /// <para>
    /// Idempotent: the <c>&lt;&gt; sentinel</c> guard makes a second call a no-op
    /// returning 0, matching every other anonymizer here.
    /// </para>
    /// </summary>
    private static async Task<int> AnonymizeLabourCorrectionsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        // Read off the DOMAIN constants rather than retyped here, so a rename in
        // LabourCorrection breaks the build instead of silently widening the
        // scrub to every row. These are compile-time string literals — there is
        // no caller input anywhere in this concatenation.
        var closedSet = string.Join(", ", new[]
        {
            LabourCorrection.FieldWorkerCount,
            LabourCorrection.FieldMaleCount,
            LabourCorrection.FieldFemaleCount,
            LabourCorrection.FieldDurationHours,
            LabourCorrection.FieldAttribution,
        }.Select(f => $"'{f}'"));

        var sql = $@"
UPDATE ssf.labour_corrections
   SET corrected_by_user_id = {{0}},
       reason = NULL,
       original_value = CASE WHEN changed_field IN ({closedSet}) THEN original_value ELSE NULL END,
       new_value      = CASE WHEN changed_field IN ({closedSet}) THEN new_value      ELSE NULL END
 WHERE corrected_by_user_id = {{1}}
   AND corrected_by_user_id <> {{0}};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    // ── Per-row audit emission ───────────────────────────────────────
    // DS-017 rule (d): one AuditEvent per anonymized row. We do not
    // know the per-row Guids after a SET-based UPDATE without a RETURNING
    // clause, so we emit one synthetic AuditEvent per table carrying the
    // count + the scrubbed-columns list. The integration test asserts
    // that AT LEAST one ErasureAnonymize/Applied audit row exists per
    // table that had anonymized rows.
    //
    // (A fully per-row variant would require a CTE with RETURNING into
    // a temp table; deferred to a follow-up audit-volume optimisation
    // — Phase 12+ once we measure the row counts in production.)
    private static Task EmitPerRowAuditEventsAsync(
        ShramSafalDbContext db,
        ErasureRequest request,
        IReadOnlyDictionary<string, int> perTableCounts,
        Guid sentinel,
        CancellationToken ct)
    {
        var sentinelString = sentinel.ToString();
        foreach (var (table, count) in perTableCounts)
        {
            if (count <= 0) continue;
            var payload = new
            {
                requestId = request.Id,
                table,
                rowsAnonymized = count,
                scrubbedColumns = ScrubbedColumnsFor(table),
                sentinelActorUserId = sentinelString,
            };
            var ev = AuditEventFactory.Create(
                entityType: "ErasureAnonymize",
                entityId: Guid.NewGuid(),
                action: "Applied",
                actorUserId: sentinel,
                actorRole: "system_erasure_worker",
                payload: payload,
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null);
            db.AuditEvents.Add(ev);
        }
        // SaveChanges happens in the outer ProcessOneAsync alongside
        // request.MarkCompleted — single transaction.
        return Task.CompletedTask;
    }

    private static string[] ScrubbedColumnsFor(string table) => table switch
    {
        "daily_logs" => new[] { "operator_user_id" },
        "log_tasks" => new[] { "notes", "deviation_note" },
        "cost_entries" => new[] { "created_by_user_id", "description" },
        "correction_events" => new[] { "user_id" },
        "finance_corrections" => new[] { "corrected_by_user_id", "reason" },
        "farm_operations" => new[] { "created_by_user_id" },
        // Founder ruling 2026-08-27 (spec: 2026-08-25-prod-cutover-waves).
        // original_value / new_value carry their CONDITION rather than being
        // listed bare: they are nulled only on a row whose changed_field falls
        // outside LabourCorrection's closed set, which is zero rows today. A
        // bare listing would claim, on every real row, a scrub that did not
        // happen — the exact over-claim this ledger exists to prevent.
        "labour_corrections" => new[]
        {
            "corrected_by_user_id",
            "reason",
            "original_value:only_when_changed_field_is_unrecognised",
            "new_value:only_when_changed_field_is_unrecognised",
        },
        // 2026-07-19 additions (founder Decision 5) — see the ssf.workers /
        // ssf.labour_assignments manifest comments above.
        "workers" => new[] { "name_raw", "name_normalized" },
        "labour_assignments" => new[] { "worker_names_json" },
        // plr-d10 lane CMP-D3 - his WORDS on the reasons he kept ("का केलं"); the kind, the item, the record and his opaque id stay.
        "log_practice_reasons" => new[] { "words", "said_by_voice" },
        // Labour V1 Task 10.5b — WORKER-subject erasure only
        // (AnonymizeFieldOperatorAsync), never creator/account erasure. These
        // tables are absent from the ProcessOneAsync sequence by design; the
        // entries exist so an explicit worker-erasure audit row names the
        // columns it scrubbed instead of emitting an empty array.
        "field_operators" => new[] { "display_name", "display_name_normalized", "full_name" },
        "field_operator_work_rows" => new[] { "display_name_at_attach" },
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 — voice-spine tables
        // follow a DELETE manifest. The audit payload records "deleted"
        // as the scrubbed-columns sentinel so the audit row's shape
        // (which uses ScrubbedColumns to describe the action) is
        // unambiguous: the whole row was removed, not field-scrubbed.
        "ai_jobs" => new[] { "deleted" },
        "transcript_history" => new[] { "deleted" },
        "golden_set_candidate" => new[] { "deleted" },
        // Founder ruling 2026-08-27 — the (sha256 -> subject) ownership link is
        // DELETEd outright, so it takes the same "deleted" sentinel. The audit
        // payload deliberately carries no sha256 list; see the manifest comment.
        "raw_blob_subjects" => new[] { "deleted" },
        _ => Array.Empty<string>(),
    };

    /// <summary>
    /// Cap for text going into a durable record. Matches the 1000-char limit
    /// <see cref="MarkFailedSafelyAsync"/> already applies to
    /// <c>ErasureRequest.FailureReason</c>.
    ///
    /// <para>
    /// An exception message is unbounded and, from Npgsql, can embed row or
    /// parameter detail. This value lands in a jsonb payload on the erasure
    /// path that is designed to outlive the data it describes, so it gets the
    /// same cap its sibling field has always had.
    /// </para>
    /// </summary>
    private static string Truncate(string value) =>
        value.Length <= 1000 ? value : value[..1000];

    /// <summary>
    /// Last-ditch honest record when the main audit write fails. Fresh context,
    /// fresh connection, smallest possible write: the status transition plus one
    /// compact audit row. Best-effort by definition — if this fails too there is
    /// nothing further to try, and the caller's rethrow surfaces the original
    /// error.
    ///
    /// <para>
    /// Note what it does NOT do: re-emit the per-row audit events. Those are the
    /// bulk of the failed write. Dropping them is what makes this attempt more
    /// likely to succeed than the one that just failed, and the aggregate row
    /// still records the counts.
    /// </para>
    /// </summary>
    private async Task TryWriteMinimalOutcomeRecordAsync(
        IServiceProvider sp,
        Guid requestId,
        Guid targetUserId,
        int totalAnonymized,
        string retainedVoiceOutcome,
        string? retainedVoiceResidue,
        Exception saveFailure)
    {
        try
        {
            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(ErasureWorker)}.minimalRecord.{requestId:N}",
                actorUserId: SystemActor.ErasedFarmer,
                ct: CancellationToken.None).ConfigureAwait(false);

            var req = await admin.ErasureRequests
                .FirstOrDefaultAsync(r => r.Id == requestId, CancellationToken.None)
                .ConfigureAwait(false);

            if (req is null || req.Status != ErasureStatus.InProgress)
            {
                return;
            }

            if (retainedVoiceResidue is null)
            {
                req.MarkCompleted(totalAnonymized, DateTime.UtcNow);
            }
            else
            {
                req.MarkCompletedWithResidue(totalAnonymized, DateTime.UtcNow);
            }

            admin.AuditEvents.Add(AuditEventFactory.Create(
                entityType: "ErasureRequest",
                entityId: requestId,
                action: retainedVoiceResidue is null ? "Completed" : "CompletedWithResidue",
                actorUserId: SystemActor.ErasedFarmer,
                actorRole: "system_erasure_worker",
                payload: new
                {
                    requestId,

                    // Present for the same reason the full payload carries it:
                    // a DPDP handler arrives holding a SUBJECT, not a request
                    // id. Omitting it made this record unfindable by the only
                    // handle they have.
                    targetUserId,
                    rowsAnonymizedCount = totalAnonymized,
                    retainedVoiceDeleted = retainedVoiceResidue is null,
                    retainedVoiceOutcome,
                    retainedVoiceResidue,
                    countsAreFromThisRunOnly = true,

                    // Says why this record is thinner than the normal one, so a
                    // handler does not read the absence of per-row events as
                    // "those tables were not touched".
                    degradedRecord = true,
                    degradedReason = Truncate(
                        "Primary audit write failed; per-row audit events were dropped to land the "
                        + $"outcome. Original error: {saveFailure.GetType().Name}: {saveFailure.Message}"),
                },
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null));

            await admin.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);

            logger.LogError(saveFailure,
                "ErasureWorker: primary audit write failed for request {RequestId}; wrote a DEGRADED "
                + "outcome record instead (status + aggregate audit row, no per-row events).",
                requestId);
        }
        catch (Exception ex)
        {
            // Be precise about WHICH audit row is missing. Querying
            // ssf.audit_events for entity_type='ErasureRequest' AND
            // entity_id=<requestId> DOES return a row on this path: exactly one,
            // the 'Requested' event RequestErasureHandler committed at
            // submission. What does not exist is the OUTCOME event — the per-row
            // events died with the primary transaction and this fallback wrote
            // nothing. Saying "no audit event" would send a handler away from a
            // row that is there.
            //
            // (The admin factory's 'admin_cross_tenant'/'open' rows are NOT part
            // of that result set and are not evidence here: they carry
            // entityType 'admin_cross_tenant' and a freshly minted entityId, so
            // they match neither half of the query.)
            logger.LogError(ex,
                "ErasureWorker: fallback outcome record ALSO failed for request {RequestId} "
                + "(subject {TargetUserId}). The scrub COMPLETED and is committed, but the row will "
                + "be stamped Failed and NO OUTCOME audit event exists for it — the "
                + "'ErasureRequest'/'Requested' row from submission is still there, so do not read "
                + "the presence of audit rows as proof the run was recorded. What survives: the "
                + "ssf.erasure_requests row (status Failed, failure_reason), and the scrub itself, "
                + "evidenced by rows carrying the ErasedFarmer sentinel for this subject. Treat the "
                + "Failed status as unreliable for this request.",
                requestId, targetUserId);
        }
    }

    private async Task MarkFailedSafelyAsync(
        IServiceProvider sp, Guid requestId, string reason, CancellationToken ct)
    {
        try
        {
            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(ErasureWorker)}.markFailed.{requestId:N}",
                actorUserId: SystemActor.ErasedFarmer,
                ct: ct).ConfigureAwait(false);
            var req = await admin.ErasureRequests
                .FirstOrDefaultAsync(r => r.Id == requestId, ct)
                .ConfigureAwait(false);
            // CompletedWithResidue is terminal and must be protected here for
            // the same reason Completed is: it records that nine tables were
            // irreversibly scrubbed. Letting a later error downgrade it to
            // Failed would restore the exact lie this change removes — and it
            // is reachable, because the audit write now runs after a caught
            // retained-voice failure.
            // lane F99 fix pass 1 (D-71) — and a Cancelled one: nothing was erased, and it must stay saying so.
            if (req is not null
                && req.Status != ErasureStatus.Failed
                && req.Status != ErasureStatus.Completed
                && req.Status != ErasureStatus.CompletedWithResidue
                && req.Status != ErasureStatus.Cancelled)
            {
                req.MarkFailed(reason.Length > 1000 ? reason[..1000] : reason, DateTime.UtcNow);
                await admin.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "ErasureWorker: secondary failure marking request {RequestId} as Failed.", requestId);
        }
    }
}
