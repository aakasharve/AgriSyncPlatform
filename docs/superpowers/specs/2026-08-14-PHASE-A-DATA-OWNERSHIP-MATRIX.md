# Phase A — Data Ownership Matrix & Violation Inventory

**Status:** COMPLETE — all 6 tracers reported. **Awaiting founder correction.**
**This is the hard gate.** Per the founder's Q8 ruling and planning directive §23, no implementation
planning happens until this matrix exists and the founder has corrected it.
**Date:** 2026-08-14 · **Branch:** `feat/server-authoritative-architecture` @ `461bfd3f`
**Method:** six independent read-only round-trip tracers, dispatched in parallel with no shared state.
Every claim carries file:line evidence. **Static analysis only — nothing here has been reproduced on
a running device.** See §8.

**Governs / governed by:**
`2026-08-14-PLANNING-DIRECTIVE-server-authoritative-trust-architecture.md` (the mandate) ·
`2026-08-14-FOUNDER-DECISIONS-server-authoritative-architecture.md` (the rulings) ·
`../../AGRISYNC-DOCTRINE.md` (the constitution)

---

## 1. The finding, in one sentence

> **The write path was built end to end and never connected end to end; the honesty layer was built
> for one surface and not the others.**

This is one defect class, not fifty defects. Every symptom below is a face of it. That matters for
sequencing: fixing them one at a time treats faces. The migration treats the class.

**The single most consequential instance:** the first sync after a log is successfully saved
**destroys fourteen fields of that log on the farmer's own device.** No new phone, no wipe, no lost
handset. The "new device" framing understated the problem — this is happening on phones today.

---

## 2. Scope — what was actually found to exist

The two prior documents reasoned about the daily log and four missing categories. The real surface:

| Surface | Count |
|---|---|
| Dexie schema version | **v22** (both prior documents assumed v15) |
| Dexie stores | **33** |
| localStorage / sessionStorage writers | **26 files, 54 write sites** |
| Independent synchronization mechanisms | **5**, plus 1 direct-fetch bypass (directive §11 requires 1) |
| Verified defects | **~50** |
| P4 fabrications in the log reconstructor alone | **20** (6 were known; 14 were not) |
| Stores that never delete anything | **6** |

---

## 3. The Data Ownership Matrix

Categories per directive §3: **A** Server Domain Truth · **B** Cloud Media · **C** Disposable Client
Cache · **D** Offline Outbox · **E** Device Preference. Plus the founder's added lifecycle:
**T** Temporary Processing Artifact. Anything that will not classify is an **architectural smell**,
marked 🚨.

### 3.1 Dexie stores

