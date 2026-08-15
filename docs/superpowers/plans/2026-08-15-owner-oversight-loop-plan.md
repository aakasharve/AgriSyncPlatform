# Owner's Oversight Loop — implementation plan

**Spec (binding authority):** `docs/superpowers/specs/2026-08-15-owner-oversight-loop-design.md`
**Branch:** `feat/owner-oversight-loop` (worktree `.claude/worktrees/owner-oversight-loop`)
**Goal of this run:** the loop is complete and **previewable in `npm run dev`**.

---

## Context

`AppHeader` renders on every route, so putting the strip there makes it canonical for free. The
waiting drawer absorbs three signals that today sit above the plot selector in English
(`todayDayState.unverifiedCount`, `yesterdayDayState.unverifiedCount`,
`costSnapshot.unverifiedToday`) plus the sync chip's one useful state. **Net effect on the home
screen is shorter, not longer.**

---

## Change Surface

- **DB** — none in this run. The durable checkpoint column is coordinated with the
  server-authoritative lane (spec §8.1) and is a named follow-up, not silently dropped.
- **Backend** — none in this run.
- **Frontend** — new: oversight selectors, acknowledgement port + local adapter, i18n module,
  `CanonicalStrip`, `WaitingDrawer`. Modified: `AppHeader.tsx`, `mainView.tsx`.
- **Cross-cutting** — the sync chip leaves the header; its `NEEDS_FIX` statement must still reach
  the farmer through the drawer.

---

## Global Constraints

Every task is bound by these. The reviewer receives them verbatim.

1. **Spec §P-A — two axes.** Acknowledgement writes ONLY the awareness checkpoint. No task may
   write `verification.status` from an awareness path. A test must prove Seen leaves decision rows
   in place.
2. **Spec §P-F — no fabricated numbers.** Every count is derived from the passed-in records. No
   numeric literal for a count in any component. People tally counts named people only.
3. **Spec §P-G — colour rule.** The Seen control must NOT use `emerald`. A test asserts its
   className carries no `bg-emerald` / `emerald-600`.
4. **Spec §6 — Marathi.** Never invent a farmer-facing Marathi string in a component. All strings
   go through the i18n module from Task 3. Strings listed in spec §6.2 are placeholders and must
   render an English fallback beside them.
5. **`CropSelector.tsx` and `FarmContextSwitcher.tsx` are NOT to be modified.** Their rendered
   output must stay byte-identical. Only their call sites and surrounding layout may change.
6. **File-size cap 800 lines** (`npm run check:file-sizes`). `mainView.tsx` is at **741** — Task 7
   may only REMOVE from it. New UI goes in new files.
7. **No new dependency.** No new npm package in any task.
8. **Tests are real.** No test that asserts nothing. Every task runs
   `npx vitest run <its own test files>` and reports the actual output.
9. **Do not touch** `/sync/push`, the mutation catalog, any `.zod.ts` payload schema, any EF
   migration, or `syncHonestyState.ts`'s logic. Task 6 removes a *call site* of `SyncIndicator`;
   the module and its states stay.
10. **Verify before asserting.** Open a file before claiming what is in it.

---

## Task 1 — Oversight selectors (pure)

**Files:** create `src/clients/mobile-web/src/features/oversight/oversightSelectors.ts` and
`src/clients/mobile-web/src/features/oversight/__tests__/oversightSelectors.test.ts`

Pure functions, no Dexie, no React, no clock of their own (take `nowISO` as a parameter).

```ts
export interface OversightPerson {
  operatorId: string | null;   // null = creator not captured
  name: string;                // resolved name, or '' when operatorId is null
  recordCount: number;
  plotNames: string[];         // distinct, in first-seen order
  workCategories: OversightWorkCategory[];
}
export type OversightWorkCategory =
  | 'irrigation' | 'labour' | 'machinery' | 'inputs' | 'cropActivity' | 'observation';

export interface OversightDecision {
  kind: 'approval' | 'dayNotClosed' | 'failedSend';
  count: number;
  holderName: string | null;   // non-null ONLY when approval is delegated away
}

export interface OversightModel {
  people: OversightPerson[];        // named people only
  unattributed: OversightPerson | null;
  totalRecords: number;             // includes unattributed
  totalPlots: number;               // distinct across everything
  decisions: OversightDecision[];
  waitingCount: number;             // decisions.length + people.length
  sinceDays: number | null;         // null when no checkpoint yet
}

export function buildOversightModel(input: {
  logs: DailyLog[];                 // already filtered to the active farm
  checkpointISO: string | null;
  nowISO: string;
  operatorNameById: Record<string, string>;
  unverifiedCount: number;
  yesterdayNotClosed: boolean;
  failedSendCount: number;
  approvalHolderName: string | null;
}): OversightModel;
```

