# TELEGRAM-STYLE SERVER MIGRATION — EXECUTION HANDOFF

**Branch to create:** `telegram-style-server-migration`
**Branch from:** `main`, **only after `feat/labour-management-ui` has merged.** See §9 — branching before that merge means building the same plumbing twice.
**Written:** 2026-08-14, at the close of the Labour Phase 2 session that produced every measurement below.
**Reader:** a fresh implementation team. You do not need the conversation that produced this. Everything decided, measured or learned is here.

---

## 1. The founder's instruction, verbatim

> *"Rest be done before — means if any such thing happens there should not be any kind of data loss. Everything must reside on server side. Device is just a source of contact — follow the thin client framework. Server is the main thing. If any such thing happens the server must integrate that new device, like Telegram works: no matter what device you log in, it has everything there always, unless you erase it. Don't treat it like WhatsApp which takes backup on devices. We want to utilise the cloud infra so that this loss of data should never ever be a concern for a farmer, unless and until he deliberately decides to delete it."*

**Read that as two separate promises, because they are:**
1. **Nothing is ever lost** unless the farmer deliberately deletes it.
2. **Any device, any login, everything is there.**

The first is about durability. The second is about reconstruction. They are satisfied by different code and can be delivered independently.

**Note what it does NOT say.** It does not say the phone stops holding data. Telegram itself caches on the device — that is *why* it opens instantly. The server is what makes a **new** phone work, not what makes the app fast. **Offline-first capture is not in tension with this and must not be sacrificed to it** (`P9`).

---

## 2. What is on the server today, and what is not — MEASURED

Measured against the real schema and the real client code, 2026-08-13/14. **This table is the whole problem statement.**

| What the farmer records | Reaches the server? | Comes back on a clean device? |
|---|---|---|
| The log itself (date, plots, `scope`, farm) | ✅ | ✅ |
| **Labour** — count, hours, wages, names, attribution, notes | ✅ | ✅ **built 2026-08-13** |
| Crop activities · irrigation | ✅ via `log_tasks` | ✅ |
| Observations · disturbance · transcript | ✅ via `log_tasks` | ✅ |
| **Machinery** — hours, rent, fuel | ⚠️ **MANGLED** — flattened to a free-text `log_task` (`"Machinery tractor"`, `"Hours: 4 • Rent: ₹800"`) | ❌ returns as a **`cropActivity`**, i.e. the wrong bucket, structure lost |
| **Activity expenses** | ❌ **never sent** — zero references in `logSyncMutationService.ts` | ❌ gone |
| **Planned tasks** | ❌ **never sent** | ❌ gone |
| **Financial summary** | ❌ never sent | ❌ **rebuilt as zero** |
| Weather stamp | ✅ written to `ssf.weather_stamps` | ❌ **no server reader exists at all** — written and terminates |
| Photos / receipts | ✅ S3 | ✅ but see §4 — this is where the real problems are |
| Correction history | ✅ `labour_corrections`, on-demand read | ✅ (deliberately never on the pull) |

**Also true and load-bearing:** `logsReconciler.ts` returns `machinery: []`, `activityExpenses: []`, `plannedTasks: []` and a zeroed `financialSummary` for a genuinely new log. A clean device therefore reconstructs a *partial* record today, and **nothing tells the farmer that.**

---

## 3. Cost — MEASURED, so nobody has to re-derive it

Measured from the real AWS bill (Cost Explorer, July 2026) and the live price feed, ap-south-1.

### The bottom line
**Cost is not a reason to hesitate. Build it.**

| | |
|---|---|
| Bill today (hibernated) | **₹4,951/mo · $51.84** — July 2026, measured |
| Bill the day hibernation stops | ₹5,569/mo · $58.31 |
| Bytes per daily log **today** | **~8.1 KB** all-in (parent + children + indexes + audit) |
| Bytes per daily log **after this work** | **~8.8 KB** — a **9% increase** |
| Marginal cost of one more farmer's full history | **₹2.80/year** compressed · ₹16.20 uncompressed |
| Ten years of one farmer's history | **₹154–₹890** |

### At scale
| Farmers | Monthly | Per farmer/yr |
|---|---|---|
| 100 | ₹5,661 | ₹679 |
| 1,000 | ₹9,102 | ₹109 |
| 10,000 | ₹32,300 | ₹39 |

