# COMPLETE GAP REGISTER

**Date:** 2026-08-14 · **Compiled at the close of the Labour Phase 2 session**
**Purpose:** one list of everything known to be open, so nothing is carried only in a conversation.

**Sources:** this session's own work and reviews · `2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md` (the other lane's six-tracer discovery) · `docs/superpowers/evidence/2026-08-14-cost-*.md` (measured AWS + data footprint) · project memory.

**Two honesty markers used throughout:**
- **MEASURED** — reproduced, or read directly off a running system / real bill.
- **STATIC** — found by reading code. Credible, **not yet demonstrated on a device.** Most of the other lane's matrix is STATIC by its own §8.

---

## 0. Blocks onboarding real farmers — decide or fix first

| # | Gap | Owner | Status |
|---|---|---|---|
| **B1** | **Option A is guidance, not code.** Harvest, procurement, cost correction, income and log deletion are still present and reachable. Not teaching a farmer about a screen does not stop him finding it. | **THIS LANE** | **Founder fork: accept for a group you can phone, or hide behind a flag.** |
| **B2** | **Machinery + expense fields destroyed on the first sync, on the farmer's own phone.** Not a new device — his phone, next time it talks to the server. | Other lane | STATIC |
| **B3** | **Offline voice note produces nothing.** Uploads, parses, completes — no draft ever appears. The core use case of a voice-first app. | Other lane | STATIC |
| **B4** | **Deleted logs come back.** Deletion is written to a table nothing drains. | Other lane | **MEASURED** — verified this session |
| **B5** | **Income is stored as expenditure.** No direction on the wire. | Other lane | STATIC |
| **B6** | **Harvest sales are never persisted anywhere.** The save handler updates memory only; the backend has no harvest type. | Other lane | STATIC |
| **B7** | **Cost corrections silently rejected.** Farmer sees it, server never gets it, nobody is told. | Other lane | STATIC |
| **B8** | **Cross-farmer exposure on a shared handset** — three mechanisms. | Other lane | STATIC |
| **B9** | **A real-device test has never been run.** Every proof in this branch is `fake-indexeddb` + EF InMemory. The plan's own §B4 says a clean-device journey must not be a unit test. | **FOUNDER** | Outstanding |

---

## 1. This lane — Labour Phase 2

### 1.1 Open, carried deliberately

| # | Gap | Why it was not done |
|---|---|---|
| L1 | **A clean device reconstructs labour but NOT machinery, activity expenses, planned tasks or the money summary** — they come back empty. | Needs the server to accept and return them. That is the other lane. |
| L2 | **Owner cannot remove a member from a farm.** The capability does not exist; only self-exit, fixed this week. | Product decision + server work. Founder has not ruled. |
| L3 | **Non-labour edits are durable on that phone only.** A labour correction reaches the server; the irrigation change in the same edit does not. The toast says so honestly. | Deferred to the durability work. |
| L4 | **`db.outbox` is write-only with zero readers, and now grows on every edit.** Retiring it needs a Dexie version bump. | Out of Phase 1 scope. **Note: it is NOT inert — see B4.** |
| L5 | **`weather_stamps` is written and read by nothing.** | Needs a reader or an explicit write-only declaration. |
| L6 | **Old संपूर्ण शेत records already stranded on phones are not rescued.** Nothing re-attempts a skipped log. | Not a regression; no backfill path exists. |
| L7 | **`getTodayPlotData` is dead code** — provided, declared, destructured nowhere. | Flagged, not swept. |
| L8 | **`selection[0]` only:** a two-crop log drops the second crop's plots. Real and reachable today, unrelated to farm scope. | Found late, out of scope. |
| L9 | **A correction-shaped confirmation panel.** The edit path deliberately has none, because the create-shaped one would answer a question the farmer did not ask. | Phase 4 earns it. |
| L10 | **11 stale code comments** still quote the old chip strings. Two are `.tsx`. | One grep to finish. |
| L11 | **Chip contrast is sub-AA** (2.21 / 2.74 / 3.98:1). Measured fix: `text-stone-600` = 5.72:1. | **Founder explicitly reserved this for his own examination.** |
| L12 | **No UI to see or delete your own stored data** — a farmer on a shared handset cannot clear his own records after use. | New surface; not scoped. |

