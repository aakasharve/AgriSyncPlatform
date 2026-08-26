# Storage footprint of one farmer's data — measured

**Date:** 2026-08-14
**Purpose:** feed the founder decision on moving to the "Telegram model" (server holds everything, any
device sees the whole history, nothing lost unless deliberately deleted).
**Rule followed:** `E6` — measure, never estimate from intuition. Every extrapolation shows its arithmetic
and is labelled **DERIVED**. Everything labelled **MEASURED** came out of the real database or the real repo.

---

## 0. Provenance of the measurements

| Item | Value |
|---|---|
| Database measured | `agrisync_dev_v2` on `localhost:5433` (PostgreSQL 16.12) |
| Role used | **`postgres`** (superuser), hydrated from `REQUIRES_POSTGRES_ROOT_CONN` (User scope) |
| Why not `agrisync_readonly` | Project memory records that FORCE-RLS masking returns 0 rows for everything under that role. Confirmed avoided; superuser sees all rows. |
| Why not database `agrisync` | **No database named `agrisync` exists.** `pg_database` lists only `agrisync_dev_v2` (24 MB), `agrisync_dfes` (20 MB), `ssf_erasure_workername_proof_…` (14 MB), `postgres`. The connection string itself points at `agrisync_dev_v2`, and it holds the 135 daily logs referenced in the brief. |
| Writes performed | **None.** All statements were `SELECT`. No `dotnet ef database update` was run. |
| Content | 1 farm, 4 plots, 4 crop cycles, 3 operators, 135 daily logs spanning 2026-05-12 → 2026-08-10 (90 days). |

### ⚠️ Caveat that shapes everything below: this DB is behind HEAD

Last applied migration is `20260719074300_AddUserScopedJobCardComplianceTestReadPolicies`.
At least five later migrations are **not applied**, so their tables do not exist here:

- `20260811090237_AddFieldOperatorWorkRows` → `ssf.field_operator_work_rows` **absent**
- `20260811112633_AddLabourCorrections` → `ssf.labour_corrections` **absent**
- `20260812122505_AddDailyLogPlotIdsAndScope` → `daily_logs.plot_ids` / `.scope` **absent**
- `20260813053429_AddLabourAssignmentNotes`
- `20260813081843_AddFarmMembershipLabourCapability`

Applying them was forbidden. Their row widths below are therefore **DERIVED from the migration DDL**,
using the same measured Postgres row encoding (see §1.2).

---

## 1. Method

### 1.1 Why `pg_total_relation_size / reltuples` is the wrong tool here

At 135 rows every index on `daily_logs` sits at Postgres's **16 KB minimum allocation floor** — 9 indexes
× 16 KB = 147 KB of index against 32 KB of heap. Dividing that by 135 rows would report ~1.6 KB of index
per log, which is an artefact of minimum allocation, not a real cost. It would overstate the answer by
roughly 6×.

So the model below uses two calibration constants measured on the only tables in this database large
enough to be past the allocation floor.

### 1.2 Calibration constant A — heap bytes per row (MEASURED)

`pg_column_size(row)` gives the encoded row. Actual on-disk heap adds the line pointer and page overhead:

```
audit_events:  heap 4,096,000 B / 11,975 rows  = 342.0 B/row on disk
               avg pg_column_size(row)          = 324.0 B
               ratio                            = 1.055
```

**Constant A = ×1.06** applied to every `pg_column_size` figure. (Insert-only table, so no dead-tuple
bloat inflating it. `outbox_messages`, which is UPDATEd, measures 645 B/row on disk against 428 B encoded
— a 1.5× bloat factor — so 1.06 is the *conservative* floor, not the ceiling.)

### 1.3 Calibration constant B — index bytes per row per index (MEASURED)

Two independent tables, both past the allocation floor, converge:

```
audit_events           2,621,440 B index / 11,975 rows / 7 indexes = 31.3 B per row per index
analytics.events_p_2026_08 303,104 B index /  1,956 rows / 5 indexes = 31.0 B per row per index
```

**Constant B = 31 B per row, per index.**

The per-index spread behind that mean is itself measured and worth recording, because it explains why
some tables are far worse than others:

| Index shape | B/row | Example |
|---|---:|---|
| `(varchar, uuid)` composite | **80.0** | `ix_audit_events_entity_type_entity_id` |
| `(varchar, timestamptz DESC)` | 79.6 | `events_p_2026_08_event_type_occurred_at_utc_idx` |
| `(uuid, timestamptz)` unique PK | 58.6 | `events_p_2026_08_pkey` |
| `uuid` unique PK | **48.6** | `audit_events_pkey` |
| `(uuid, timestamptz)` | 32.8 | `ix_audit_events_farm_id_occurred_at_utc` |
| `timestamptz` alone | 23.9 | `ix_audit_events_occurred_at_utc` |
| low-cardinality `varchar` | 11.6 | `ix_audit_events_app_version` |
| low-cardinality `uuid` | 10.9 | `ix_audit_events_actor_user_id` |
| partial `WHERE … IS NOT NULL` | 4.2–8.4 | `events_p_2026_08_farm_id_…_idx` |