**Those per-farmer figures are the fixed bill ÷ farmer count — an accounting artefact that improves with growth.** The genuine marginal cost is flat at ₹2.80. The real number is the **₹66,828/year fixed floor paid before a single farmer exists.**

### Three corrections to prior beliefs
1. **AWS credits ran out.** May fully covered, June half. **July is the first month actually paid.** Any cost intuition formed before July is off by ~₹4,400/mo.
2. **`aws/hibernate/README.md` is stale.** It claims ₹3,300/mo saved. Measured: **₹618/mo**, because the nap only stops compute 4.5 h/night. Turning it off at launch costs ₹618/mo — that is the entire price of never being down.
3. **Egress is free at this scale.** July moved 1.10 GB internet + 1.38 GB CloudFront and cost **₹0**. Free allowances cover ~239 full-history re-syncs/month. Egress only bites around 3,000 farmers, and only with uncompressed photos.

### What actually dominates
- **Photos are 69× everything else.** A typical farmer: ~132 MB photos vs ~1.9 MB text. One 3 MB photo = 342 daily logs.
- **Bookkeeping outweighs farm data.** Audit (2,834 B) + outbox (1,613 B) = **55% of every log's footprint.**
- **`outbox_messages` is never pruned** — 1,169 rows measured, all processed, none deleted. Re-running identical work multiplies storage with no ceiling (the seeder ran 3× and produced exactly 3.00× the events).
- **The AI bill will dwarf all of this.** Voice parsing runs server-side through Sarvam, billed **per call, not per byte**, scaling linearly with farmers with no economies of scale. **Unmeasured. Measure it before optimising storage.**

---

## 4. Photos — the urgent, separate problem

**This is NOT part of this migration. Do it first, on its own branch, before launch.** It is listed here because the measurements came from the same investigation and would otherwise be lost.

Three findings, all verified:

1. **There is no image compression anywhere.** Not in the browser, not on the server. Both upload paths (`PattiUploadSheet.tsx:107`, `ReceiptCaptureSheet.tsx:266`) are plain `<input type="file" accept="image/*">` — no canvas, no resize, no quality setting, no library. `@capacitor/camera` is installed and never called. Whatever the phone's camera produces goes to S3 untouched. *(Audio is properly compressed to Opus — images just never got the same treatment.)*
2. **Every attachment download is proxied through the .NET API**, not a presigned URL, not CloudFront (`AttachmentEndpoints.cs:192` → `Results.File(...)`). And `S3AttachmentStorageService.OpenReadAsync` **buffers the entire object into a `MemoryStream` on the API heap** before streaming. So every photo view allocates multiple MB of server memory. **This is a scaling-and-latency risk long before storage cost matters.**
3. **No lifecycle policy exists on the attachment bucket** — verified repo-wide. No expiry, no tiering, not even incomplete-upload cleanup. Every byte ever uploaded is still billed.

Also: a receipt is stored **three times** (attachment, AI-session copy, raw evidence blob); only one is deduplicated. And the raw-blob bucket name is **inconsistent between code defaults and the prod snapshot doc** — prod may be writing to a bucket nobody is costing. **Verify against the live environment.**

**Value:** ~1 day of work. Saves ₹0 today, **₹18,489/mo at 10,000 farmers**, and it is 20× cheaper before farmers upload than after. It is primarily a **reliability** fix — a 4 MB upload on rural 2G is a failed upload.