### 1.2 Specced, not built
- **Finance allocation display.** `DayLedger` + `DayLedgerAllocation` already hold derived rows and equal/acreage/custom allocation already works. Three gaps: only receipt-capture can reach it, nothing renders those rows, crops are not wired. **~70% built already.**

---

## 2. Other lane — server-authoritative architecture

Full detail in their matrix. Grouped here so the shape is visible; **their §8 says none of it is reproduced on a device.**

**Destroys or falsifies farmer data:** pull destroys 14 fields (§4.1) · offline voice yields nothing (§4.2) · deletions resurrect (§4.3) · queued media never deleted until storage fills and **new captures stop working** (§4.4) · cost corrections rejected (§4.7) · harvest never persisted (§4.9) · income as expenditure (§4.10) · review approvals unrecoverable (§4.11) · planned tasks never sent (§4.12) · **double-tap creates two cost entries** (§4.13) · the farmer's stated total discarded while the derived total takes its name (§4.15).

**Fabricates:** **20 invented values on the return path** (§4.14) — flood irrigation returns as drip, a curative fungicide as preventive, a disturbance day as a work day, every recovered log as ₹0.

**Privacy / security:** cross-farmer exposure, three mechanisms (§4.8) · **voice clips stored in plaintext; the encryption is dead code** (§4.5) · raw evidence written to an undocumented bucket under weaker encryption than intended, every write failure swallowed (§4.23) · `ssf.farm_boundaries` has **no row-level security** (§4.28).

**Traps a farmer with no way out:** a killed app strands captured evidence in a status nothing resets, and the honesty chip shouts with no action that can quiet it (§4.6).

**Structural:** five sync mechanisms where one is specified (§4.19) · one transaction per mutation, so a parent can fail while its children commit, with nothing reconciling the orphans · provenance dies at the device boundary (§4.21) · the farmer's own words never leave the phone (§4.22) · no presigned upload and the one "presigned" URL is a fabricated string (§4.24) · **no observability at all** — the 1,922-line sync handler has zero logging (§4.25) · unpruned server queues (§4.26) · farm boundary stored and never read (§4.27) · allocation split mismatch (§4.20).

**Capabilities that must be BUILT, not fixed:** optimistic concurrency / entity versioning (**zero today**) · presigned upload · a delete path for stored media · server-side harvest and procurement · plot geometry · an AI-job reconciler · bounded progressive hydration · end-to-end correlation · server-queue retention · a "partial record" concept.

---

## 3. Infrastructure and cost — MEASURED

| # | Gap | Detail |
|---|---|---|
| I1 | **No image compression anywhere.** | Both upload paths are plain file inputs. `@capacitor/camera` installed, never called. Audio *is* compressed; images never got it. **~1 day of work; ₹18,489/mo at 10k farmers; primarily a reliability fix — a 4 MB upload on rural 2G fails.** |
| I2 | **Every attachment download is proxied through the API and buffered whole into managed heap.** | Not presigned, not CDN. A latency and scaling risk **before** it is a cost one. |
| I3 | **A live Glacier transition at 365 days** on `shramsafal-uploads-prod`, present in AWS and in **no infrastructure code**. | Conflicts with "farmer reviews last season" — the one access pattern where cold storage costs *more*. Nobody recorded the decision. |
| I4 | **`agrisync-raw-ap-south-1` is live and receiving production writes** — 41 objects, most recent 2026-08-13 — under **AES256, not the intended customer-managed key**, with no lifecycle policy and every write failure swallowed. | Governance + encryption problem, not a cost one (~1 MB). |
| I5 | **A receipt is stored three times**; only one copy is deduplicated. | §4.16. |
| I6 | **The AI bill is unmeasured and will dwarf storage.** Sarvam is billed per call, scales linearly with farmers, no economies of scale. | **The number to chase before optimising storage.** |
| I7 | **`gitleaks` is not installed**, so the pre-commit secret scan silently skips. | Every commit this session warned and passed. |
| I8 | **Production compute is hibernated.** Leaving it awake costs **₹618/mo** — not the ₹3,300 the repo's own README claims. | Must be woken to deploy. |

---

## 4. Security and compliance