PG16 btree deduplication is what makes the low-cardinality entries cheap. The unique PK never benefits
from it — **48.6 B/row is the irreducible floor every table pays**, on top of its data.

### 1.4 Row widths of tables that exist but hold zero rows (MEASURED encoding)

`labour_assignments`, `machinery_usages`, `weather_stamps`, `observation_events`, `farm_operations`,
`irrigation_entries`, `application_input_items`, `disturbance_events` and `event_links` all **exist with
full column definitions but contain 0 rows**. Their widths were measured by casting a realistic row
literal to the table's composite type — a pure `SELECT`, no insert:

```sql
select pg_column_size(row(…)::ssf.labour_assignments);
```

Validated against the untyped form: `…::ssf.labour_assignments` and the bare `row(…)` both returned
**271** bytes for the identical value set, so the technique is exact and also usable for the two tables
whose migrations are unapplied.

Values used were realistic, including Marathi text where the column holds farmer-entered text.

**Devanagari byte cost (MEASURED):** a 64-code-point Marathi string occupies 178 bytes → **2.78 B/char**.
Real transcripts in the golden set measure **2.5–2.74 B/char** because they are code-mixed (ASCII digits,
Latin loanwords such as `line pressure`, `pipe check`, `sulphur`). **Use 2.6 B/char, not 3.0.**

---

## 2. What is in the database today — raw measurements

### 2.1 Every table that grows per-farmer-per-day

Exact `count(*)`, not `reltuples`.

| Table | Rows | Heap B | Index B | Total B | Rows per daily log |
|---|---:|---:|---:|---:|---:|
| `ssf.audit_events` | **11,975** | 4,096,000 | 2,621,440 | **6,758,400** | 0 (see §2.2) |
| `analytics.events` (all partitions) | 1,976 | 835,584 | 303,104 | 1,179,648 | 0 (see §2.4) |
| `ssf.outbox_messages` | **1,169** | 753,664 | 204,800 | **999,424** | 2.79 |
| `ssf.log_tasks` | 307 | 81,920 | 73,728 | 196,608 | **2.27** |
| `ssf.verification_events` | 182 | 24,576 | 32,768 | 90,112 | **1.35** |
| `ssf.daily_logs` | **135** | 32,768 | 147,456 | 221,184 | 1.00 |
| `ssf.cost_entries` | 59 | 40,960 | 196,608 | 278,528 | **0.44** |
| `ssf.planned_activities` | 30 | 8,192 | 49,152 | 98,304 | n/a (scheduler) |
| `ssf.day_ledger_allocations` | 20 | 8,192 | 65,536 | 73,728 | 0.15 |
| `ssf.day_ledgers` | 5 | 8,192 | 65,536 | 73,728 | 0.04 |
| `ssf.attachments` | **4** | 8,192 | 65,536 | 81,920 | **0.03** |
| `ssf.labour_assignments` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.machinery_usages` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.weather_stamps` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.observation_events` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.farm_operations` | **0** | 0 | 32,768 | 40,960 | — |
| `ssf.irrigation_entries` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.application_input_items` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.disturbance_events` | **0** | 0 | 16,384 | 24,576 | — |
| `ssf.transcripts` / `transcript_history` | **0** | 0 | — | 32,768 / 40,960 | — |
| `ssf.raw_blob_index` | **0** | 0 | — | 24,576 | — |
| `ssf.voice_clips_retained` | **0** | 0 | — | 24,576 | — |
| `ssf.ai_jobs` | **0** | 0 | 98,304 | 106,496 | — |
| `ssf.field_operator_work_rows` | **table does not exist** | — | — | — | — |
| `ssf.labour_corrections` | **table does not exist** | — | — | — | — |

**Whole database: 24 MB for 1 farm / 135 logs.** Of which `audit_events` alone is 6.76 MB (28%).

### 2.2 `audit_events` is not what it looks like

11,975 rows against 135 logs reads like ~89 audit rows per log. It is not.

| `entity_type` | `action` | Rows | avg row B |
|---|---|---:|---:|
| `admin_cross_tenant` | `open` | **11,934** | 324 |
| `RetentionSweep` | `Executed` | 30 | 350 |
| `ComplianceSignal` | `compliance.refreshed` / `.opened` | 11 | 451 |

**99.7% of the audit table is admin-dashboard cross-tenant-read telemetry.** There is not one single
`entity_type = 'DailyLog'` row. The seeder writes rows straight into the tables and never goes through
the use-case handlers, so no farmer-facing audit was generated.

That means the per-log audit cost is **not measurable from this database** and had to be derived from the
code paths instead (§3.2).

### 2.3 `outbox_messages` — the forever-growth proof, measured