**Rules the tests must pin:**

- A log is unseen when its server timestamp is strictly after `checkpointISO`
  (spec §P-C). Use `meta` server time when present; when absent, fall back to the log's own
  `createdAtISO` **and** mark the model so the UI can say the boundary is approximate — add
  `boundaryApproximate: boolean` to `OversightModel`. Never fabricate a boundary.
- `checkpointISO === null` → everything is unseen, `sinceDays = null`.
- Logs whose `meta.createdByOperatorId` is absent go to `unattributed`, **never** into `people`.
- `people` never includes the unattributed bucket, so the tally in the UI is honest.
- `totalPlots` counts distinct `context.selection[].selectedPlotNames` across all unseen logs.
- `workCategories` are present only when the corresponding array on the log is non-empty.
- `decisions` omits any entry whose count is 0.
- `holderName` non-null makes that decision view-only downstream.

**Tests (name them exactly):**
`counts_only_named_people_in_the_people_tally` ·
`records_with_no_creator_become_the_unattributed_bucket` ·
`a_log_that_arrived_after_the_checkpoint_is_unseen_even_when_its_work_date_is_older` ·
`a_null_checkpoint_makes_everything_unseen_and_sinceDays_null` ·
`zero_count_decisions_are_omitted` ·
`work_categories_appear_only_when_the_log_carries_that_array` ·
`missing_server_timestamps_set_boundaryApproximate_true`

**Verify:** `npx vitest run src/features/oversight/__tests__/oversightSelectors.test.ts`

---

## Task 2 — Acknowledgement port + local adapter + hook

**Files:** create `src/features/oversight/OversightAcknowledgementPort.ts`,
`src/features/oversight/LocalOversightAcknowledgementStore.ts`,
`src/features/oversight/useOversightAcknowledgement.ts`, and a test file for the store + hook.

```ts
export interface OversightAcknowledgementPort {
  read(farmId: string): Promise<string | null>;              // ISO checkpoint
  acknowledge(farmId: string, atISO: string): Promise<void>; // throws on failure
}
```

- **Local adapter** persists per `(userId, farmId)`. **It must go through the app's existing
  namespaced storage helper** — read `src/infrastructure/storage/` first and use the same
  `getKey()`-style scoping the other stores use. Do NOT write a bare `localStorage` key: per-farmer
  isolation is a live P0 in the other lane and an un-namespaced key would reopen it.
- **Hook** exposes `{ checkpointISO, status, acknowledge }` where
  `status: 'idle' | 'saving' | 'failed'`.
- **Spec §P-D — no silent success.** `acknowledge()` sets `saving`, and on rejection sets `failed`
  and leaves `checkpointISO` UNCHANGED. Never optimistic.

**Tests:** `acknowledge_persists_the_checkpoint_for_that_farm` ·
`a_failed_acknowledge_leaves_the_previous_checkpoint_untouched` ·
`a_failed_acknowledge_reports_failed_status` ·
`checkpoints_are_scoped_per_farm`

---

## Task 3 — i18n module

**Files:** create `src/i18n/oversightTranslations.ts` + a test.

- Every string the new UI needs, keyed. **Reuse the existing repo strings listed in spec §6.1
  verbatim** — import or copy the exact Devanagari, do not retype it.
- For each string in spec §6.2, define the key with the placeholder Devanagari **and** an
  `…En` sibling carrying the English, and mark it in a `PENDING_FOUNDER_STRINGS` exported array.
- Follow the shape of `src/i18n/dfesTranslations.ts` (read it first).

**Tests:** `every_key_has_both_mr_and_en` · `pending_founder_strings_are_all_declared_keys` ·
`reused_repo_strings_match_dfesTranslations_exactly`

---

## Task 4 — CanonicalStrip component

**Files:** create `src/features/oversight/components/CanonicalStrip.tsx` + test.

Renders the farm chip and the waiting button per spec §2. Props only — no data fetching.

- Farm chip: `min-height:52px`, max width ~136px, emerald palette, calls `onOpenFarmSwitcher`.
- Waiting button: `flex:1`, `min-height:52px`, amber palette when `waitingCount > 0`; white +
  green tick + rest label when 0. **Keeps the same position and height in both states.**
- Count pill renders `waitingCount` — **from props, never a literal**.