| # | Gap | Severity |
|---|---|---|
| S1 | **The Postgres superuser password is on the public repo in 6 files, and Postgres binds 0.0.0.0.** Rotation is the only fix. | **P0, from project memory, still open** |
| S2 | Voice clips stored **in plaintext**; envelope encryption is entirely inert. | High — DPDP surface |
| S3 | **Two spray-safety questions claim `agronomistApproved: true` and no agronomist reviewed them.** Advice about spraying in high wind and before rain. | **A false claim of authority on chemical-safety advice.** Off-branch; first item in `marathi-offbranch-pending.md`. |
| S4 | `ssf.farm_boundaries` has **no row-level security** — the only farm table without one. | Medium |
| S5 | **The DPDP data-export flow appears to produce a fabricated download link** — a string-concatenated unsigned URL persisted as if signed. **Reported, not verified by me.** | Legal obligation; verify before acting |
| S6 | Raw evidence bucket: weaker encryption than intended, undocumented, failures swallowed. | See I4 |

---

## 5. Process and documentation

| # | Gap |
|---|---|
| P1 | **Two lanes share one working tree.** It bit twice this session — the other lane checked out its branch mid-work and two commits landed on the wrong branch. Recovered by fast-forward; nothing lost, but it produced a wrong report first. **Use separate worktrees.** |
| P2 | **`SESSION_STATE.md` last written 2026-05-22** and still describes the old branch. **`PROJECT_BOOT.md` names the wrong trunk.** |
| P3 | **The "Thin Client Migration phases 0–7 complete" claim is unverifiable** — the only artifact is a 13-line tombstone pointing at an empty directory. Memory corrected. **Do not cite it.** |
| P4 | **Role allowlists reference directories that do not exist** (`src/BuildingBlocks/`, `src/SharedKernel/`, `src/tests/AgriSync.Domain.Tests/`). Flagged four times by four different agents. |
| P5 | **`npm run generate` does not reproduce the committed tree** — it overwrites a payload file with a duplicate record (CS0101). CI's diff gate greps only `SyncMutationCatalog`, so generated payload records are **not diff-gated at all**. |
| P6 | **`main` is 148 commits behind this branch** and 0 ahead. Clean today; it will not stay that way. |

---

## 6. Open founder decisions

| # | Decision | Blocking? |
|---|---|---|
| D1 | **Option A: accept the reachable-features gap, or hide them behind a flag?** | **Blocks onboarding** |
| D2 | **Run the device test.** | **Blocks merge** |
| D3 | Should an owner be able to remove a member from a farm? | No |
| D4 | Is "labour comes back, machinery and expenses do not" acceptable for launch? | Shapes the other lane's priority |
| D5 | Keep, lengthen, or remove the 365-day Glacier transition? | No |
| D6 | Voice-audio retention — the 30-day ruling was made before it was known the clips are plaintext and the consent archive never fires. Does it still hold? | No |
| D7 | Triage: hotfix lane in parallel with the architecture programme, fold everything in, or split? | Shapes the other lane |
| D8 | Chip contrast — reserved by the founder for his own examination. | No |

---

## 7. What is already right — do not "fix" these

Naming them matters as much as naming the gaps.

1. **The log-save honesty layer** — the other lane's own matrix calls it *exemplary* and says *"extend it; do not redesign it."*
2. **The no-multiply rule.** A labour expense with no stated total is deliberately not sent, because multiplying a rate by hours would invent a figure.
3. **Auth is clean.** No token in localStorage; access token in memory; refresh via HttpOnly cookie / Android Keystore.
4. **Server-side tenancy is real** — ownership checks, membership filters and RLS on farms, plots and crop cycles. One exception (S4).
5. **The voice-clip retention sweeper works.** The only enforced retention policy in the client.
6. **The labour round trip is structurally correct** — the proof the pattern works, and the shape everything else should take.
7. **Audio is properly compressed.**
8. **Crash-during-sync recovery is deterministic** for logs and log tasks, and the outbox is not deleted on user switch or logout.

---

## 8. The one thing worth doing before anything else

**Reproduce B2 on one real device.** One log with machinery and an expense, one sync, one pull.

Roughly forty of the gaps above are STATIC — read, not demonstrated. This session showed twice that reading and running give different answers: an automated check passed against a button a farmer physically cannot reach, and a "flaky" test turned out to be a real production bug.

**Fifteen minutes turns a list of credible claims into a list of facts**, and everything downstream gets cheaper.