| Event type | Rows | avg row B | avg payload B | Processed |
|---|---:|---:|---:|---:|
| `LogVerifiedEvent` | 546 | 396 | 214 | 546 |
| `DailyLogCreatedEvent` | 405 | 500 | 317 | 405 |
| `CostEntryCreatedEvent` | 177 | 367 | 180 | 177 |
| `MembershipChangedEvent` | 13 | 364 | 188 | 13 |
| `UserRegisteredEvent` | 13 | 376 | 203 | 13 |
| others (6 types) | 15 | 436–572 | 247–376 | 15 |
| **total** | **1,169** | **428** | — | **1,169 (100%)** |

The duplication factor is exact:

```sql
select count(*), count(distinct (Payload::json->>'dailyLogId')) from ssf.outbox_messages
where Type like '%DailyLogCreatedEvent%';
--  405  |  135     →  dup_factor = 3.00
-- and all 135 log ids are still live in daily_logs (0 orphaned)
```

**The seeder ran three times. The 135 logs were upserted onto the same deterministic UUIDs — but the
outbox accumulated three full copies of every event and deleted none of them.** 1,169 rows, 1,169
processed, 0 unprocessed, spanning 2026-07-19 → 2026-08-10.

`OutboxDispatcher.cs:127` selects `ProcessedOnUtc == null`, sets the timestamp, and stops. `git grep` finds
**no `RemoveRange`, no `ExecuteDelete`, no prune job anywhere in `src/` outside tests**. Outbox rows are
immortal.

Single-run per-log rate: `(405 + 546 + 177) / 3 / 135 = 2.79 outbox rows per daily log`.

### 2.4 `analytics.events`

1,976 rows, all of them `api.error` (1,942) and `admin.scope.unauthorized` (34), spanning four days
(2026-08-08 → 2026-08-12) — **≈485 error rows per day** from a single-farm dev box, with `farm_id` null on
every row. This is error telemetry, not farmer data. Partitioned monthly with partitions pre-created
through `2026_11`; **no partition-drop or detach job was found.**

### 2.5 `daily_logs` is a thin provenance row, not a content row

24 columns, all identifiers, timestamps, GPS and AI provenance (`source`, `model_version`,
`prompt_version`, `prompt_content_hash`, `app_version`, `source_ai_job_id`, `evidence_sources`,
`extractor_code_sha`). **There is no notes column, no transcript column, no money column.**

- avg row: **199 B** (min 196, max 204 — near-constant, because there is no free text in it)
- **9 indexes** on a 199-byte row

`cost_entries` is worse: a 202-byte row carrying **12 indexes**. At scale its indexes cost 372 B/row
against 214 B of data — **1.7× more index than data.**

### 2.6 Text that is actually stored (MEASURED)

The only farmer free-text reaching the server today is `log_tasks.notes`:

- avg **139 B / 54 chars**, max **227 B / 89 chars**, 307/307 non-null
- Real content, all Marathi: `मेन विहीर वरून CRI 5 HP मोटर ने सिंचन केले. दाब आणि ओल दोन्ही समाधानकारक होते.`

---

## 3. Bytes per daily log — today

### 3.1 What the seed actually proves (MEASURED)

heap = `pg_column_size` × 1.06 (constant A); index = 31 × index count (constant B).

| Table | Rows/log | Row B | Heap B | #idx | Index B | **B per log** |
|---|---:|---:|---:|---:|---:|---:|
| `daily_logs` | 1.00 | 199 | 211 | 9 | 279 | **490** |
| `log_tasks` | 2.27 | 230 | 244 | 2 | 62 | **695** |
| `cost_entries` | 0.44 | 202 | 214 | 12 | 372 | **258** |
| `verification_events` | 1.35 | 97 | 103 | 2 | 62 | **223** |
| `outbox_messages` | 2.79 | 428 | 454 | 4 | 124 | **1,613** |
| `attachments` (DB row only) | 0.03 | 224 | 237 | 4 | 124 | **11** |
| | | | | | | **3,290 B** |

### 3.2 What production adds that the seed never exercised (DERIVED)

The seeder bypasses the use-case handlers. In production these paths fire. Row widths are measured
(§1.4); cardinalities are derived from the handler code.

**Audit rows per log.** `git grep` confirms `AddAuditEventAsync` in `CreateDailyLogHandler.cs:450`,
`AddLogTaskHandler.cs:162`, `VerifyLogHandler.cs:96`, `AddCostEntryHandler.cs`. `log_tasks` are created
one-per-mutation via `PushSyncBatchHandler.HandleAddLogTaskAsync`, so:

```
1 (DailyLog Created) + 2.27 (AddLogTask) + 1.35 (VerifyLog) + 0.44 (AddCostEntry) = 5.06 audit rows/log
5.06 × (324 × 1.06  +  7 × 31)  =  5.06 × (343 + 217)  =  5.06 × 560  =  2,834 B
```

