# Labour, Attendance & Log-Approval — Design Spec

- **Spec ID:** `labour-attendance-approval-2026-07-13`
- **Date:** 2026-07-13
- **Status:** Draft for founder review (brainstorm complete; all decisions locked)
- **Mockup of record (clickable):** https://claude.ai/code/artifact/1e1ecbac-5a41-4ae4-84e6-e15bb6164b33
- **Scope guardrail (founder):** UI/UX-first; additive + nullable only; reuse existing infra; no huge rebuild; must not damage shipped/deployed systems. Build and prove reliability first; monetisation gating decided later.

---

## 1. The one spine (goal)

Give the owner **fully structural control** over farm work as a single connected chain, reusing what the app already has rather than building parallel systems:

> **Daily log → who was present (plot-wise) → attendance sheet → wages (owed) → payment → trust.**

Two feature families ride this spine:
- **Log approval + per-person trust-graduation** — any member logs; the owner approves; after a track record, the owner may grant a worker's own logs to auto-accept.
- **Plot-wise attendance + wages** — the workers named on a log appear on an attendance sheet, feeding the app's existing worker-payout machinery.

**Framing (founder):** the **farm-team setup screen is the INPUT** (who's on the team); **Labour Management is the OUTPUT** (what those same people did). Two sides of one coin.

---

## 2. Locked decisions

**Trust-graduation**
- Owner-**confirmed**; the app only **recommends** (never auto-flips). Owner stays in control.
- v1 grant = a graduated worker's **own logs auto-accept** (not approving others').
- **Per-person**, owner-customisable per worker (a temp worker may never graduate; a regular one does).
- Recommendation trigger = **time (~25 days) + clean record** (reuse `ReliabilityScore` + `granted_at_utc`).
- **Per-farm only** (Fork A-i). Cross-farm portable reputation is deferred until after first validation.
- **Billing** (paid vs free) is **deferred** — build + prove reliability first.

**Attendance**
- Attendance is **entered by the logging worker** (with logging access) + **owner approves** (rides the existing log-approval flow).
- Voice headcount ("आज ४ लोक कामाला आली") reflects on the sheet, but **≥1 named worker is compulsory** (select from history or type new). Each name is badged **Verified** (app-member worker) vs **Non-verified** (name-only).
- Presence granularity = **Present / Half-day / Absent**.
- **Wages: both** daily-flat **and** piece/contract rate (B-2).
- **Payment recorded + mode captured** (cash/UPI) — record-only, no real money movement (A-1 / Q6-b).
- **Wage extras** = a simple **"extra + reason"** line in v1 (A-1); a full owner-defined add-on **catalog** is a fast-follow.
- **Night-shift + GPS** = fast-follow: owner **pre-marks** a night shift **AND** the worker logs within **11 PM–5 AM**; location check is a **soft-flag** (never auto-reject; no GPS signal = "location not confirmed", never blocked).

**Attendance capture (AI)**
- Attendance names are **extracted from the existing daily voice log** — the same single parse, **+0 extra AI calls**. The attendance voice button is **correction-only** ("fix / add a name"); manual-first, offline-capable.

**Privacy (P2)**
- Named workers route through the **existing consent-aware worker ledger** (`WorkerAssignment`), **not** raw onto the farmer bucket. Add a **light one-time worker-consent** at "add worker". Keep it farm-scoped. Advisory compliance check before ship (not legal advice).

---

## 3. What already exists (verified — reuse, do not rebuild)

| Need | Existing reality |
| --- | --- |
| Approval engine | `DailyLog` + append-only `verification_events` (Draft→Confirmed→Verified→Disputed→CorrectionPending); `VerifyLogHandler`; owner-tier verify. **Real, shipped.** |
| Worker payout | `JobCard` (Draft→…→VerifiedForPayout→PaidOut) auto-cascades from log-verify; settles to one `labour_payout` `CostEntry` (plot-attributed, audited). Single money path enforced by arch-test **CEI-I8**. |
| Worker identity | One platform `UserId` → many `farm_memberships` (per-farm role/status). `granted_at_utc` gives "days since joined". |
| Trust signal | `ReliabilityScore` (0.50·verified + 0.30·onTime + 0.20·disputeFree, 30-day). |
| Consent-aware named-worker home | `WorkerAssignment` ledger — built, kept out of the farmer UI on purpose (the P2 home). |
| Voice parse | One server-side path (`BackendAiClient`, streaming). Labour schema is `.passthrough()` — additive-friendly. |
| Review UI | `ReviewInboxSheet` (the one wired sheet to consolidate onto). |
| Profile hub pattern | `SetupHubMenu` RowCard + master→detail (the shipped multifarm Profile pattern). |