**Other cheap wins, ranked** (do not bundle into this migration): EC2 `t3.small` → Graviton `t4g.small` = **₹921/mo** (or `t4g.medium` at today's price for double the RAM); delete 2 Route 53 health checks + prune Secrets Manager = **₹405/mo, under an hour**. **Premature:** Reserved Instances, S3 IA/Glacier (saves ₹4/mo and *raises* cost for the "farmer reviews last season" access pattern), CloudFront on uploads, Multi-AZ.

---

## 5. What this migration must build

For each of the four missing categories — **machinery, activity expenses, planned tasks, financial summary** — the same four steps that were done for labour on 2026-08-13:

1. **Contract** — add the fields to the zod schema, regenerate the C# payload, **and widen the `/sync/push` allow-list** (see `F5`, §7).
2. **Storage** — server-side persistence. Some will need a migration; `financialSummary` may be derivable rather than stored — **decide deliberately, and record the decision** (`P1`: derived and stated must never impersonate each other).
3. **Read-back** — project onto `DailyLogDto` on the existing `/sync/pull`. **Do not add a second channel.**
4. **Reconstruct** — map the wire shape back to the local shape *in the right bucket*.

**Plus one repair that is not a fourth step:** machinery is currently **worse than missing** — it goes up flattened and returns in the wrong category. It must be **un-broken** before it is completed, and any farmer data already sent that way has to be handled honestly rather than silently reinterpreted.

**Weather** is a fifth item of a different kind: it is already stored and has **no reader**. Either give it one or decide it is write-only and say so — an orphaned write is a `P5` waiting to happen.

---

## 6. The one real design decision

**What happens on first login to a brand-new phone?** Everything else here is mechanical; this is the choice.

- **(a) Pull everything eagerly.** Truest to the instruction. On weak rural signal the first minute is long, and a half-failed first sync leaves a farmer staring at a partial app. Measured cost if photos are pulled eagerly at full resolution: **₹4.4 per device**.
- **(b) Recent first, older in the background.** Farmer works within seconds; last season fills in quietly.
- **(c) Recent eagerly, older on demand.** Measured: **₹0.04 per device.**

**Telegram does (c).** The recommendation carried out of the founder conversation was **(b) or (c)** — recent-first — because the first minute on a new phone is when a farmer decides whether to trust the app again. **The founder has not yet given a final answer. Get it before designing.**

---

## 7. Traps — every one of these was hit or narrowly avoided in the Labour Phase 2 session

**Take these seriously. Each cost real time or nearly shipped a defect.**

1. **`F5` — the `/sync/push` payload check is a strict allow-list.** Adding a payload field **without** adding it to the allow-list rejects the **entire** mutation, and it fails in a way that looks nothing like the field you added.
2. **There is a THIRD, hand-written copy of the payload shape** at `application/usecases/sync/CreateDailyLogCommand.ts`. The generator does not emit it and CI's diff gate does not cover it — so the zod schema, the generated C# and the allow-list can all be right while the client **silently sends the old shape**.
3. **The pull DTO must carry the assertion, or the reconciler rewrites it.** Phase 2 nearly shipped a bug where the first pull after a multi-plot log was acknowledged rewrote its context from `{A,B,C}` to "entire farm". **Read-back must precede any change to what the client sends.**
4. **`preserveLocalOnlyFields` predicate must be "the response carried this field" — NEVER "the value came back non-empty".** The second form re-opens a data loss caught in V1's final review. This is the single most repeated trap in this codebase.
5. **The three-state field pattern.** A nested field has three meanings and they are not interchangeable: `null` = *this response makes no statement*; `[]` = *the server states there is none*; non-empty = the data. Getting this wrong destroys local data on a response that never intended to speak about it.
6. **A migration `Down()` must refuse rather than fabricate.** EF's scaffolded rollback for a nullability change restored `NOT NULL` with `defaultValue: 00000000-…` — it would have written a **fabricated plot** over exactly the rows the migration existed to make honest. Two migrations in Phase 2 now deliberately `RAISE EXCEPTION` instead.
7. **`F7` — `IShramSafalRepository` uses default interface implementations deliberately.** 28 implementors; a new **abstract** member produces ~135 compile errors. **Ship a default body** — and know that every in-tree test double then silently answers the default, so a test can pass for the wrong reason.
8. **`F1`/`F2` — `dotnet ef` needs BOTH `--context ShramSafalDbContext` and `--configuration Release`.** A running dev API locks Debug output and the failure is disguised as a bare *"Build failed"*.
9. **Never `dotnet ef database update`. Never migrate `agrisync_dev_v2`. Never `make boot`** (it swallows migration failure). Scratch `ssf_<purpose>_{Guid:N}` databases only.
10. **The L5b UI gate SHA-pins to HEAD** — *any* commit invalidates it, including docs-only commits. Batch all `.tsx` writes before the first `.tsx` commit. **Never** set `UIUX_GATE_BYPASS` or hand-mint a token. `.uiux-gate.config.json` already exempts `i18n/**`, `types/**` and all test files.
11. **`check:file-sizes` caps source files at 800 lines.** Five files were split during Phase 2. **Split, never suppress.**
12. **Commit hooks are live.** `.husky/commit-msg` requires **lowercase** `spec:` and a subject ≤72 **characters** (`awk` counts bytes — Devanagari makes those diverge). `.husky/pre-commit` runs `eslint --max-warnings 0` on **staged** files, so a file staged for the first time surfaces its pre-existing warnings. Never `--no-verify`.

---

## 8. How to work — the standards that made Phase 2 hold up

- **Repo is truth (`E1`).** Open every file before asserting anything about it. The Phase 2 plan's line numbers were wrong **eight** times.
- **Measure, never predict (`E6`).** Record baseline → added → actual with real command output. A predicted test total is an assertion about the future and it will be wrong.
- **Prove every guard by mutation.** Revert the fix, watch the *named* test fail, restore byte-identical, verify by hash. Phase 3's implementer proved a guard the controller specified was **decorative** by mutating it and watching nothing fail — then removed it. That is the standard.
- **Never call a failing test a flake without measuring.** It happened three times in Phase 2 and **twice it was a real defect** — including a production bug where the sync display froze after a user switch, because a Dexie `liveQuery` starts *watching* only after its first *read* completes, and anything written in that gap is lost forever.
- **Correct the controller.** Every implementer in Phase 2 corrected an instruction at least once with evidence, and each was right. One proved an instruction would have turned a plot's labour from 3 into 11.
- **Never invent farmer-facing Marathi.** The founder is the authority. Invented Marathi shipped once with the word order inverted — a farmer who dropped 2 of 3 records would have been told he dropped **3 of 2**. It compiled and passed every test.

**Binding doctrine:** `docs/AGRISYNC-DOCTRINE.md` — especially `P1` (Phase Rule: canonical data never in a best-effort side-car), `P4` (no fabricated figure), `P5` (a truthful missing feature beats a fake working one), `P8` (provenance over precision), `P9` (low-friction capture is sacred).

---

## 9. Sequencing — do not get this wrong

```
1. MERGE feat/labour-management-ui      141 commits ahead of main, main 0 ahead — clean TODAY
2. Photo compression                    own branch off main, ~1 day, independent, before launch
3. THIS migration                       branch off main AFTER step 1
```

**Why step 1 must come first:** `main` has **none** of the Phase 2 work — no `scope`/`plot_ids` schema, no `LabourEngagementDto`, no read-back projection, no revised reconciler guard. This migration is a direct extension of that machinery. Branching from `main` before the merge means **writing the same plumbing twice and reconciling two versions of it later.**

`main` is currently **0 commits ahead**, so that merge is clean right now. It will not stay that way.

---

## 10. Reference — where the evidence lives

All under `.superpowers/sdd/2026-08-12-labour-phase2-server-truth-farm-context/` (gitignored — copy anything you need before relying on it):

| File | What |
|---|---|
| `cost-data-footprint.md` | per-record byte measurements, growth shape |
| `cost-aws-projection.md` | the real bill, scaling model, cheap wins |
| `progress.md` | the Phase 2 execution ledger — 31 controller rulings, every adjudicated finding |
| `recon-phase2.md` | repo-truth map + 12 landmines |
| `preflight-remaining.md` | architect's dependency analysis |
| `marathi-offbranch-pending.md` | 15 Marathi strings + 2 safety flags awaiting other branches |

**In the repo:** `docs/AGRISYNC-DOCTRINE.md` · `docs/superpowers/plans/2026-08-12-labour-phase2-server-truth-farm-context.md` (the pattern this work extends) · `docs/superpowers/plans/2026-08-12-labour-phase2-EXECUTION-HANDOFF.md`.

**Also check** whether a **Thin Client Migration** plan already exists in `Operations/Plans/` — project memory records phases 0–7 as done. **Read it before designing.** Do not build a second approach beside an existing one.

---

## 11. Open questions — get these answered before designing

1. **§6 — the first-login behaviour.** Eager, background, or on-demand. **This is the design.**
2. **`financialSummary` — stored or derived?** It is a computed total. `P1` says stated and derived must never impersonate each other.
3. **The machinery repair** — what happens to data already sent in the flattened form? It cannot be silently reinterpreted.
4. **Weather** — give it a reader or declare it write-only.
5. **How far back?** "Everything, forever" and "the last two seasons" are very different products on rural mobile data.

---

## 12. What is explicitly NOT in this work

Photo compression (§4 — own branch, first) · the AWS cheap wins (§4) · the AI-cost investigation · removing a member from a farm (does not exist; separate decision) · anything on `feat/labour-management-ui` that has not merged yet.

> **The farmer records once. The server remembers. Any device he logs into shows him everything — and nothing is ever lost unless he chooses to delete it.**
