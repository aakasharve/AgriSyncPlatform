/**
 * AppHeader — Android Material top app bar
 * Solid surface, clean elevation, no glassmorphism
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { User2, Settings, Leaf, X } from 'lucide-react';
import { AppRoute, PageView, DetailedWeather } from '../../../types';
import PageToggle from '../../../shared/components/ui/PageToggle';
import { useLanguage } from '../../../i18n/LanguageContext';

import { FarmOperator } from '../../../domain/types/farm.types';
import type { DailyLog } from '../../../domain/types/log.types';
import { FarmSwitcherSheet } from './FarmContextSwitcher';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { useSyncQueueStatus, SyncStatusDrawer } from '../../sync';
import type { WeatherStatus } from '../../weather/useWeatherMonitor';

// Owner Oversight Loop (spec: owner-oversight-loop). Replaces the old
// `FarmContextSwitcher compact` pill + `SyncIndicator` chip (spec §2, §4.1).
// Task 11 (founder header restructure) — `CompactFarmChip` (row 1, beside
// the avatar) and `CompactWeatherChip` (row 1, before the gear) join
// `CanonicalStrip`, now row 2's waiting button alone. See each file's own
// header for why it moved.
import CanonicalStrip, { CompactFarmChip } from '../../oversight/components/CanonicalStrip';
import CompactWeatherChip from '../../oversight/components/CompactWeatherChip';
import WaitingDrawer from '../../oversight/components/WaitingDrawer';
import { buildOversightModel, type OversightDecision } from '../../oversight/oversightSelectors';
import { useOversightAcknowledgement } from '../../oversight/useOversightAcknowledgement';
import { LocalOversightAcknowledgementStore } from '../../oversight/LocalOversightAcknowledgementStore';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { systemClock } from '../../../core/domain/services/Clock';

// Same font-selection convention `CanonicalStrip.tsx`/`WaitingDrawer.tsx`
// already use (root CLAUDE.md Font Rules) — picks which of the two locked
// fonts a resolved string needs, never what text renders.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

interface AppHeaderProps {
  currentRoute: AppRoute;
  currentView: PageView;
  onNavigate: (route: AppRoute) => void;
  onViewChange: (view: PageView) => void;
  disabled?: boolean;
  activeOperator?: FarmOperator;
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

const AppHeader: React.FC<AppHeaderProps> = ({
  currentRoute,
  currentView,
  onNavigate,
  onViewChange,
  disabled,
  activeOperator,
  onVoiceTrigger,
  farmContext,
  oversightData,
  weather,
}) => {
  const { language, t } = useLanguage();
  const [isSyncDrawerOpen, setIsSyncDrawerOpen] = React.useState(false);
  const [isFarmSwitcherOpen, setIsFarmSwitcherOpen] = React.useState(false);
  const [isWaitingDrawerOpen, setIsWaitingDrawerOpen] = React.useState(false);
  const queueStatus = useSyncQueueStatus();

  const userColorClass = activeOperator ? getUserColor(activeOperator.name) : 'border-stone-200 text-stone-500 bg-stone-50';

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
  const farmName = currentFarm?.name ?? '';

  // PLOT COUNT (Ruling 12) — real when `AppContent.tsx` supplies
  // `oversightData` (it always does in production; see
  // `app/helpers/appContentOversightInputs.ts`). `farmContext` alone carries
  // only `MyFarmDto` (farmId/name/role/farmCode/subscription — no plot
  // count), so a caller that omits `oversightData` (every test but the
  // "real data" one) gets an honest 0, never a fabricated count (spec §P-F).
  const plotCount = oversightData?.plotCount ?? 0;

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
  const oversightModel = buildOversightModel({
    logs: oversightData?.logs ?? [],
    checkpointISO,
    nowISO: systemClock.nowISO(),
    operatorNameById: oversightData?.operatorNameById ?? {},
    unverifiedCount: oversightData?.unverifiedCount ?? 0,
    yesterdayNotClosed: oversightData?.yesterdayNotClosed ?? false,
    failedSendCount,
    approvalHolderName: oversightData?.approvalHolderName ?? null,
  });

  // Ruling 4 (plan ledger) — removing the sync chip orphans this header's
  // only opener of `SyncStatusDrawer`. `failedSend` is the one decision kind
  // that can ever be non-empty from AppHeader's reachable data (the two
  // inputs above are always 0/false), so it is the one wired open here;
  // `approval`/`dayNotClosed` never appear from this component and have no
  // reachable detail view to open yet.
  const handleOpenDecision = (decision: OversightDecision) => {
    if (decision.kind === 'failedSend') {
      setIsWaitingDrawerOpen(false);
      setIsSyncDrawerOpen(true);
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

  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur" style={{ boxShadow: '0 4px 12px -2px rgba(0,0,0,0.06), 0 1px 0 rgba(0,0,0,0.04)' }}>
      <div className="page-content pl-safe-area pr-safe-area flex min-h-[56px] items-center justify-between gap-1 py-2">

        {/* LEFT: Profile identity + farm chip. Task 11 (founder header
            restructure): "The farm switcher moves up beside the profile
            circle" — immediately right of the avatar, row 1. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onNavigate('profile')}
            disabled={disabled}
            className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center rounded-2xl px-1 py-1"
            title={activeOperator ? activeOperator.name : t('header.profile')}
          >
            <div className={`
               w-9 h-9 flex items-center justify-center rounded-full border-2 transition-all duration-150
               ${activeOperator ? userColorClass : 'border-transparent bg-stone-100 text-stone-400'}
            `}>
              <User2 size={18} strokeWidth={2.5} />
            </div>
            {activeOperator && (
              <span className="text-[9px] font-bold text-stone-600 max-w-[60px] truncate leading-tight mt-0.5">
                {activeOperator.name.split(' ')[0]}
              </span>
            )}
          </button>

          {farmContext && (
            <CompactFarmChip
              language={language}
              farmName={farmName}
              plotCount={plotCount}
              onOpenFarmSwitcher={() => setIsFarmSwitcherOpen(true)}
            />
          )}
        </div>

        {/* CENTER: Toggle (Visible on all core pages) */}
        <div className="min-w-0 flex-1 flex items-center justify-center">
          {['main', 'schedule', 'procurement', 'income', 'profile', 'settings', 'finance-manager', 'finance-ledger', 'finance-price-book', 'finance-review-inbox', 'finance-reports', 'finance-settings'].includes(currentRoute) ? (
            <div className="w-full max-w-[220px]">
              <PageToggle
                view={currentView}
                onChange={(v) => {
                  onViewChange(v);
                  if (currentRoute !== 'main') onNavigate('main');
                }}
                disabled={disabled}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                <Leaf size={16} fill="white" strokeWidth={0} />
              </div>
              <span className="font-bold text-lg text-stone-800">ShramSafal</span>
              {activeOperator && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-stone-100/50 border border-stone-200 rounded-full">
                  <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Owner</span>
                  <span className="text-xs font-bold text-stone-700">{activeOperator.name.split(' ')[0]}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Weather + Voice + Settings. Task 11 (founder header
            restructure): "The weather chip moves into row 1, in the dead
            space on the right, before the gear." */}
        <div className="flex shrink-0 items-center gap-1">
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

          <button
            onClick={() => onNavigate('settings')}
            disabled={disabled}
            className={`
              w-11 h-11 flex items-center justify-center rounded-full transition-colors duration-150
              ${currentRoute === 'settings'
                ? 'bg-emerald-100 text-emerald-700'
                : 'text-stone-500 active:bg-stone-100'}
            `}
          >
            <Settings size={22} strokeWidth={2} />
          </button>
        </div>

      </div>

      {/* Owner Oversight Loop (spec §2) — the canonical strip, now row 2:
          the waiting button alone, full width (Task 11 founder
          restructure). Canonical on every route by construction: AppHeader
          itself renders on every route, so no per-page wiring is needed
          (spec §2's own claim). */}
      {farmContext && (
        <div className="page-content pl-safe-area pr-safe-area border-t border-stone-100 bg-stone-50/60 py-1.5">
          <CanonicalStrip
            language={language}
            waitingCount={oversightModel.waitingCount}
            onToggleWaiting={() => setIsWaitingDrawerOpen(true)}
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

      {/* Waiting drawer (spec §3). `WaitingDrawer` is presentational only —
          no overlay chrome of its own (Task 5) — so this sheet follows the
          same bottom-sheet convention `SyncStatusDrawer` (below) and
          `FarmSwitcherSheet` already use in this app.

          PORTAL FIX (task-11 brief): this overlay used to render as plain
          JSX here, INSIDE `<header className="sticky ...">` below. A
          `position: sticky` ancestor creates a containing block that traps
          `position: fixed` descendants, so the dark backdrop covered only
          the ~139px sticky header box instead of the full viewport —
          diagnosed in the task-10 report, confirmed by computed-style
          inspection. `createPortal` to `document.body` is the same fix
          `FarmContextSwitcher.tsx`'s `FarmSwitcherSheet` already applies
          for exactly this reason; this makes AppHeader consistent with it
          rather than papering over the trap with z-index or margins. */}
      {isWaitingDrawerOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
          onClick={() => setIsWaitingDrawerOpen(false)}
        >
          <div
            data-testid="waiting-drawer-sheet"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-stone-50 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3.5 py-3">
              <span
                className="text-[15px] font-extrabold text-stone-800"
                style={fontStyleFor(resolveOversightString(language, 'waitingLabel'))}
              >
                {resolveOversightString(language, 'waitingLabel')}
              </span>
              <button
                type="button"
                onClick={() => setIsWaitingDrawerOpen(false)}
                data-testid="waiting-drawer-close"
                aria-label="Close"
                className="rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
              >
                <X size={16} />
              </button>
            </div>
            <WaitingDrawer
              language={language}
              model={oversightModel}
              status={acknowledgementStatus}
              onAcknowledge={() => { void acknowledge(); }}
              onOpenDecision={handleOpenDecision}
            />
          </div>
        </div>,
        document.body,
      )}

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