| Store | Written by | Category | Wipe = permanently lose | Smell |
|---|---|---|---|---|
| `logs` | user + pull | **A** (aspiring) / **C** (actual) | 14 fields destroyed on first pull even without a wipe — §4.1 | 🚨 |
| `outbox` | log-save txn | **dead** — 4 writers, **0 drainers** | nothing (inert), but grows forever and is written inside the save transaction as if it were the guarantee | 🚨 |
| `mutationQueue` | commands | **D** | unsent work | `APPLIED` rows never pruned |
| `syncCursors` | pull | **C** | nothing | one global cursor — no substrate for progressive hydration (§9) |
| `appMeta` | 14 writers | **mixed C + E + one A** | **GPS consent** (a DPDP fact) sits in a disposable store; the farmer's real planned tasks also live here | 🚨 |
| `analyticsOutbox` | telemetry bus | **C** | telemetry | 5th sync mechanism; raw fetch, bypasses token refresh |
| `auditEvents` | log-save | **unclassifiable** | **the entire local audit trail** — written every save, read by nothing, synced nowhere | 🚨 §17 |
| `uiPrefs` | UI | **E** | nothing | clean |
| `referenceData` | pull | **C** | nothing | clean |
| `attachments` | capture + pull | **D** before upload → **B/C** after | the photo, permanently, if not yet uploaded | 🚨 changes ownership class mid-life; **nothing ever deletes a row or its bytes** |
| `uploadQueue` | capture workers | **D** | pending rows → that photo never uploads | 🚨 `'uploading'` is an unreachable terminal wedge — §4.6 |
| `pendingAiJobs` | capture | **D + T** | the queued clip or photo bytes | 🚨 **never deletes anything, including raw media blobs** — §4.4 |
| `voiceClips` | voice capture | **C**-shaped, but the **only** copy of the farmer's spoken evidence until parse | the recording | 🚨 encryption is dead code — §4.5. *Retention sweeper genuinely works.* |
| `aiCorrectionEvents` | manual entry | **hidden sixth category** | **the entire per-bucket AI correction signal** — no server copy exists | 🚨 |
| `dayLedgers` | pull | **C**, write-only | nothing gained either — **nothing reads it** | 🚨 |
| `plannedTasks` | pull | **C** | — the farmer's real tasks are in `appMeta` and reach no server | 🚨 |
| `costEntries` | pull | **C** | unacked local events | provenance dropped on the wire |
| `financeCorrections` | pull | **C** table / permanently-rejected **D** action | **every correction the farmer ever made** | 🚨 |
| `jobCards` | REST responses | **C** | nothing — but every mutation writes a malformed row | 🚨 |
| `farms` · `plots` · `cropCycles` | pull | **C** | nothing | clean |
| `farmBoundaries` | **nothing** | **dead table** | nothing (always empty) | 🚨 |
| `plotAreas` | dead repo | **dead table** | nothing; the server has no plot geometry at all | 🚨 |
| `crops` | **user + pull** | **mixed A + C** | **every plot polygon, baseline, irrigation config, planting material, land-prep note** | 🚨 **SIXTH CATEGORY** |
| `farmerProfile` | pull only | **C + vanishing user input** | every profile edit — **on page refresh**, not merely on wipe | 🚨 |
| `workerProfiles` · `attentionCards` · `testInstances` | pull | **C** | nothing | clean |
| `testProtocols` · `testRecommendations` | **nothing** | **dead** | nothing (always empty) | 🚨 |
| `complianceSignals` | pull | **C** | nothing | acknowledge/resolve bypass the outbox; lost offline, silently |

### 3.2 localStorage — the forbidden sixth category

| Key group | Holds | Server path | Category | Sixth? |
|---|---|---|---|---|
| `harvest_config_*`, `harvest_sessions_*`, `harvest_other_income` | **every picking, sale, patti, payment state** | **NONE — the backend has no harvest type at all** | **A** (should be) | 🚨 **YES** |
| `dfes_procurement_expenses` | vendor, line items, quantities, unit prices, **full base64 receipt photos** | amounts only, as cost entries | **A + B** (should be) | 🚨 **YES** |
| `finance_settings` | high-amount threshold, duplicate window, GST | none | A-config | 🚨 minor |
| `agrilog_vocab_db_v2` | farmer-**approved** colloquial→standard mappings | none | A (soft) | 🚨 soft |
| `shramsafal_join_attempts_v1` | membership-claim audit trail | none | A (audit) | 🚨 |
| `agrilog_logs_v1`, `agrilog_audit_v1` | pre-Dexie real logs + audit | migrated to Dexie, **source never deleted** | C (stale duplicate) | no |
| auth keys | session marker only, **no token** | n/a | **E / auth** | **no — clean** |
| `shramsafal_current_farm_id` | tenancy pointer | re-derived | E | not cleared on logout |
| `agrisync_legacy_db_owner_v1`, `agrisync_active_user_id_v1` | **the fuse for per-farmer database isolation** | none | E, load-bearing | 🚨 §4.8 |

---

## 4. Violation inventory, ranked by harm to a farmer