| Table | Rows/log | Row B (measured) | Heap B | #idx | Index B | **B per log** | Basis for cardinality |
|---|---:|---:|---:|---:|---:|---:|---|
| `audit_events` | 5.06 | 324 | 343 | 7 | 217 | **2,834** | 4 handler call sites, above |
| `labour_assignments` | 1.0 | 271 | 287 | 2 | 62 | **349** | `labour[]` is in the push DTO; `CreateDailyLogHandler:440` |
| `weather_stamps` | 1.0 | 184 | 195 | 2 | 62 | **257** | `CreateDailyLogHandler:637` when `weatherStamp` supplied |
| `observation_events` | 1.0 | 528 | 560 | 2 | 62 | **622** | `LedgerDerivationService:297` |
| `farm_operations` | 1.0 | 264 | 280 | 4 | 124 | **404** | `LedgerDerivationService:75` |
| `application_input_items` | 0.8 | 168 | 178 | 2 | 62 | **192** | `LedgerDerivationService:75` |
| `irrigation_entries` | 0.5 | 120 | 127 | 2 | 62 | **95** | `LedgerDerivationService:195` |
| `labour_corrections` | 0.1 | 176 | 187 | 3 | 93 | **28** | append-only, correction rate assumed 10% |
| | | | | | | **4,781 B** | |

> `observation_events` at **528 B** is the widest per-log child row measured — it stores `text_raw` **and**
> `text_cleaned`, i.e. the Marathi observation twice.

### 3.3 ✅ BYTES PER DAILY LOG TODAY, ALL-IN

```
  3,290 B   measured in the seeded DB
+ 4,781 B   derived from production code paths the seed skips
─────────
  8,071 B   ≈ 8.1 KB per daily log
```

**Where it goes:**

| Component | B/log | Share |
|---|---:|---:|
| `audit_events` | 2,834 | **35%** |
| `outbox_messages` | 1,613 | **20%** |
| Actual farm content (log + tasks + labour + costs + weather + observations + operations + irrigation + inputs) | 3,401 | 42% |
| Verification / attachments rows | 234 | 3% |

**55% of every log is bookkeeping — audit trail plus an outbox that is never emptied.** The farmer's
actual data is a minority of its own storage cost.

---

## 4. What is NOT stored server-side — the delta this project would add

### 4.1 The wire contract, verbatim

`sync-contract/schemas/payloads/create_daily_log.zod.ts:92-124` is the **complete** push payload:

```ts
export const CreateDailyLogPayload = z.object({
    dailyLogId, farmId, scope?, plotIds?, plotId?, cropCycleId?,
    operatorUserId?, logDate, location?, weatherStamp?, sourceAiJobId?,
    labour?,
});
```

Twelve keys. No `machinery`, no `activityExpenses`, no `plannedTasks`, no `financialSummary`, no
`fullTranscript`.

The pull path confirms it from the other side — `logsReconciler.ts:536-540` hard-codes
`machinery: []`, `activityExpenses: []`, `plannedTasks: []`, and `:571-576` writes
`financialSummary` as all zeros, with the code's own comment at `:135-139`: *"the DTO carries none of the
five totals."*

### 4.2 The four categories, sized

Client shapes are in `src/clients/mobile-web/src/domain/types/log.types.ts`.

| # | Category | Client type | Fields | Cardinality/log | Server today |
|---|---|---|---:|---|---|
| 1 | Machinery | `MachineryEvent` `:239-267` | 19 (+6 nested `BucketIssue`) | **0.2** avg, 1 p95 | Flattened into a `log_tasks` string `"Machinery tractor"` + `"Hours: 2 • Fuel: ₹300"`. `ssf.machinery_usages` exists but is fed **only** from the AI job blob, never from the phone. |
| 2 | Activity expenses | `ActivityExpenseEvent` `:282-301` + `ExpenseItem` `:273-280` | 14 (+6/item) | **0.3** lines, 0.3 items | Only `amount` survives, as an `add_cost_entry` row. Dropped entirely if `totalAmount` is falsy. |
| 3 | Planned tasks | `PlannedTask` `:367-401` | 18 | **1.0** avg, 3 p95 | **Nothing.** No table, no mutation. |
| 4 | Financial summary | inline on `DailyLog` `:659-665` | 5 numbers, non-optional | **exactly 1, always** | **Nothing.** Pull writes zeros. |

Cardinality basis (from code, not intuition): machinery hydration is `Record<string, MachineryEvent>`
keyed by activity and AI takes only `machinery[0]` (`useManualEntryHydration.ts:280`); the demo generator
emits one only on spray days; 1 of 20 golden transcripts mentions machinery. Planned tasks reach 3 from a
single utterance in the real Marathi corpus (`marathiPrompts.ts:310-314`).

**Added bytes (DERIVED; widths measured per §1.4):**

| Item | Rows/log | Row B | Heap B | #idx | Index B | **B per log** |
|---|---:|---:|---:|---:|---:|---:|
| `machinery_usages` (manual logs, currently unfed) | 0.2 | 184 | 195 | 2 | 62 | **51** |
| `activity_expenses` (new table) | 0.3 | 184 | 195 | 3 | 93 | **86** |
| `activity_expense_items` (new table) | 0.3 | 168 | 178 | 2 | 62 | **72** |
| `planned_tasks` (new table) | 1.0 | 208 | 220 | 3 | 93 | **313** |
| `financial_summary` → 5 numeric columns on `daily_logs` | 1.0 | +45 | +48 | 0 | 0 | **48** |
| `full_transcript` → text column on `daily_logs` | 1.0 | +118 | +125 | 0 | 0 | **125** |
| | | | | | | **695 B** |

