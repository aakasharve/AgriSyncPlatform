# Multi-Farm Profile — Design Spec

- **Spec ID:** `multifarm-profile-2026-07-11`
- **Date:** 2026-07-11
- **Status:** Approved (structure + look) — ready for implementation plan
- **Branch:** `feat/setup-hub-polish`
- **Mockup of record:** https://claude.ai/code/artifact/bf3311f4-27eb-46c7-b4cf-63c08d07aeec
- **Scope guardrail (founder, verbatim):** "UI UX first but that must not hamper (or majorly damage) the already built/deployed infra… small tweaks are still acceptable as we are not live to users but not huge rebuild or recode."

---

## 1. Goal

Reorganise the Profile so the **farmer (person) is the anchor** and everything below is **their farms**, where **one Farm = one 7/12 (सातबारा) holding**. A farmer can hold many farms; farms are visually separated, family-grouped, and each farm opens its **own** page with **its own** team + crops/plots. This is a **presentation-layer reorganisation on top of the existing multi-tenant model**, not a new domain.

### Non-goals (explicit)
- No re-architecture of the OwnerAccount → Farm → FarmMembership model. It already supports multi-farm + per-farm teams + QR join.
- No work-assignment / task-routing engine (parked in `FARM_TEAM_MULTITENANT_ROUTING_FUTURE_FEATURE.md`). Members are **name-holders with access toggles** only.
- No AgriStack / Bhumi Abhilekh integration built now. Design **AgriStack-ready**; wiring is a later, separate spec.
- No destructive migrations. Any new persistence is **additive + nullable** only.

---

## 2. What already exists (verified in repo — reuse, do not rebuild)

| Concept in the mockup | Existing backend reality |
| --- | --- |
| A farm | `Farm` (name, `OwnerUserId`, `OwnerAccountId`, `TotalGovtAreaAcres`, canonical centre, `FarmCode`) |
| One farmer → many farms | `OwnerAccount` owns many `Farm` rows; `/shramsafal/farms/mine` already returns the list |
| Each farm has its own team | `FarmMembership` is **per-farm** (AppRole, `MembershipStatus` state machine, invariant I3 last-PrimaryOwner) |
| "Add member via QR / temporary" | `JoinedVia` = PrimaryOwnerBootstrap(1) / OwnerManualAdd(2) / QrScan(3) / SelfJoin(4); FarmInvitation / JoinToken flow |
| Per-member access toggles | `OperatorCapability` (LOG_DATA / VIEW_ALL / APPROVE_LOGS / MANAGE_PEOPLE) — already surfaced in `TeamMemberCard.tsx` |
| Profile-as-menu + per-section pages | `SetupHubMenu.tsx` + `ProfilePage.tsx` (menu ↔ detail nav, folded Settings, `onExit` back) |

**Conclusion:** multi-farm, per-farm team, and QR join are all already built. The new work is (a) the **UI layer** that presents farms as separated 7/12 holdings with a per-farm drill-in, and (b) **three small additive labels** below.

---

## 3. What is genuinely new (kept minimal + additive)

| New thing | Where it lives | Infra impact |
| --- | --- | --- |
| **Farm tenure** — Owned / Leased tag per farm | Phase 1: UI-only, defaults to "Owned" when unknown. Phase 2 (optional): nullable `Tenure` enum column on `Farm` (additive, non-destructive) | None in P1; one additive nullable column in P2 |
| **Family grouping** — "Arve Family" header grouping farms | **UI-only** grouping over `OwnerAccount` (client-side group label). No data merge. | None |
| **Member type** — Family / Leased / Temporary badge | Derived from existing signals where possible: `JoinedVia=QrScan` → **Temporary**; manual-add → **Family** default, **Leased** as an optional UI tag. Phase 2 (optional): nullable member-type tag. | None in P1; optional nullable tag in P2 |
| **7/12 label** — गट/survey no. per farm | Phase 1: shows `FarmCode` / a manual survey field if present, else hidden gracefully. Farmer-ID auto-fill is a **future** hook. | None |

Every new element **degrades gracefully**: if the underlying value is absent, the tag/label simply doesn't render — the screen still works with today's seeded data.

---

## 4. UX structure (the two screens)

### Screen 1 — Profile (person anchor + farms)
1. **Farmer summary** — avatar, name, `Farmer ID · पडताळली` chip (verified state; chip hidden if not verified).
2. **Family group header** — `आर्वे कुटुंब · Arve Family` + "N farms". Grouping is visual only.
3. **Farm cards** (visually separated, **sortable by farm name**) — each shows: name, 7/12 गट, tenure tag (Owned green / Leased amber), area, plot count, team count. Tap → that farm's page.
4. **Add a farm** — additive CTA.
5. **More** (Finance) + **Settings** (folded in, per prior decision) + **Log out**.

### Screen 2 — A Farm's page (drill-in)
- **Farm hero** — name, location, 7/12 गट, tenure, area.
- **Weather** — per-farm (reuses existing weather widget wiring).
- **Farm Team** — *only this farm's* members; each has a **type badge** (Family / Leased / Temporary-QR) and expands to the existing **access toggles** (`TeamMemberCard`). "Add member" + "Add via QR" (existing flows). Adding a member asks the type.
- **Crops & Plots** — only this farm's plots.

Navigation reuses the approved menu → page pattern with the `← मागे` back pill everywhere (fixes the earlier "no way to exit" gap).

---

## 5. Design language (locked)
- Soft rounded RowCards, blended gradient header (no hard white banner), emerald line-icons (lucide, **no emoji** except the 👨‍🌾 avatar the app already uses).
- Tenure tags: Owned = emerald; Leased = amber. Member type badges: Family = emerald, Leased = amber, Temporary = orange.
- Bilingual Marathi · English throughout. Fonts per project rules (Noto Sans/Serif Devanagari + DM Sans).
- **No explanatory caption boxes** inside the UI (founder removed them) — the interface speaks for itself.
- Strong tap feedback (active:scale), theme-aware.

---

## 6. Phasing (so infra is never at risk)
- **Phase 1 — UI-only (default).** Reorganise Profile + farm drill-in using **existing** `/farms/mine` + per-farm membership data. Tenure defaults to Owned, member-type derived from `JoinedVia`, family group is a client label, 7/12 shows `FarmCode`/existing survey if present. **Zero backend/DB change.** This is the whole "small tweak" the founder authorised.
- **Phase 2 — optional additive persistence (separate approval).** Nullable `Farm.Tenure`, optional member-type tag, explicit 7/12 survey field. Only if the founder wants the labels to be real/stored rather than derived. Additive migration, non-destructive.
- **Phase 3 — AgriStack-ready (future, separate spec).** Farmer-ID consent flow auto-fills 7/12 + geo boundary.

---

## 7. Testing
- Component/snapshot tests for the Profile menu, farm card list (multi-farm + single-farm + zero-farm), and farm drill-in.
- Sort-by-name behaviour test.
- Graceful-degradation tests: farm with no tenure / no 7/12 / no team renders without error.
- Existing 258-test suite stays green; architecture tests unaffected (frontend-only in P1).

---

## 8. Open confirmations (defaults chosen; founder may override)
1. Layout = farm-list → drill-in (chosen). 
2. Owned/Leased = colored tag (chosen). 
3. Family Merge = UI grouping only (chosen). 
4. 7/12 = label now, Farmer-ID auto-fill later (chosen).
5. Scope = Phase 1 UI-only now (chosen).
