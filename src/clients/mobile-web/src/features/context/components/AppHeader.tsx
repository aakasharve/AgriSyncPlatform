/**
 * AppHeader — Android Material top app bar
 * Solid surface, clean elevation, no glassmorphism
 */

import React from 'react';
import { User2 } from 'lucide-react';
import SetupHubIcon from './SetupHubIcon';
import { useWaitingVoiceNotes } from '../../voiceDiary/waiting/useWaitingVoiceNotes';
import { voiceNotesWords } from '../../voiceDiary/waiting/voiceNotesWords';
import { AppRoute, PageView, DetailedWeather } from '../../../types';
import { useLanguage } from '../../../i18n/LanguageContext';

import { FarmOperator } from '../../../domain/types/farm.types';
import type { DailyLog } from '../../../domain/types/log.types';
import { FarmSwitcherSheet } from './FarmContextSwitcher';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { useSyncQueueStatus, useUnqueueableLogCount, SyncStatusDrawer } from '../../sync';
import type { WeatherStatus } from '../../weather/useWeatherMonitor';

// Owner Oversight Loop (spec: owner-oversight-loop). Replaces the old
// `FarmContextSwitcher compact` pill + `SyncIndicator` chip (spec §2, §4.1).
// Task 11 (founder header restructure) moved the farm trigger into row 1,
// beside the avatar, and `CompactWeatherChip` beside it. Task 12
// (`G:\VALIDATION\farm-selector-contextual.html`) restyles the header into
// a floating card, replaces that farm trigger with `FarmIdentityElement`
// (label-or-button, decided by `farmCount`), restyles row 2's waiting
// button into an inset tray, and REMOVES the settings gear from row 1
// entirely (measured — see the row-1 JSX below) — the Setup Hub is the
// settings surface now, reachable from the profile avatar beside it.
// lane L4b (founder D-3 / D-40) — the strip is now three separate signals (`StripSignals`), not one ring.
import StripSignals from '../../oversight/components/StripSignals';
import { useApprovalQueue } from '../../approval/useApprovalQueue';
import { openApprovalReview } from '../../approval/openApprovalReview';
import FarmNameBoard from './FarmNameBoard';
import CompactWeatherChip from '../../oversight/components/CompactWeatherChip';
// Task 14, change 9 — the waiting-drawer sheet's OWN chrome (backdrop,
// title bar, close button) is now `OversightOverlay`, a distinct component
// boundary, not inline JSX in this file. `AppHeader` owns only `isOpen` and
// the data the overlay needs — the same "trigger here, surface elsewhere"
// shape `FarmSwitcherSheet`/`SyncStatusDrawer` already have below.
import OversightOverlay from '../../oversight/components/OversightOverlay';
// Task 13 — replaces the `PageToggle` segmented pill that used to sit here
// in row 1's centre (see `CanonicalStrip.tsx`'s header comment for the row
// diagram this moved to). `PageToggle` itself is left in place, unused by
// this file — its own module has no other importer, but deleting a
// still-compiling, still-exported component is a separate call from this
// task's scope.
import OversightNavCards from '../../oversight/components/OversightNavCards';
import { useStoredAccessScopes } from '../../../core/session/storedFarmScope';
import { scopeForFarm } from '../../../infrastructure/storage/accessScopeStore';
import { buildOversightModel, type OversightDecision } from '../../oversight/oversightSelectors';
// Findings F2/F3 — the two cross-tree "open this surface" hops. See that
// module's header for why a window event and not a prop path.
import { OPEN_WAITING_DRAWER_EVENT } from '../../oversight/oversightNavigationEvents';
import { useOpenSurfaceRequest } from '../../oversight/useOpenSurfaceRequest';
import { useOversightAcknowledgement } from '../../oversight/useOversightAcknowledgement';
import { LocalOversightAcknowledgementStore } from '../../../infrastructure/storage/LocalOversightAcknowledgementStore';
import { systemClock } from '../../../core/domain/services/Clock';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';