### 4.3 ✅ BYTES PER DAILY LOG AFTER

```
  8,071 B   today, all-in
+   695 B   the four missing categories + fullTranscript
─────────
  8,766 B   ≈ 8.8 KB per daily log      →  +8.6%
```

**The four missing categories cost about 9%. They are not the storage problem.**

### 4.4 `fullTranscript` — measured, and much smaller than feared

The brief flagged free text as a potential dominator. It is not. Measured across the **20-file golden set**
(`src/tests/ai-eval/scenarios/inputs/*.yaml`, field `input.transcript`, all real Marathi):

| Statistic | Chars (code points) | UTF-8 bytes |
|---|---:|---:|
| mean | 45.5 | **118** |
| median | 35 | ~95 |
| max (`vlog-2025-10-19-defoliation.yaml`) | 169 | **421** |
| min | 12 | 30 |
| overall ratio | — | **2.60 B/char** |

Longest real transcript in the corpus, verbatim:
> `इथरेल आणि 00:52:34 आणि फॉस्फोरिक ॲसिड मिसळून बलोवेर ने फवारणी केली. बलोवेर च्या 10 गन चालू होत्या आणि फॅन बंद होता. एक हजार लिटर पाणी वापरलं. पाचशे रुपयांचं डिझेल लागलं.`

A whole day's spoken log is **421 bytes at its longest** — smaller than a single `outbox_messages` row.
Farmers speak in short bursts. Only one partition of a multi-plot fan-out carries it
(`log-partition-builders.ts:266`), so it is not multiplied per plot.

**Is it stored today?** Not on the log. It reaches `ssf.ai_jobs.normalized_result_json` and
`ai_jobs.transcript_codemix` — **AI-parsed logs only**. Manual and wizard logs' transcripts reach the
server nowhere.

**But `ai_jobs` carries six transcript variants** (`AiJob.cs:70-83`): `transcript_codemix`,
`transcript_english`, `transcript_english_redacted`, `transcript_verbatim`, `transcript_translit`,
`transcript_translate` — plus `normalized_result_json`, `input_session_metadata_json` and
`diarized_transcript_json` (speaker turns + word timings). That table has **0 rows here**, so I could not
measure it. At 6 × ~120 B of transcript plus a full normalized JSON blob, it is very likely **the largest
per-log text object in the system** — see §7.

### 4.5 The bigger client-only item the brief did not name: `patches[]`

`PatchEvent` (`src/clients/mobile-web/src/domain/ledger/PatchEvent.ts:9-31`) stores `previousState` as a
**complete reverse-delta snapshot of the entire log** — every event array included. N edits ⇒ N × whole-log
payload. It is client-only and a pull may not delete it (`logsReconciler.ts:191-205`).

A "server holds everything" migration must size this as `edits_per_log × log_size`, **not** as a scalar. At
0.5 edits per log that is roughly **+1.7 KB per log** — more than twice the entire four-category delta.

Also client-only and unbudgeted: `understanding: VlogScore` (~8 dimension rows × 6 fields),
`transcriptSnapshot` (a 3rd and 4th copy of the transcript), `LogProvenance.rawTranscript` (a 2nd copy),
`dayOutcome`, `phaseAtLogTime`, `deletion`, and `sourceText` / `systemInterpretation` on **ten** event types —
transcript fragments that collectively can exceed the transcript itself.

---

## 5. Attachments — the real cost driver

### 5.1 Is there compression? **No. Nowhere. At any layer.**

- `package.json` has **no** `browser-image-compression`, `compressorjs`, `pica`, or any image library.
- No `canvas` / `drawImage` / `toBlob` / `createImageBitmap` / `OffscreenCanvas` anywhere in
  `src/clients/mobile-web/src/**`.
- No EXIF stripping. No `maxWidth` / `maxHeight` / quality parameter in the capture path.
- `DeviceCameraService.ts` is a bare `<input type="file" accept="image/*" capture="environment">`. It reads
  the image dimensions **for metadata only** and hands the original `File` straight through.
- `CaptureAttachment.ts:145-151` writes the original blob verbatim to CacheStorage.
- **Server side:** `S3AttachmentStorageService.SaveAsync` buffers into a `MemoryStream` and `PutObject`s it
  unchanged. No ImageSharp, no System.Drawing, no Magick.NET in any `.csproj`. **No thumbnail generation
  anywhere** — `grep thumbnail` across `src/` returns nothing.

**A phone camera JPEG is stored at full original resolution, end to end.** The only guard is a 10 MB server
reject (`AttachmentEndpoints.cs:16`), and there is no client-side size check at all — an oversized photo
silently burns all 5 retries and lands as `status: 'failed'`.