### 4.1 🔴 Same-device destruction on first pull *(the worst)*
The guard protecting fields the server does not know about protects **four**: labour, financial
summary, context, patches. The record write is a **full-record replace**. So the first pull after a
successful sync overwrites: `machinery`, `activityExpenses`, `plannedTasks`, `disturbance`,
`fullTranscript`, `manualTotalCost`, `understanding`, `weatherStamp`, `phaseAtLogTime`,
`dayNumberAtLogTime`, `deletion`, `meta.provenance`, `meta.appVersion`, local `verification`.
The file's own comment describes this exact failure for `labour` and explains the fix. It was applied
to four fields and stopped.
**This also degrades two live screens** — the closure receipt and the meter arrival both read
`understanding`, which is wiped here.

### 4.2 🔴 Offline voice capture round-trips to nothing
The offline AI worker awaits the parse call and **assigns the result to nothing**. Every call site is
a bare `await …; return;`. There is no pull reconciler for AI jobs or drafts anywhere.
So an evening voice note, drained the next morning, uploads successfully, is parsed by the server,
and the job is marked complete — **and the farmer never sees the draft.** The core offline use case
completes successfully and produces nothing.

### 4.3 🔴 Deleted logs resurrect
Deletion is written to the `outbox` table. **That table has no drainer.** The deletion never reaches
the server, and the §4.1 guard does not preserve it. The next pull un-deletes the record — on the
farmer's own phone.

### 4.4 🔴 Queued media is never deleted, and when storage fills, new captures fail
The offline AI job store marks finished jobs complete and **leaves the row and its raw audio or image
bytes in place forever.** No sweeper, no expiry, no delete call anywhere. Combined with no compression
(§4.16), every offline voice note and every offline photo accumulates permanently in the farmer's
browser storage until the origin quota is exhausted — at which point **new captures stop queueing.**
The largest silent data-loss vector on the device.
The attachment store has the same shape: no row is ever deleted, and the cached bytes survive even a
completed upload because the delete function that exists is never called on that path.

### 4.5 🔴 Voice clips are stored in plaintext; the encryption is dead code
The row type declares AES-GCM sealed fields and a sealing writer exists. **That writer has zero
production callers.** The single live writer stores the plaintext blob and never populates any sealed
field. Consequently the decrypt path returns nothing for every real row and the player silently falls
through to a "legacy pre-v18" branch on **100% of rows** — the fallback is the only path in use.
The v18 migration flags legacy rows for re-sealing and **nothing reads that flag**.
Second consequence: **consent-granted archive to the retained tier never fires either**, because it
bails on the same missing field. The entire envelope-encryption spec is inert.

### 4.6 🔴 A killed app strands captured evidence forever, with no door
Both media workers flip a row's status **before** the network call — to `uploading` and `processing`
respectively. Every recovery path filters on `pending`, `retry_wait` or `failed`. **Nothing anywhere
resets `uploading` or `processing`.** A row stuck there is unreachable by every retry surface, counts
as pending forever, and makes the honesty chip shout with no action that can quiet it.
A test **asserts** this behaviour, so it is currently protected as intended.