interface AppHeaderProps {
  currentRoute: AppRoute;
  currentView: PageView;
  onNavigate: (route: AppRoute) => void;
  onViewChange: (view: PageView) => void;
  disabled?: boolean;
  /** No longer drawn here (2026-10-25): its colour ring on the Setup Hub clashed with the nameboard's brass and green. Kept so callers need not change. */
  activeOperator?: FarmOperator;
  /** Show the page switcher ONLY on the three main tabs, never on a place like खरेदी or the Setup Hub (PLR-D9 N1; the real app passes it since PLR-D10 WP-6). Default: the existing route list. */
  navCardsOnlyOnMain?: boolean;
  /** Pages the page switcher leaves out for this person (preview: a worker gets no तुलना). Default: none. */
  hiddenViews?: readonly PageView[];
  onVoiceTrigger?: () => void;
  /** Phase 6 — farm context strip below the main bar. Omit to hide. */
  farmContext?: {
    farms: MyFarmDto[];
    currentFarmId: string | null;
    onSwitchFarm: (farmId: string) => void;
    onCreateFarm: () => void;
    onJoinViaQr: () => void;
  };
  /**
   * spec: owner-oversight-loop (Ruling 12) — the narrow slice of
   * `AppFeatureProviders`-scoped state `buildOversightModel` needs, computed
   * by `AppContent.tsx` (`app/helpers/appContentOversightInputs.ts`) because
   * `AppHeader` itself renders OUTSIDE that provider tree and cannot reach it
   * any other way (props only — no second `useAppData()`, no moving
   * `AppHeader` inside the tree). Omit entirely (as every test but
   * `AppHeader.oversight.test.tsx`'s "real data" case does) to fall back to
   * the same honest zeros/empties this component used before this prop
   * existed — never a silent default that looks like real data.
   */
  oversightData?: {
    /** Already the FULL per-user history — see this file's own comment
     * above `buildOversightModel`'s call for the multi-farm caveat this
     * does NOT solve. */
    logs: DailyLog[];
    operatorNameById: Record<string, string>;
    plotCount: number;
    unverifiedCount: number;
    yesterdayNotClosed: boolean;
    /** Always `null` today — see the comment above this component's
     * `oversightModel` construction for why naming a delegate is not yet
     * something this task can honestly do. */
    approvalHolderName: string | null;
    /**
     * `useAppData.dataLoaded` — whether the arrays above are a MEASURED
     * empty or merely not loaded yet (finding F7(a)). Required, so `tsc`
     * names every construction site rather than letting one default it to
     * `true` by omission. Combined with `useSyncQueueStatus.hasLoaded`
     * below into the single `dataResolved` flag `CanonicalStrip` needs to
     * know whether it may claim that all work is complete.
     */
    dataLoaded: boolean;
    /**
     * lane L4b (founder D-1 / D-40 §2) — the लक्ष द्या preview the strip shows: the same list as its page and the
     * bottom bar's count, summarised in his language. Omit to show no attention signal.
     */
    attention?: { total: number; summary: string };
  };
  /**
   * Weather chip data for row 1 (Task 11 — founder header restructure: the
   * weather chip moves out of `mainView.tsx`'s home screen and into this
   * header, "in the dead space on the right, before the gear"). Omit
   * entirely to render `CompactWeatherChip`'s compact trigger in its honest
   * default ("no data yet") state — never a fabricated reading.
   * `WeatherWidget` itself (mounted on tap, through `CompactWeatherChip`'s
   * own bottom-sheet portal) owns every loading/error/no-location state;
   * this prop only forwards what the caller already has.
   */
  weather?: {
    data?: DetailedWeather;
    status?: WeatherStatus;
    boundaryUnset?: boolean;
    onRetry?: () => void;
  };
}

/**
 * Deterministic name -> Tailwind colour-triple hash (border/text/bg), so the
 * same person renders in the same colour everywhere in the app — the profile
 * avatar here, and the oversight drawer's person pins
 * (`features/oversight/components/WaitingDrawer.tsx`, spec
 * `docs/superpowers/specs/2026-08-15-owner-oversight-loop-design.md` §3:
 * "coloured pin ... from the app's existing `getUserColor`"). Exported for
 * that reuse — do not fork a second copy of this hash or palette.
 */