Audio, by contrast, **is** compressed client-side to Opus/WebM (`SegmentCompressor.ts`,
`VoicePreprocessor.ts`). Images simply never got the same treatment.

### 5.2 What size are they? (MEASURED, but demo data)

`ssf.attachments.size_bytes` is a real `bigint`, populated from bytes actually written to S3
(`UploadAttachmentHandler.cs:55-56`), not a client claim. All 4 rows are `Finalized`:

| file | size_bytes |
|---|---:|
| `farm-overview.jpg` | 210,510 |
| `grapes-g2-growth.jpg` | 192,300 |
| `grapes-g1-pruning.jpg` | 186,420 |
| `sugarcane-s1-planting.jpg` | 178,650 |
| **average** | **191,970 B ≈ 187 KB** |

⚠️ **These are seeded demo files** (`local_path` = `/demo-photos/…`), not real camera captures. **187 KB is
not the number to plan on.** Given the total absence of compression and the 10 MB cap, a real Android
capture is **2–6 MB**; **3 MB** is used below and is labelled DERIVED.

### 5.3 One receipt is stored three times

| # | Object | Bucket / prefix | Deduped? |
|---|---|---|---|
| 1 | The attachment | `shramsafal-uploads-prod` → `attachments/{farmId}/{yyyy}/{MM}/{attachmentId}/{name}` | no |
| 2 | AI session input | `shramsafal-uploads-prod` → `ai-sessions/{sessionId}/input.jpg` (deliberately outside the `attachments/` prefix) | **no** |
| 3 | Raw evidence blob | raw-blob bucket → `raw/{sha256}` | yes (content-addressed) |

Founder decision 2026-05-15 made receipt/patti images first-class raw evidence alongside voice.
So **a receipt photo occupies ~2× its own size in non-deduped copies** (the third is content-addressed).