### 4.7 🔴 Every cost correction is silently and permanently rejected
The client sends two fields the server allow-list does not accept, so the **entire** mutation is
refused (doctrine `F5` — the handoff listed this as trap #1; it is already shipping). The refusal is
then misclassified as retryable, burns five retries, and lands in a state the conflict screen does not
display. The farmer sees the correction. The server never receives it. Nobody is told.

### 4.8 🔴 Cross-farmer exposure on a shared handset — three mechanisms
1. **localStorage has no per-farmer namespace and is not cleared on logout.** Harvest, procurement,
   finance settings, approved vocabulary and current farm id are shared by everyone who signs in.
2. **Per-farmer database isolation is fused by two localStorage keys.** If localStorage clears and
   IndexedDB does not — an ordering some privacy modes actually perform — the next farmer to sign in
   **adopts the previous farmer's entire database**.
3. **No database is ever deleted.** There is no `deleteDatabase` call anywhere in the client.

### 4.9 🔴 Harvest sales are never persisted anywhere
The function that would write a grade-wise sale, patti number, income and payment status to storage
has **zero callers**. The save handler updates React memory only. Live routed page.

### 4.10 🔴 Income is stored on the server as expenditure
Every money event is sent as a cost entry; direction is not in the payload. On a new device the
farmer's income reconstructs as money spent. Directive §4 exactly: survives technically, changes
meaning.

### 4.11 🔴 Every Review-Inbox approval is unrecoverable
The app enqueues the v2 verify command; the server answers `MUTATION_TYPE_UNIMPLEMENTED`. Only v1
works and the Review Inbox does not call it. An owner approves a log; the log returns as `DRAFT`.

### 4.12 🔴 Planned tasks never reach the server
Founder-ruled durable farm truth. Two disjoint things share the name. The save handler ends in
`// TODO: dataSource.tasks.save(task)`. The commands exist on both sides; nothing calls them.

### 4.13 🔴 Double-tap creates two cost entries
Five command types generate a **random** idempotency key per call, including add-cost-entry and
correct-cost-entry, so server dedupe never matches. Logs are safe (stable key); money is not.
Found independently by two tracers from opposite ends.

### 4.14 🟠 Twenty fabricated values on the return path
A curative fungicide returns as **preventive pesticide**; flood irrigation from a canal returns as
**drip from field**; an urgent voice observation returns as **normal manual**; a partial activity
returns as **completed**; every recovered log shows **₹0**; a tractor returns as a crop activity and
the machinery bucket is provably always empty; **`dayOutcome` is hardcoded to `WORK_RECORDED` for
every log**, so a disturbance day reads as a work day.
The file's header comment carefully forbids fabricating plot, crop and labour. The twenty constants
begin seventeen lines below it.

### 4.15 🟠 The farmer's stated total is discarded and the derived total takes its name
`manualTotalCost` — the "Total Paid" box beside Save — is never displayed back, never becomes a cost
entry, never reaches the server. The **derived** grand total is summed into a field named
**`statedSpend`** under a comment claiming nothing there is derived. `P1` broken both ways at once.

### 4.16 🟠 No compression anywhere, plus 3× write amplification per receipt
Confirmed at every layer: no canvas, no resize, no quality setting, no imaging library. The declared
camera dependency has zero imports; capture is a plain file input.
One receipt is written to S3 **three times** — an attachment copy, an AI-session copy (same bucket,
neither deduplicated) and a content-addressed raw copy (the only deduplicated one).
**No lifecycle policy exists on that bucket.** Every byte is retained and billed forever.

### 4.17 🟠 Orphan media is leaked on every failed commit and nothing reaps it
Both upload handlers write to S3 **before** saving the database row. The storage interface has
**no delete method at all** — it is two methods, save and read. No compensating transaction, no
orphan reaper, no lifecycle policy. Orphans are permanent and billed forever.

### 4.18 🟠 "Saved" claimed before the server agreed — 7 sites
The live create path shows `"Logged."` (hardcoded English on a Marathi-first surface) straight after
a local write. Finance fires the queue command as an **unwatched promise** in four places; that
command throws on validation and nothing catches it — the file documents this exact failure in its own
comments. Plus an `alert("Irrigation Schedule Saved!")` over an in-memory update, and a compliance
action whose return value is discarded.

### 4.19 🟠 Five sync mechanisms where the directive requires one
Mutation queue (15 s, **no backoff**), attachment uploads, AI jobs, analytics, and a dead log queue —
plus a raw-fetch bypass for compliance actions that have registered commands nobody calls.

**Sharpened on re-verification:** the server opens **one transaction per mutation, not per batch**.
So a `create_daily_log` can fail while its `add_log_task` siblings commit in the same push, and
**nothing reconciles the orphans.** Combined with the fact that only *successful* mutations are stored
in the dedupe ledger, a failed mutation re-executes on retry against children that already exist.
Also load-bearing for §4.26: `ssf.sync_mutations` is unpruned **and** required for deduplication, so
it cannot be truncated the way `outbox_messages` can. Any retention design must treat the two
differently.

### 4.20 🟠 The split the farmer confirms is not the split that is stored
Client and server compute per-plot allocation differently and nothing reads the server's version back.
When a plot has no acreage, the button reports success and **nothing is queued**.

### 4.21 🟠 Provenance dies at the device boundary
Per-item field provenance is never sent for any bucket. Cost-entry provenance is recorded server-side
and **not returned**. After a wipe, ₹4,500 typed, ₹4,500 inferred from voice, and ₹4,500 from a job
card are indistinguishable. Directive §6 and `P8`.

### 4.22 🟠 The farmer's own words never leave the phone
The full voice transcript is device-only. So are the crop phase, the day number, and the understanding
score. A log created offline on Monday and synced Friday returns stamped **Friday** — the server clock
replaces his.

> ## ⚠️ LIVE AWS CHECK, 2026-08-15 — read-only, corrects three claims below
>
> Account `951921970996`, ap-south-1. No mutation performed.
>
> **1. §4.16 and §4.17 "no lifecycle policy exists" — CONTRADICTED in reality.** The claim was true of
> the *repo* and false of the *account*. `shramsafal-uploads-prod` **has** a live policy,
> `shramsafal-retention`: transition to **GLACIER at 365 days**, expire at **2555 days (7 years)**.
> It exists in AWS and in no infrastructure code, which is its own problem — nothing in the repo
> would recreate or protect it.
>
> **2. NEW FINDING — the Glacier transition conflicts with a known access pattern.** The cost analysis
> explicitly called Glacier premature because it *raises* cost for the "farmer reviews last season"
> pattern. That transition is **already live in production**. A farmer opening a photo from thirteen
> months ago triggers a Glacier retrieval: slower, and billed per retrieval. This was never a
> decision anyone recorded. **Founder call needed:** keep it, lengthen it, or remove it.
>
> **3. §4.23 — CONFIRMED, and the bucket is live.** `agrisync-raw-ap-south-1` exists, and production
> **is writing to it**: 41 objects, 943,144 bytes, most recent **2026-08-13**. Encryption is
> **AES256, not the intended customer-managed key** — the silent downgrade is real. It has **no
> lifecycle policy at all**. Public access is correctly blocked on both buckets.
>
> **Severity revision:** the raw bucket is ~1 MB, so this is **not** a cost problem. It is a
> governance and encryption problem: production writes evidence to a bucket that appears in no config,
> no environment document and no infrastructure code, under weaker encryption than intended, with
> every write failure swallowed.

### 4.23 🟠 Production writes raw evidence to an undocumented bucket, unencrypted by the intended key
The production config has **no raw-blob section**, so the code default survives into production: a
bucket name that appears in no config, no environment-variable document, and no infrastructure
directory. The encryption key setting is unbound too, so the store **silently downgrades** from the
intended customer-managed key to default encryption. And the write path **swallows every exception**,
so a completely misconfigured bucket produces one log line while the farmer's raw evidence is silently
not retained.

### 4.24 🟡 No presigned upload path exists, and the one thing named "presigned" is fabricated
Zero presigner calls server-side. The export worker **string-concatenates an unsigned URL** against a
bucket that appears nowhere else, then persists it as if it were a real signed link.
Every byte in and out of S3 transits API heap — **both directions buffer the whole object**, and the
raw store buffers it twice.

### 4.25 🟡 Nobody can debug any of this in production
The phone generates a tracking id per save and **never sends it**. The server sets its own and
**never reads an inbound one**. The 1,922-line sync handler contains **no logging at all**; a batch in
which every mutation failed returns 200 and emits nothing. There is no sync-diagnostics endpoint.

### 4.26 🟡 Structural leaks and dead weight
- `ssf.outbox_messages` and `ssf.sync_mutations` are **never pruned**. The second is load-bearing for
  dedupe, so it cannot simply be truncated.
- Both client migrations deliberately leave the source copy behind; the cleanup has **zero callers**.
- Four dead stores: `farmBoundaries`, `plotAreas`, `testProtocols`, `testRecommendations`.
- Dead code still shaped to hold farmer data: a device-local backup service, an integrity checker that
  recommends restoring from it, an unreachable audit writer.

### 4.27 🟡 The farm boundary is stored and never read
The polygon reaches the server, is versioned, and old versions are archived. Nothing ever reads it
back. The client hardcodes an empty boundary. The farmer's drawn farm shape cannot be reconstructed on
**any** device, including the one that drew it.

### 4.28 🟡 Security: `ssf.farm_boundaries` has no row-level security
Every other farm table has a policy. This table was created and added to neither security migration.

---

## 5. What is already right — protect these

Naming these matters as much as naming the defects, so nobody "fixes" them.

1. **The log-save honesty layer is exemplary.** It says *मी लिहून घेतलं* rather than claiming server
   status, and the logic **refuses** to report server acknowledgement without a real one. This is the
   model the other surfaces should be raised to. Extend it; do not redesign it.
2. **The no-multiply rule works.** A labour expense with no explicitly entered total is deliberately
   not sent, because multiplying a rate by hours would invent a figure. `P4` operating correctly.
3. **Auth is clean.** No token in localStorage; access token in memory only; refresh via HttpOnly
   cookie on web and Android Keystore on native; legacy token records actively stripped.
4. **Server-side tenancy is real.** Ownership checks, membership filters and row-level security on
   farms, plots and crop cycles. One exception (§4.28).
5. **The voice-clip retention sweeper genuinely works.** A 30-day expiry, a real index, and three live
   callers. The only enforced retention policy in the client.
6. **Crash-during-sync recovery is deterministic** for logs and log tasks, and the outbox is **not**
   deleted on user switch or logout. Directive §18 satisfied on those paths.
7. **The labour round trip is structurally correct** — sent as structured data, persisted atomically in
   the durable write path, read back. It is the proof the pattern works and what the rest should look
   like.
8. **Audio is properly compressed.** Only images never got the same treatment.

---

## 6. Capability gaps — things that must be BUILT, not fixed

Not defects. Absences. They change the size of the programme.

| Capability | Status today | Needed by |
|---|---|---|
| **Optimistic concurrency / entity versioning** | **Zero.** No entity carries a version token; no endpoint checks one. Last-write-wins everywhere, by absence rather than choice. | Founder ruling Q17 |
| **Presigned upload** | **Entirely absent.** No presigner is called anywhere; the one "presigned" URL in the codebase is a fabricated string. | Founder ruling Q25 |
| **A delete path for stored media** | The storage interface has no delete method. | §4.17 orphan reaping |
| **Server-side harvest and procurement domain** | Does not exist. No such type in the backend. | §4.9, §3.2 |
| **Plot geometry server-side** | Does not exist. Plots carry no geometry. | §3.1 `crops`, `plotAreas` |
| **A reconciler for AI job results** | Does not exist. | §4.2 |
| ~~Per-entity sync cursors~~ **Bounded progressive hydration, mechanism TBD** | One global cursor only. | Directive §9. **CORRECTED by founder direction §4.1:** per-entity cursors are one candidate, not doctrine. Scoped cursors, collection cursors, query pagination, revision streams or server checkpoints are all acceptable. Choose the simplest compatible with existing infrastructure. |
| **End-to-end correlation** | Client id never sent; server id never read. | Directive §19 |
| **Retention/pruning for server queues** | None for `outbox_messages` or `sync_mutations`. | Founder ruling Q34 |
| **A "partial record" concept** | None. | Directive §15, rulings Q28/Q29 |

---

## 7. What the founder must decide

1. **Triage.** ~50 live defects, several destroying or falsifying money data today. Hotfix lane in
   parallel with the architecture programme (**recommended**), fold everything in, or something
   between. Harm order for a hotfix lane: §4.1 → §4.2 → §4.3 → §4.4 → §4.7 → §4.9 → §4.10 → §4.8.
2. **Correct this matrix.** Any store classified wrong, say so. Category is the whole basis of the
   migration.
3. **Q17 resizing.** Conflict handling is a build, not a fix. Confirm it stays in scope at that size.
4. **Q24 revisited.** You set voice audio retention at 30 days after confirmed transcription. The
   sweeper that enforces it works. But §4.5 means the clips it is sweeping are **plaintext**, and the
   consent-granted archive that would preserve some of them **never fires**. Confirm the ruling still
   holds once encryption is real.
5. ~~Is the local audit trail durable truth or working state?~~ **ANSWERED** by founder direction
   §4.2: the local table is **architectural debt**, not a server domain to reproduce. Do not upload it.
   The principle is that **committed trust-sensitive actions require a durable server-side audit
   trail** carrying who · what · when · farm · actor · previous value · new value · provenance ·
   correlation identity. Local audit may exist temporarily for diagnostics only.

> **§7 is superseded.** All five items are resolved in
> `2026-08-14-FOUNDER-DIRECTION-after-phase-A.md`. Triage order changed: **§4.8 shared-device
> exposure moves to the top as a security containment issue**, above harvest and money.
> Classification ownership also changed: the architecture team owns technical classification; the
> founder rules only where classification changes product meaning (direction §5).

---

## 8. Not verified — read this before acting

**Everything above is static analysis. Nothing has been reproduced on a running device.**

A claim that a farmer's corrections are being discarded deserves a demonstration before a fix and
before anyone believes it. Specifically unverified:

- Runtime timing of the ledger-zeroing on a delta pull (data flow verified by reading; timing not).
- Exact HTTP status returned by the malformed job-card requests.
- Whether a 600-character note is truncated or errors at the database boundary.
- Whether demo mode is reachable from the shipped UI.
- On-device residue: how many installs still hold the stale pre-Dexie copies.
- Whether the undocumented raw-blob bucket exists or is receiving writes in production (§4.23) —
  **needs a live AWS call.**
- Whether the AI JSON emits `whoWorked` as an array or a scalar; client and server read it differently.
- **"Never pruned" rests on an exhaustive source search, not a live database check.** An external cron
  or DBA script outside the repo would not have been caught. Verify against the live database before
  designing retention.
- **Four sync/outbox integration test files under `src/tests/ShramSafal.Sync.IntegrationTests/` were
  not read.** They may encode behavioural contracts that make some findings intentional. Read them
  before the containment plan touches the sync path.
- One detail carried forward for the idempotency design: `SyncEndpoints.cs:44` collapses
  `ClientCommandId ?? ClientRequestId`, and the collapsed value is what is echoed back as
  `clientRequestId`.

**Production media volume cannot be measured from the repo.** The only attachment rows that exist
anywhere in-repo are four seeded demo files, and the cost document says so itself: *"No real camera
capture exists in any database."* Satisfying the founder's "measure first" ruling on Q23 requires an
`s3 ls --summarize` on both prefixes plus a count from inside the VPC. There is no repo-side
substitute.

**Recommended first action regardless of triage choice:** reproduce §4.1 on one device. One log with
machinery and an expense, one sync, one pull. It is the highest-value fifteen minutes available.

---

## 9. Method

Six independent read-only tracers, each given the directive's §23 question set and a fixed output
schema, dispatched in parallel with no shared state. No tracer saw another's findings. Overlaps were
used as cross-checks: the money tracer and the sync tracer independently found the double-count from
opposite ends, which is why §4.13 is stated with confidence.

One tracer died on a server-side overload and was relaunched. One returned a self-correction after a
wider search, which is folded into §4.1.