export const getUserColor = (name: string) => {
  const colors = [
    'border-emerald-500 text-emerald-600 bg-emerald-50',
    'border-blue-500 text-blue-600 bg-blue-50',
    'border-purple-500 text-purple-600 bg-purple-50',
    'border-amber-500 text-amber-600 bg-amber-50',
    'border-rose-500 text-rose-600 bg-rose-50',
    'border-cyan-500 text-cyan-600 bg-cyan-50',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// The exact route list `PageToggle` used to be gated on, in row 1's centre
// (Task 13 moved the nav itself into `OversightNavCards`, its own row below
// row 1 — see `CanonicalStrip.tsx`'s header comment for the row diagram).
// Named once so row 1's now-empty centre and the new nav-cards row can never
// drift from each other.
const PAGE_TOGGLE_ROUTES: readonly AppRoute[] = [
  'main', 'schedule', 'procurement', 'income', 'profile', 'settings',
  'finance-manager', 'finance-ledger', 'finance-price-book',
  'finance-review-inbox', 'finance-reports',
];

const AppHeader: React.FC<AppHeaderProps> = ({
  currentRoute,
  currentView,
  onNavigate,
  onViewChange,
  disabled,
  navCardsOnlyOnMain = false,
  hiddenViews,
  onVoiceTrigger,
  farmContext,
  oversightData,
  weather,
}) => {
  const { language, t } = useLanguage();
  const [isSyncDrawerOpen, setIsSyncDrawerOpen] = React.useState(false);
  const [isFarmSwitcherOpen, setIsFarmSwitcherOpen] = React.useState(false);
  const [isWaitingDrawerOpen, setIsWaitingDrawerOpen] = React.useState(false);
  // spec: 2026-08-25-prod-cutover-waves — hardware Back closes these first.
  // (SyncStatusDrawer registers itself.)
  useBackDismiss(isFarmSwitcherOpen, () => setIsFarmSwitcherOpen(false));
  useBackDismiss(isWaitingDrawerOpen, () => setIsWaitingDrawerOpen(false));
  const queueStatus = useSyncQueueStatus();

  // FINDING F6 — the one class of dropped record `queueStatus` structurally
  // CANNOT see. `resolveSyncTarget` refused these logs, so no mutation row,
  // no outbox row, nothing was ever written; `useSyncQueueStatus` polls
  // Dexie tables and every one of its counts is a table count, so all of
  // them read 0 for a record that was silently dropped. The fact lives only
  // in `features/sync/status/unqueueableLogs.ts`, which this hook reads.
  // Subscribed, not polled — see that hook's own header.
  const unqueueableCount = useUnqueueableLogCount();

  // FINDING F3 — the waiting drawer is the destination "Close Day" and the
  // `?nudge=close-day` notification deep-link now land on (spec §4.2 routes
  // the Daily Closure card here). Both dispatchers sit inside `AppRouter`,
  // on the other side of `AppContent.tsx`'s provider boundary, with no prop
  // path to this component's local `isWaitingDrawerOpen` — hence the event.
  useOpenSurfaceRequest(OPEN_WAITING_DRAWER_EVENT, () => setIsWaitingDrawerOpen(true));

  const [hubTap, setHubTap] = React.useState(0);
  const { notes: waitingVoice } = useWaitingVoiceNotes();

  // OVERSIGHT LOOP (spec §2/§3) — the awareness checkpoint is read/written
  // through the local adapter directly, unconditionally, the same way
  // `useSyncQueueStatus` above is already called regardless of whether
  // `farmContext` is present; only the RENDER below is gated on
  // `farmContext`. `farmId` falls back to `''` before any farm is known —
  // harmless (the port just reads/writes a key nothing renders yet).
  const currentFarmId = farmContext?.currentFarmId ?? '';
  const { checkpointISO, status: acknowledgementStatus, acknowledge } =
    useOversightAcknowledgement(currentFarmId, LocalOversightAcknowledgementStore);

  const currentFarm = farmContext?.farms.find((f) => f.farmId === farmContext.currentFarmId)
    ?? farmContext?.farms[0];
  // spec: plr-d10 lane MU-4 — a person who covers chosen plots on the open farm sees "his plots", never "the whole farm".
  const storedScopes = useStoredAccessScopes();
  const plotsOnly = scopeForFarm(storedScopes, currentFarmId)?.plotScope === 'ChosenPlots';
  const farmName = currentFarm?.name ?? '';
  // `plotCount` was derived here for `FarmIdentityElement`'s plot line. That
  // element left row 1 with the founder's 2026-08-30 nameboard ruling — the
  // count is not a farm IDENTITY, and he removed it from this row. The number
  // itself is untouched and still reaches the farm switcher, which is the
  // surface that legitimately compares farms by size.

  // `failedSendCount` mirrors exactly what the deleted `SyncIndicator` chip
  // used to sum for its own red badge (`queueStatus.failedCount +
  // queueStatus.failedUploads`, see the removed JSX below in history) — and
  // those two terms are exactly `syncHonestyState.ts`'s two `NEEDS_FIX`
  // conditions (a durable/capped mutation row; a capped upload row). This is
  // how `NEEDS_FIX` keeps reaching the farmer after the chip is deleted
  // (spec §4.1's binding constraint). Always real — `useSyncQueueStatus` is
  // called directly in this component, no prop needed.
  const failedSendCount = queueStatus.failedCount + queueStatus.failedUploads;

  // The rest of `buildOversightModel`'s inputs (Ruling 12) — real per-farm
  // logs, resolved operator names, the outstanding-approval count and
  // yesterday's close state — now come from `oversightData`, computed by
  // `AppContent.tsx` where `AppFeatureProviders`-scoped state IS in scope
  // (`app/helpers/appContentOversightInputs.ts` — read its header for the
  // multi-farm-scoping caveat it does NOT solve). `approvalHolderName` stays
  // `null` even when `oversightData` is supplied: naming a specific person
  // as "holds this decision" requires a verified, server-governed
  // permission grant (spec §P-E), which this task has not confirmed exists
  // — asserting a wrong name would be a worse claim than naming no one.
  // A caller that omits `oversightData` entirely falls back to the same
  // honest empty/zero inputs this component used before this prop existed.
  const approvalCount = useApprovalQueue(currentFarmId || null).count;
  const oversightModel = buildOversightModel({
    logs: oversightData?.logs ?? [],
    checkpointISO,
    nowISO: systemClock.nowISO(),
    operatorNameById: oversightData?.operatorNameById ?? {},
    // lane L4b (D-40 §1) — the drawer's "N कामे तपासायची आहेत" is the ONE server count for this farm (the strip's
    // "मंजुरीसाठी N"), never the phone's own unscoped tally; nothing when he may not confirm or it is unread.
    unverifiedCount: approvalCount ?? 0,
    yesterdayNotClosed: oversightData?.yesterdayNotClosed ?? false,
    failedSendCount,
    // FINDING F6 — no `?? 0` and no prop: this is read directly from the
    // hook above, so it is always the real session count. It is a SEPARATE
    // input from `failedSendCount` and is never summed into it — see
    // `OversightDecision['kind']`'s note for why the two facts must not
    // merge.
    unqueueableCount,
    approvalHolderName: oversightData?.approvalHolderName ?? null,
  });

  // lane L4b — the strip no longer claims "all work is complete" from anything (D-3 / D-40): the F7(a) gate that
  // decided when it might is gone with the claim. Each signal states only what it read.

  // FINDING F2 — EVERY TAPPABLE DECISION ROW LANDS SOMEWHERE REAL.
  //
  // What used to stand here claimed `failedSend` was "the one decision kind
  // that can ever be non-empty from AppHeader's reachable data (the two
  // inputs above are always 0/false)". That was true only before Ruling 12.
  // It is false now, and provably so twenty lines up: `buildOversightModel`
  // is fed `oversightData.unverifiedCount` and `oversightData.yesterdayNotClosed`,
  // which `AppContent.tsx` fills from `buildOversightHeaderInputs(...)` —
  // real counts off `data.history`/`data.crops`/`data.plannedTasks`. So
  // `oversightSelectors.ts` really does push `approval` and `dayNotClosed`
  // rows, `WaitingDrawer` really does render them as `<button>`s with a
  // chevron, and this handler used to ignore both. An owner saw
  // "६ कामे तपासायची आहेत", tapped the chevron, and nothing happened.
  //
  // Spec §3: "Tapping any row opens the existing filtered detail view."
  // All four kinds now do — none is invented for this fix, each is a
  // surface that already exists and already works:
  //
  //   failedSend   -> `SyncStatusDrawer`, this header's own sheet. Deleting
  //                   the sync chip (spec §4.1) orphaned its only opener;
  //                   this row is it (Ruling 4). Unchanged by F2 and by F6.
  //   unqueueable  -> the same sheet, whose unqueueable block was the OTHER
  //                   thing the deleted chip used to reach (finding F6).
  //   approval     -> `ReviewInboxSheet` — the app's existing batch
  //                   approve/dispute surface, mounted by `AppRouter`
  //                   (`core/navigation/globalSheets.tsx`). `AppHeader`
  //                   renders OUTSIDE that provider tree, so the hop goes
  //                   through `requestOpenReviewInbox()`; see
  //                   `oversightNavigationEvents.ts` for why a window event
  //                   and not a prop. Approving happens THERE — this header
  //                   never approves (spec §P-A / §3).
  //   dayNotClosed -> the Reflect view. `dayState.ts:380` derives
  //                   `isClosed` from exactly two terms (pending planned
  //                   tasks, unverified entries) and `ReflectPage` is the
  //                   one screen that shows and can resolve both
  //                   (`onUpdateTask` + `onVerifyLog`, see
  //                   `core/navigation/mainView.tsx`'s `renderReflectView`).
  //                   It is also the destination the deleted "Yesterday not
  //                   fully closed" block's own "Review summary" button used
  //                   before commit 0e4ad118 — not a new idea, the same one.
  //
  // A DELEGATED approval never reaches this function at all: `WaitingDrawer`
  // renders that row as a plain <div> with no affordance (spec §3), so there
  // is no kind left that renders tappable without a destination.
  const handleOpenDecision = (decision: OversightDecision) => {
    setIsWaitingDrawerOpen(false);
    switch (decision.kind) {
      case 'failedSend':
        setIsSyncDrawerOpen(true);
        return;
      case 'unqueueable':
        // FINDING F6 — the SAME sheet, for a different reason, and this row
        // is now its only other opener. `SyncStatusDrawer` already renders a
        // dedicated block for exactly this class of record ("N records will
        // not reach your farm records / Saved on this phone. Nothing will
        // send it.") — that block has been correct since finding F-2 and was
        // simply unreachable: the chip that used to open the sheet on
        // `ON_PHONE` is deleted (spec §4.1), and these records raise no
        // `NEEDS_FIX`, so they never produced a `failedSend` row either. A
        // farmer whose records were dropped could not reach the one screen
        // that says so. This is that route.
        setIsSyncDrawerOpen(true);
        return;
      case 'approval':
        openApprovalReview();
        return;
      case 'dayNotClosed':
        onViewChange('reflect');
        if (currentRoute !== 'main') onNavigate('main');
        return;
    }
  };

  // Weather's own "add location" / "set boundary" affordances (Task 11) —
  // the same single-handoff pattern `mainView.tsx`'s now-removed local
  // `openBoundary` used: flag it in sessionStorage, then route to Profile,
  // where the boundary drawer auto-opens (`ProfilePage.tsx` reads + clears
  // this same key). AppHeader already owns `onNavigate`, so this needs no
  // new prop from either caller.
  const openWeatherBoundary = () => {
    window.sessionStorage.setItem('open_farm_boundary', '1');
    onNavigate('profile');
  };

  // Task 12 — `farmContext.farms` is the real list `AppContent.tsx` already
  // fetches (`getMyFarms()`); this is the ONLY place `farmCount` is
  // derived, never a literal, so `FarmIdentityElement`'s label-vs-button
  // split always reflects the real account.
  const farmCount = farmContext?.farms.length ?? 0;

  // Task 13 — same condition `PageToggle` used to gate row 1's centre on;
  // now decides whether the `OversightNavCards` row renders at all (its own
  // row below row 1, not inside it — see `PAGE_TOGGLE_ROUTES`'s comment).
  const showNavCards = navCardsOnlyOnMain ? currentRoute === 'main' : PAGE_TOGGLE_ROUTES.includes(currentRoute);

  // FOUNDER RULING 2026-08-31 — the oversight tray is a LOG-DESK instrument,
  // not a global banner. It rode on `farmContext` alone, so it followed the
  // farmer onto every route including the Setup Hub, where "5 things need
  // your attention" is noise he cannot act on from that screen. It now shows
  // where the work it refers to is actually done: the log desk and reflect.
  //
  // This hides the TRAY only. The farm identity element is a separate mount
  // (`FarmNameBoard`, row 1 above — formerly `FarmIdentityElement`, replaced
  // by the 2026-08-30 nameboard ruling) and still renders on every route —
  // the farmer never loses sight of which farm he is looking at.
  const showOversightStrip = currentRoute === 'main'
      && (currentView === 'log' || currentView === 'reflect');

  // FOUNDER RULING 2026-08-27 — THE STRIP'S COUNT NO LONGER LEAVES THIS FILE,
  // BECAUSE NOTHING OUTSIDE IT MAKES A CLAIM ABOUT IT ANY MORE.
  //
  // Ruling A2 (2026-08-26) published `oversightModel.waitingCount` through
  // `oversightWaitingSignal.ts` so the home screen's `DailyLoopHero` could
  // refuse to say "काही बाकी नाही" underneath a strip reporting four waiting
  // rows. On 2026-08-27 the founder looked at the state where that gate PASSES
  // and ruled the duplication itself out: the hero's settled line is deleted at
  // source, so there is no second all-clear surface left to gate. The signal
  // module and its two effects went with it — a cross-subtree store with no
  // consumer is scaffolding, not a guard.
  //
  // The property that mattered is not weakened, it is stronger: `waitingCount`
  // now reaches exactly one renderer, `<CanonicalStrip>` below, which draws
  // BOTH its ring number and its sentence from that single prop on this single
  // render. There is no longer a second reader that could drift for a
  // `useSyncQueueStatus` poll interval, because there is no second reader.
  // `features/oversight/__tests__/oneAllClearSurface.test.tsx` mounts this
  // header above the real hero and holds that.

  return (
    // Task 12 (`G:\VALIDATION\farm-selector-contextual.html`'s `.hdr` rule):
    // "the header becomes a card" — a rounded bottom + a soft downward
    // shadow so it reads as a surface floating over content, not a stacked
    // band. Still sticky. The old flat `border-b` is gone — a floating card
    // doesn't carry a hairline seam, only its own shadow.
    <header className="sticky top-0 z-50 rounded-b-3xl bg-white/95 backdrop-blur" style={{ boxShadow: '0 8px 22px -12px rgba(28,25,23,0.34)' }}>
      <div className="page-content pl-safe-area pr-safe-area flex min-h-[56px] items-center justify-between gap-2.5 py-2">

        {/* LEFT — the Setup Hub. Founder ruling 2026-08-30: this button used
            to be labelled `activeOperator.name.split(' ')[0]` — the FARMER's
            own first name — sitting 40px from the FARM's name. The same word
            twice, meaning two different things. It now carries the name of the
            surface it actually opens (`profile.setupHub`), and the plot count
            that used to ride beside it is gone from this row entirely: it
            lives in the farm switcher the board itself opens. */}
        {/* self-stretch + justify-center: the round button and its label sit as one group on the nameboard's centre line. */}
        <div className="flex shrink-0 items-stretch gap-2 self-stretch">
          <button
            onClick={() => { setHubTap(n => n + 1); onNavigate('profile'); }}
            disabled={disabled}
            data-testid="header-setup-hub"
            className={`flex min-h-[44px] min-w-[44px] flex-col items-center rounded-2xl px-0.5 py-0 justify-center gap-1`}
            title={t('profile.setupHub')}
          >
            {/* Founder, 2026-10-25: the Setup Hub's own picture, as a small sibling of the nameboard, with a tap effect (SetupHubIcon). */}
            {/* Lane OF (founder D-59) — the number of recordings not saved yet (THE one reader, as the आवाज नोंदी row). */}
            <SetupHubIcon tap={hubTap} count={waitingVoice.length} countLabel={voiceNotesWords(language).badge(waitingVoice.length)} />
            <span
              className="max-w-[60px] whitespace-nowrap text-center text-[10px] font-extrabold leading-[12px] text-emerald-900"
              style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
            >
              {t('profile.setupHub')}
            </span>
          </button>
        </div>

        {/* CENTRE — the farm's own nameboard, and the whole of row 1's middle.
            The Shram Safal lockup that used to sit here is NOT restored: the
            founder ruled the farm is the hero of this screen and the brand
            already appears on the app icon, the splash and the login. It
            survives on the board as the shield mark and the subtitle line,
            which name the tool without claiming a credential for the farm.
            See `FarmNameBoard.tsx` for why that distinction was load-bearing. */}
        {farmContext ? (
          <FarmNameBoard
            farmName={farmName}
            language={language}
            disabled={disabled}
            /* Task 12's rule, carried over: only a real second farm turns the
               board into a control. See the prop doc in `FarmNameBoard.tsx`. */
            canSwitch={farmCount > 1}
            onOpenFarmSwitcher={() => setIsFarmSwitcherOpen(true)}
          />
        ) : (
          <div className="min-w-0 flex-1" />
        )}


        {/* RIGHT: Weather + Voice. Task 11 moved the weather chip into row
            1 here. Task 12 REMOVES the settings gear that used to follow
            it — MEASURED reason: with five row-1 elements the row totalled
            410 of 411px (zero slack) and the centre toggle was crushed to
            110px. The Setup Hub is the settings surface now, and it is
            already reachable from the profile avatar at the other end of
            this row. */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Phase 4: Global Voice Trigger (Moved to Header) */}
          {onVoiceTrigger && !disabled && (
            <button
              onClick={onVoiceTrigger}
              className="w-11 h-11 flex items-center justify-center rounded-full text-emerald-600 bg-emerald-50 active:bg-emerald-100 transition-colors duration-150"
              title={t('nav.voice')}
            >
              <User2 size={0} className="hidden" /> {/* Hack to keep import valid if unused, but we use Lucide icons */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          )}

          <CompactWeatherChip
            variant="compact"
            data={weather?.data}
            status={weather?.status}
            boundaryUnset={weather?.boundaryUnset}
            onRetry={weather?.onRetry}
            onAddLocation={openWeatherBoundary}
            onOpenBoundary={openWeatherBoundary}
          />
        </div>

      </div>

      {/* Task 13 (founder reference image + his own Marathi table) — the
          nav-cards row. Renders "in its own row below the header, not
          inside it" (the founder's own words): a sibling of row 1's div
          above, not a child of it, so the three cards never share row 1's
          flex layout with the avatar/farm/weather elements. Same route
          gate `PageToggle` used to render on (`showNavCards`), so every
          page that could reach Log/Reflect/Compare before still can. */}
      {showNavCards && (
        <div className="mx-auto w-full max-w-[480px] px-3 pb-2.5 md:max-w-[600px] xl:max-w-[640px]">
          <OversightNavCards
            language={language}
            view={currentView}
            onChange={(v) => {
              onViewChange(v);
              if (currentRoute !== 'main') onNavigate('main');
            }}
            disabled={disabled}
            hiddenViews={hiddenViews}
            plotsOnly={plotsOnly}
          />
        </div>
      )}

      {/* Owner Oversight Loop (spec §2) — the canonical strip, row 2: the
          waiting button alone, full width (Task 11 founder restructure).
          Canonical on every route by construction: AppHeader itself
          renders on every route, so no per-page wiring is needed (spec
          §2's own claim).
          Task 12 — the wrapper is now an INSET TRAY container, not a
          full-bleed banded strip: no more `border-t`/`bg-stone-50/60`
          seam, just ~12px of horizontal inset + bottom padding so the
          tray (`CanonicalStrip`'s own rounded/shadowed card) floats free
          of the header's edges. Mirrors `.page-content`'s own
          breakpoints (480/600/640) so it stays concentric with row 1
          above it, but with Tailwind's `px-3` (12px) instead of
          `.page-content`'s hardcoded 16px — deliberate, not a rounding
          error, per the task-12 brief's "inset ~12px from both edges". */}
      {farmContext && showOversightStrip && (
        <div className="mx-auto w-full max-w-[480px] px-3 pb-3 md:max-w-[600px] xl:max-w-[640px]">
          <StripSignals
            language={language}
            farmId={currentFarmId || null}
            // The rows that really need him: the same two terms the deleted sync chip summed, plus the records
            // nothing will send (finding F6). Ordinary offline is the separate "पाठवणे बाकी" signal.
            needsYouCount={failedSendCount + unqueueableCount}
            attention={oversightData?.attention}
            onOpenSync={() => setIsSyncDrawerOpen(true)}
            onOpenAttention={() => onNavigate('attention')}
            onOpenWaiting={() => setIsWaitingDrawerOpen(true)}
          />
        </div>
      )}

      {/* Farm switcher — reuses the EXISTING `FarmSwitcherSheet` unchanged
          (spec §2.1: "Only the trigger's shell changes"). AppHeader now owns
          the open/close state that `FarmContextSwitcher`'s own pill used to
          hold internally for this — lifted, not copied (task-6 brief). */}
      {isFarmSwitcherOpen && farmContext && (
        <FarmSwitcherSheet
          farms={farmContext.farms}
          currentFarmId={currentFarm?.farmId ?? ''}
          onClose={() => setIsFarmSwitcherOpen(false)}
          onSwitch={(farmId) => {
            farmContext.onSwitchFarm(farmId);
            setIsFarmSwitcherOpen(false);
          }}
          onCreateFarm={() => {
            setIsFarmSwitcherOpen(false);
            farmContext.onCreateFarm();
          }}
          onJoinViaQr={() => {
            setIsFarmSwitcherOpen(false);
            farmContext.onJoinViaQr();
          }}
        />
      )}

      {/* Task 14, change 9 — the oversight "page" itself, as a distinct
          overlay/sheet, NOT a route change (see `OversightOverlay.tsx`'s
          own header for the founder's own reasoning and every invariant
          this preserves — one back control, no route change, the log
          screen underneath never unmounted). */}
      <OversightOverlay
        isOpen={isWaitingDrawerOpen}
        language={language}
        model={oversightModel}
        status={acknowledgementStatus}
        onAcknowledge={() => { void acknowledge(); }}
        onOpenDecision={handleOpenDecision}
        onClose={() => setIsWaitingDrawerOpen(false)}
        // The freshness sentence moved OFF the strip and into this overlay
        // (founder ruling 2026-08-29 — the bar is two lines). Same source the
        // strip was fed, so the two can never disagree.
        lastSyncAt={queueStatus.lastSyncAt}
      />

      <SyncStatusDrawer
        isOpen={isSyncDrawerOpen}
        onClose={() => setIsSyncDrawerOpen(false)}
        onOpenConflicts={() => {
          // A durable rejection cannot be re-sent unchanged; the only surface
          // that can clear it is OfflineConflictPage. Close the sheet first, or
          // the farmer lands on the fix screen behind a black overlay.
          setIsSyncDrawerOpen(false);
          onNavigate('offline-conflicts');
        }}
      />
    </header>
  );
};

export default AppHeader;