**Genuinely absent (net-new):** attendance itself (no present/absent concept), named-workers-on-a-log (names are redacted today), a durable per-worker/farm **wage rate** store + the "wage settings" screen (the old one was removed — it's now just a Price Book pointer), and a point-in-polygon geometry check for GPS.

---

## 4. UI / Information Architecture

**Placement (recommended; confirm on review):**
1. **Labour Management** lives **under Profile**, one row below "My Farm Team" (the "More" group, same pattern Finance uses). It is the structural **mirror** of the team-setup: same roster, but each row shows attendance / wages owed / trust; tapping a worker opens their history (reuses the built-but-orphaned worker-profile screen). *(Alternative considered: a 6th bottom-tab — deferred; it needs a full nav-bar rebuild and is better as a later promotion.)*
2. **Approval** = **one** consolidated review sheet, reachable **two ways** — the Home close-the-day flow **and** a "N pending" entry in Labour Management. The 4 scattered review surfaces collapse into it; orphans retired (`VerifyActionBar`, `VerificationInbox`, `LogAttribution`, the ReflectPage duplicate).

**DRY seam:** a shared `useFarmRoster(farmId)` selector feeds both the input (team-setup) and output (Labour Management) screens so they never drift.

**Attendance screen:** plot selector · voice headcount (editable) · named workers with Present/Half/Absent · ≥1-name-required hint · Verified/Non-verified badges · "fix / add a name" (manual-first). Marathi-first throughout.

---

## 5. v1 scope

**Build now (v1):**
- Fix "who can approve" (one canonical owner-tier rule) + **one clean Marathi review sheet**; retire the duplicate/orphan review UIs.
- **Named-worker-per-log capture** — extend the existing parse to keep the names it hears (routed via the consent-aware ledger, P2); manual add/correct.
- **Attendance sheet** (plot-wise, Present/Half/Absent) + **Labour Management** hub + reconnect the worker-history screen.
- **Wages** — new wage-setup (daily + piece) + "what's owed" + payment mode (cash/UPI) + simple "extra + reason" line.
- **Per-person, owner-confirmed trust-graduation** (time + clean-record recommendation; own-logs auto-accept).
- **Forward-compat hooks:** Permanent/Temporary worker tag; thread device location into the log sync; a nullable night-shift slot.

**Design-for, defer:** GPS night-shift check (fast-follow), full owner-defined add-on **catalog**, cross-farm portable reputation, worker-as-supervisor (approving others), attendance→ReliabilityScore wiring.

---

## 6. Plan sequence (scope + steps + change surface)

Each plan is additive, shippable on its own, and carries a Founder Acceptance Gate before deploy.

### Plan 1 — Foundation (approval + named-worker capture)
- **Scope:** canonical who-can-approve; consolidate the review UIs into one Marathi sheet; add named-workers-on-a-log capture (extend the one parse, +0 AI calls; route names via the consent-aware ledger); worker-consent at "add worker"; retire orphan review components.
- **Steps:** ① reconcile the domain-vs-infra owner-role rule → one source of truth. ② consolidate onto `ReviewInboxSheet`, Marathi-first, correct pending-state; delete orphans/duplicate. ③ add `workersPresent[]` to the labour schema **and** the TS type in the same commit; teach names in the **hashed** prompt files (`labour.v2.md` + `outputContract.md`), stop scrubbing those structured names; **prompt version-bump + golden-set replay** (deploy-gate). ④ persist named presence via the `WorkerAssignment` ledger + one-time consent. ⑤ tests.
- **Change surface:** DB (additive: presence link / consent flag on the worker ledger) · Backend (parse output, verify-role reconcile, consent write) · Frontend (review sheet consolidation, name-capture UI, redaction change lockstep) · Cross-cutting (prompt registry + golden-set; DPDP consent). **New ADR:** named-worker identity + keep-names-decoupled-from-money. **High-trust spec.**

### Plan 2 — Attendance v1
- **Scope:** `log_attendance` (named presence, Present/Half/Absent, per plot/day) beside the anonymous headcount (NO-MULTIPLY preserved); owner-typed worker roster (from the consent-aware ledger); Labour Management hub; reconnect worker-history; shared `useFarmRoster`.
- **Steps:** new nullable child table + write handler; roster picker (history / new); Labour Management RowCard under Profile + hub screen; worker-detail wiring; plot-wise view; graceful degradation + tests.
- **Change surface:** DB (new `log_attendance`, additive) · Backend (capture handler, roster endpoint) · Frontend (hub + attendance + worker detail, Marathi) · Cross-cutting (offline Dexie for manual edits).

### Plan 3 — Wages
- **Scope:** new wage-setup (per-worker/farm daily rate + piece/contract), "what's owed" (presence × rate — an owner-configured projection, **never** written back into the honest ledger), payment mode (cash/UPI, nullable cols on `cost_entries`), simple "extra + reason" line — all settling through the **one** existing `labour_payout` path (no new money table, no double-entry).
- **Change surface:** DB (rate store + `cost_entries` nullable `payment_method`/`paid_at`) · Backend (owed projection, settle-through-JobCard) · Frontend (wage-setup screen, owed display) · Cross-cutting (server-authoritative wage compute for offline safety). **New ADR:** owner-configured-owed vs NO-MULTIPLY.

### Plan 4 — Night-shift + GPS (fast-follow)
- **Scope:** owner pre-mark a night shift; 11 PM–5 AM window (IST↔UTC handled); soft-flag point-in-boundary check (ray-cast, no PostGIS); graceful no-signal; extra pay via the "extra + reason" line.
- **Change surface:** Backend (point-in-polygon, window detect) · Frontend (pre-mark UI, soft-flag surfacing) · Cross-cutting (device location threaded in Plan 1/2). Additive.

### Plan 5 — Trust-graduation
- **Scope:** server-persist review-policy (per-member on `FarmMembership`, additive/nullable, default = today); owner-confirmed graduation + system recommendation (time + clean-record); graduated worker's own logs auto-accept (emit a source-tagged `verification_event` — auditable); wire attendance into `ReliabilityScore`.
- **Change surface:** DB (nullable review-policy cols) · Backend (graduation transition, auto-accept event, authz) · Frontend (recommendation + grant UI, trust indicator) · Cross-cutting (offline: server authoritative on revoke). **New ADR / high-trust spec.**

---

## 7. Forward-compat rules (protect the habit loop)
1. A worker is **one platform identity**, never duplicated per farm.
2. Keep the raw per-(worker, farm) trail forever so cross-farm reputation is computable later.
3. Permanent/Temporary is a **real** tag from day one (auto-expiry deferred).
4. Team + approval + labour screens built with **slots** for future richness (trust, badges) so later additions fill a slot, not a redesign.
5. **One and only one** path from work to a `labour_payout` `CostEntry` (no double-pay).
6. A name/attendance mark **never** fabricates a wage total (NO-MULTIPLY).

---

## 8. Risks / STOP conditions
- **Double-entry wage** — exactly one money path (STOP if two go live).
- **Schema/type lockstep** — `workersPresent[]` in schema **and** TS type same commit, or every parse fails.
- **Prompt drift** — the golden-set replay is a hard deploy-gate; teach names in the hashed prompt files, not few-shot.
- **DPDP/PII** — P2 + consent + advisory compliance check before ship.
- **Offline** — money computes server-side; manual attendance edits work offline; voice correction needs connectivity.
- **No auto-flip** on graduation (owner confirms); auto-accepted logs stay auditable.

---

## 9. Open confirmations (founder, on review)
1. Placement = **Labour Management under Profile** + **one review sheet, two doorways** (recommended). Override → bottom-tab.
2. Relabel the prototype's attendance voice button to **"fix / add"** (agreed in principle).
3. Proceed to **writing-plans for Plan 1** (foundation) after this spec is approved.

Every plan then goes through `superpowers:writing-plans` (Change Surface → binary tasks → 🛑 Founder Acceptance Gate → Deployment + prod-proof), with the senior-architect pre-flight. Nothing builds or merges without founder approval.