The receipt flow additionally base64-inflates the whole JPEG (+33%) into **`localStorage`** — a ~5 MB hard
cap — at `ReceiptCaptureSheet.tsx:195`, with the codebase's own comment: `// In real app, upload to storage
first!`. One 4 MB photo blows the browser quota. That is a client bug, not a server cost, but it is on the
same code path.

### 5.4 Lifecycle: **there is none on the attachment bucket**

| Bucket | Lifecycle policy |
|---|---|
| `shramsafal-uploads-prod` (attachments **and** ai-sessions) | **NONE. Not found anywhere in the repo.** No expiry, no IA/Glacier transition, not even `AbortIncompleteMultipartUpload`. There is no `aws/uploads/` directory. |
| `shramsafal-voice-retained-prod` | Effectively no-op — one `AbortIncompleteMultipartUploadsAfter7Days` rule. Glacier tiering explicitly deferred to "Phase 07". |
| `agrisync-snapshots-prod` | Full tiering: STANDARD → IA @30d → Glacier @60d → expire @607d. |
| raw-blob bucket | **NONE found.** |

`RetentionSweepWorker.cs` sweeps `export_artifacts` (7-day TTL), `audit_read_telemetry` (30-day TTL) and
`voice_clips_retained` (consent-gated, 5-year default). **`grep attachment` in `Jobs/` returns nothing** —
the sweeper never touches the attachment bucket.

**Attachment objects are written once and never expire, never tier, and are never deleted by anything.**

⚠️ **Flag for the founder:** `RawBlobStoreOptions.cs:15` defaults the raw-blob bucket to
`agrisync-raw-ap-south-1`, but there is **no `RawBlobStore` section in `appsettings.Production.json`** and no
`RawBlobStore__BucketName` in `PRODUCTION_ENVIRONMENT_VARIABLES.md`, while `aws/snapshot/prod-resources.md:115`
labels `shramsafal-uploads-prod` as the raw-blob bucket. Prod may be writing to an undocumented bucket
nobody is watching or costing. **Worth checking the live EC2 environment.**

---

## 6. Realistic volume per farmer

### 6.1 What the seed measures

```
135 logs / 91 distinct log_dates / 90-day span (2026-05-12 → 2026-08-10)
1 farm · 4 plots · 3 operators
→ 1.48 logs per calendar day, and a log on 91 of 91 days
```

Distribution of logs per active day: 1 log (66 days), 2 (11), 3 (9), 4 (5).

**This is a heavy logger** — every single day, across four plots, for a full season. It is the only farmer
behaviour that exists in the data, so it anchors the top of the band, not the middle.

### 6.2 The band

| Band | Behaviour | Logs/year | Basis |
|---|---|---:|---|
| **Low** | logs ~weekly, two seasons | **60** | **ASSUMED** |
| **Typical** | logs most working days in two seasons (~200 active days, ~1.1 logs/day) | **220** | **ASSUMED** |
| **Heavy** | the seeded rate sustained year-round (1.48/day × 365) | **540** | **DERIVED** from measured 135/91d |

### 6.3 ✅ MB PER FARMER PER YEAR — database text

At **8.8 KB per log** (post-migration, §4.3):

| Band | Logs/yr | Arithmetic | **MB/farmer/yr** |
|---|---:|---|---:|
| Low | 60 | 60 × 8,766 B = 525,960 B | **0.5 MB** |
| **Typical** | 220 | 220 × 8,766 B = 1,928,520 B | **1.9 MB** |
| Heavy | 540 | 540 × 8,766 B = 4,733,640 B | **4.6 MB** |

Add roughly **50 KB** of fixed per-farmer overhead (farm, plots, crop cycles, memberships, user, refresh
tokens). Negligible.

Add **+1.7 MB/yr typical** if `patches[]` (§4.5) is also brought server-side at 0.5 edits/log —
which nearly doubles the text figure, and is still nothing next to §6.4.

### 6.4 ✅ THE ATTACHMENT PICTURE

Photo rate is **not measurable** — the 4 rows in this DB are demo fixtures. Band is ASSUMED:

| Band | Photo rate | Photos/yr | × 3 MB | **MB/farmer/yr** |
|---|---|---:|---:|---:|
| Low | 1 per 20 logs | 3 | 9 MB | **9 MB** |
| **Typical** | 1 per 5 logs | 44 | 132 MB | **132 MB** |
| Heavy | 1 per log | 540 | 1,620 MB | **1.6 GB** |

**Typical farmer: 132 MB of photos against 1.9 MB of text — the photos are 69× everything else combined.**

With one client-side resize (1600 px longest edge, JPEG q0.8 ≈ 300 KB — a measured-industry-standard 10×
reduction, **ASSUMED**), the typical farmer drops from **132 MB to 13 MB per year.**

At the same 8.8 KB/log, **one 3 MB photo equals 342 daily logs** — more than a full year of heavy text
logging.

### 6.5 What that costs (pricing ASSUMED — no cost constants exist in the repo)

Using S3 Standard `ap-south-1` at **$0.025/GB-month** and RDS gp3 at **~$0.138/GB-month**:

| Scale | Year | DB text | S3 photos (no compression) | S3 photos (compressed) |
|---|---|---:|---:|---:|
| 1,000 farmers | 1 | 1.9 GB → $0.26/mo | 132 GB → **$3.30/mo** | 13 GB → $0.33/mo |
| 1,000 farmers | 3 | 5.7 GB → $0.79/mo | 396 GB → **$9.90/mo** | 39 GB → $0.99/mo |
| 10,000 farmers | 3 | 57 GB → $7.87/mo | 3.96 TB → **$99/mo** | 396 GB → $9.90/mo |

Because nothing ever expires, the S3 line is **cumulative and monotonic** — year 3 pays for years 1 and 2
forever.

---

## 7. Growth shape — what is bounded and what is not

### 7.1 Grows forever, never pruned

| # | Thing | Evidence | Per-log cost |
|---|---|---|---:|
| 1 | **S3 attachment objects** | No lifecycle policy exists for `shramsafal-uploads-prod`. `RetentionSweepWorker` never touches it. | ~600 KB/log at 1-in-5 × 3 MB |
| 2 | **`ai-sessions/` duplicates** | Same bucket, no policy, exists only to serve a ~60-second verification poll. **The single best deletion candidate in the system.** | ~600 KB/log for receipts |
| 3 | **`outbox_messages`** | 1,169 rows / 1,169 processed / 0 deleted, measured. No delete path in code. Re-seeding tripled it. | **1,613 B** |
| 4 | **`audit_events`** | Append-only by DPDP design. Retention sweep covers only `export_artifacts`, `audit_read_telemetry`, `voice_clips_retained` — **never `audit_events`**. 6.76 MB here already. | **2,834 B** |
| 5 | **`labour_corrections`** | Migration comment is explicit: *"no update path and no delete path anywhere — no Modify/Delete on the entity, no repository member, no route."* | 28 B |
| 6 | **`field_operator_work_rows`** | One row per named worker per assignment. No delete path. Cost scales with worker-naming adoption. | 0 today; **~1,140 B** at 4 named workers/log |
| 7 | **`verification_events`** | Append-only FSM history; 1.35 rows/log measured. | 223 B |
| 8 | **`analytics.events`** | Partitions pre-created to `2026_11`; **no drop/detach job found**. ~485 error rows/day on a dev box. | 0 (not per-log) |
| 9 | **`ai_jobs`** (6 transcript columns + 2 JSON blobs) | No sweep found. Likely the largest per-log text object. | **not measured** |
| 10 | **`raw/{sha256}` blobs** | `DereferenceAsync` is a hard delete, but the code comment says *"Phase 08 introduces ref-counted erasure"* — **not ref-counted yet**, so it is unsafe to call and effectively never runs. | dedup'd |

**"APPLIED sync rows are never pruned" is confirmed and is worse than stated:** it is not only that
processed rows survive — re-running the same workload multiplies them, exactly, with no ceiling.

### 7.2 Actually bounded

| Thing | Bound |
|---|---|
| `export_artifacts` | 7-day TTL (`ExportArtifactsTtlDays = 7`) |
| `audit_read_telemetry` | 30-day TTL (`AuditReadTelemetryTtlDays = 30`) |
| `voice_clips_retained` (S3) | 5-year default, or immediate on consent withdrawal — opt-in only (`FullHistoryJournal`) |
| Local device voice clips | 30 days (`PROCESSING_VOICE_CLIP_RETENTION_DAYS`) |
| `agrisync-snapshots-prod` | Expires at 607 days, with IA/Glacier tiering |
| `daily_logs`, `log_tasks`, `labour_assignments`, `cost_entries` | Bounded by farmer activity — one row per real event. These behave correctly. |

---

## 8. The three or four numbers that dominate everything else

1. **~3 MB per uncompressed photo, stored forever, in 2–3 copies.** This is the entire cost story.
   At the typical rate it is **69× the whole text footprint**. A single client-side resize in
   `CaptureAttachment.ts` cuts the platform's dominant line item by ~10×. **Nothing else on this page
   matters as much.**
2. **2,834 B of `audit_events` per log — 35% of every log.** Append-only, never swept, and 5.06 rows
   fire per log because every child mutation writes its own.
3. **1,613 B of `outbox_messages` per log — 20% of every log — for messages already delivered.**
   Pure waste, zero product value, and provably multiplying (3× on re-seed).
4. **Zero lifecycle policy on `shramsafal-uploads-prod`.** Every byte ever written is still billed,
   including the `ai-sessions/` duplicates whose useful life is about sixty seconds.

The four missing categories the founder asked about — machinery, activity expenses, planned tasks,
financial summary — total **695 B/log, +8.6%**. **The "Telegram model" migration is cheap. The photos and
the bookkeeping are what cost money.**

---

## 9. What I could not measure, and why

| # | Not measured | Why | What I did instead |
|---|---|---|---|
| 1 | `field_operator_work_rows`, `labour_corrections` real row sizes | Tables do not exist in this DB — 5 migrations unapplied since `20260719074300`. Running `dotnet ef database update` was forbidden. | Derived widths from the migration DDL using the measured row-encoding technique, validated exact against a real table (§1.4). |
| 2 | `ssf.ai_jobs` — 6 transcript columns, `normalized_result_json`, `diarized_transcript_json` | **0 rows.** Probably the single largest per-log text object in the system. | Not modelled. **This is the biggest gap in the estimate** — it could add materially to per-log text. |
| 3 | Real photo sizes | The only 4 attachment rows are seeded demo files (~187 KB) at `/demo-photos/…`. No real camera capture exists in any database. | Used 3 MB, derived from the total absence of compression code plus the 10 MB server cap. Labelled ASSUMED throughout. |
| 4 | `ai-sessions/` object sizes | Not recorded in any DB column. | Needs `aws s3 ls --recursive --summarize s3://shramsafal-uploads-prod/ai-sessions/`. |
| 5 | Retained voice-clip bytes | `voice_clips_retained` has `duration_seconds` but **no byte-size column** — and 0 rows anyway. | Not modelled. Opt-in and Opus-compressed, so likely minor. |
| 6 | Production row counts | This is a local dev DB with one farm. Prod compute is hibernated (project memory: `prod-hibernate-2026-06-16`) and prod RDS sits in a private subnet. | Used the dev seed and the code paths. |
| 7 | Real logs-per-farmer behaviour | Exactly one seeded farmer exists. | Only the **heavy** band is derived from measurement; **low** and **typical** are stated assumptions. |
| 8 | `daily_logs` index size at scale | At 135 rows all 9 indexes sit at the 16 KB minimum-allocation floor. | Calibrated 31 B/row/index against two tables past that floor (1,956 and 11,975 rows) that agree to within 1% (§1.3). |
| 9 | Live prod bucket names | The raw-blob bucket discrepancy in §5.4 cannot be settled from the repo. | Flagged for a live EC2 environment check. |

---

## 10. Summary table

| Question | Answer | Status |
|---|---|---|
| Bytes per daily log **today**, all-in | **8,071 B (~8.1 KB)** | 3,290 B MEASURED + 4,781 B DERIVED |
| Bytes per daily log **after** the four categories | **8,766 B (~8.8 KB)**, +8.6% | DERIVED, widths MEASURED |
| MB/farmer/yr — low | **0.5 MB** text + 9 MB photos | text DERIVED, rate ASSUMED |
| MB/farmer/yr — typical | **1.9 MB** text + **132 MB** photos | text DERIVED, rate ASSUMED |
| MB/farmer/yr — heavy | **4.6 MB** text + 1.6 GB photos | logs/yr DERIVED from MEASURED seed |
| Per photo | **~3 MB**, ×2–3 copies, forever | ASSUMED (no compression MEASURED in code) |
| Compression exists? | **No — none, at any layer** | MEASURED (exhaustive code search) |
| Lifecycle policy on attachments? | **None** | MEASURED (repo-wide IaC search) |
| Largest text line item | `audit_events` 2,834 B/log (35%) | DERIVED from 4 MEASURED call sites |
| Largest waste line item | `outbox_messages` 1,613 B/log (20%), never deleted | MEASURED |