**Tests:** `waiting_button_keeps_its_height_in_both_states` ·
`the_count_comes_from_props` · `rest_state_shows_the_rest_label_and_no_count` ·
`tapping_the_farm_chip_calls_onOpenFarmSwitcher`

---

## Task 5 — WaitingDrawer component

**Files:** create `src/features/oversight/components/WaitingDrawer.tsx` + test.

Renders spec §3: decision band first, then the briefing card, then the Seen control.

- Decision rows from `model.decisions`. When `holderName` is non-null the row renders **no action
  affordance** and names the holder instead.
- Briefing: headline, sub, tallies (`people.length`, `totalRecords`, `totalPlots`), one row per
  person, then the unattributed row when present.
- Person pin colour comes from the app's existing `getUserColor` — read `AppHeader.tsx:37` and reuse
  that hash, do not invent a second one.
- Seen button: `onAcknowledge`, disabled while `status === 'saving'`, and renders a visible retry
  affordance when `status === 'failed'`.

**Tests (§9.4 and §9.5 of the spec are proven here):**
`acknowledging_does_not_change_any_decision_row` ·
`the_seen_control_is_not_emerald` ·
`a_delegated_decision_renders_no_action_and_names_the_holder` ·
`the_unattributed_row_renders_and_is_excluded_from_the_people_tally` ·
`a_failed_acknowledgement_shows_a_retry_affordance`

---

## Task 6 — Wire into AppHeader, remove the sync chip

**Files:** modify `src/features/context/components/AppHeader.tsx`.

- Replace the current farm strip (`FarmContextSwitcher compact` + `SyncIndicator`) with
  `CanonicalStrip`, and render `WaitingDrawer` beneath it when open.
- The farm chip opens the **existing** `FarmSwitcherSheet` — reuse `FarmContextSwitcher`'s sheet
  rather than duplicating it. If that requires exposing the sheet, do it by lifting the existing
  component's open state, **not** by copying its markup.
- **Delete the `SyncIndicator` import and its render.** Leave `SyncIndicator.tsx`,
  `syncHonestyState.ts` and `useSyncStatus.ts` in place — other surfaces and tests use them, and the
  `NEEDS_FIX` state now feeds the drawer's `failedSendCount`.
- Keep `SyncStatusDrawer` reachable: if the chip was its only opener, wire the drawer's
  `failedSend` decision row to open it, so the conflict screen is not orphaned.

**Tests:** `the_header_renders_the_canonical_strip_on_every_route` ·
`the_header_no_longer_renders_the_sync_indicator` ·
`the_failed_send_row_can_still_open_the_sync_status_drawer`

**Verify also:** `npm run check:file-sizes`

---

## Task 7 — Home screen reorder

**Files:** modify `src/core/navigation/mainView.tsx` (741 lines — **remove only**), create
`src/features/oversight/components/CompactWeatherChip.tsx` + test if new markup is needed.

Per spec §4.2 and §5:

- Weather card → compact chip that expands on tap to the **existing** `WeatherWidget`.
- **Remove from above the selector:** the Daily Closure card, the yesterday-not-closed block, the
  "Daily Log" heading + owner chip.
- **Move below the selector:** the Running Cost card. The *"cost may be inaccurate — N unverified"*
  line is removed from there; it is already represented in the drawer.
- `CropSelector` invocation unchanged.
- Record bar pinned above the bottom navigation; grey until a plot is chosen.
- On crop select, scroll the plot tray into view (spec §5.2 — measured 767px vs 571px).

**Tests:** `the_plot_selector_renders_before_any_cost_or_closure_block` ·
`the_daily_closure_card_is_gone_from_the_log_view` ·
`the_weather_chip_expands_to_the_existing_widget`

**Verify:** `npm run typecheck && npm run lint && npm run check:file-sizes` and
`npx vitest run src/core/navigation`

---

## Final verification (controller runs this)

```
npm run typecheck
npm run lint
npm run check:file-sizes
npm run test
npm run dev          # founder preview
```

---

## Deferred, named — not silently dropped

| Deferred | Why | Revisit when |
|---|---|---|
| Durable server checkpoint (column + endpoint) | changes stored shape — server lane's territory (spec §8.1) | agreed with that lane |
| `serverModifiedAtUtc` reliability | their §P0.5 erases it on `batchSave()` | that fix lands; until then `boundaryApproximate` is surfaced |
| Expense-verification grant | no server-governed action exists to grant (spec §P-E) | finance gets a server home |
| Founder Marathi for spec §6.2 | founder is the only authority | founder supplies |
| Rebase onto `main` | labour branch not yet merged (spec §8.2) | labour merges |
