// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// The "main" route's three sub-views (reflect / compare / log) were the
// largest piece of AppRouter. Lifted verbatim into render functions so the
// orchestrator stays small.

import React from 'react';
import {
    AgriLogResponse, DailyLog
} from '../../types';
import type { TodayCounts } from '../../domain/types/farm.types';
import CropSelector, { CropSymbol } from '../../features/context/components/CropSelector';
import InputMethodToggle from '../../shared/components/ui/InputMethodToggle';
import AudioRecorder from '../../features/voice/components/AudioRecorder';
import AudioRecorderStreaming from '../../features/voice/components/AudioRecorderStreaming';
import LiveCaption from '../../features/voice/components/LiveCaption';
import { DEFAULT_VOICE_CONFIG } from '../../infrastructure/voice/types';
import ManualEntry from '../../features/logs/components/ManualEntry';
import DailyLogCard from '../../features/logs/components/DailyLogCard';
// `ArrowLeft` left with `LabourLogBanner`, its only consumer. `Users` stays —
// the success card's bucket chips still use it.
import { Leaf, Droplets, Users, Package, Tractor, Sprout } from 'lucide-react';
import { getSegmentVisual } from '../../shared/utils/uiUtils';
import { getDateKey } from '../domain/services/DateKeyService';
import { buildTimelineEntries } from '../../services/transcriptTimelineService';
import { formatCurrencyINR } from '../../shared/utils/dayState';
import { getCropTheme } from '../../shared/utils/colorTheme';
import { FEATURE_FLAGS } from '../../app/featureFlags';
// `MeterDisplay` is NOT imported here any more. main rendered it directly on the
// success card; dfes-companion moved that score block INTO
// `LedgerRecognitionPanel` (via `DayUnderstandingCard`), and
// `mainView.dayUnderstandingOrder.test.tsx` asserts it renders EXACTLY ONCE with
// the real panel mounted — so a second, direct render here would be the copy that
// test exists to forbid.
// Only the SUMMARY is needed here — `mainView` hands it to `ManualEntry`,
// which owns the decision to render the panel (it is the component that knows
// whether the farmer's context is the whole farm).
import { getFarmWideDaySummary } from '../../app/helpers/appContentDailyCounts';
// spec: owner-oversight-loop (Task 13, changes 3 + 5) — real components
// (not inlined here), because both call `useLanguage()` internally and this
// file's render functions are plain functions, not components — see
// `mainViewComponents.tsx`'s header for why that hook rule forces the split.
import SathiGuideCard from '../../features/oversight/components/SathiGuideCard';
import { toAttendanceOnlyDraft } from '../../features/logs/attendanceDraft';
import HelpBar from '../../features/oversight/components/HelpBar';
import {
    LabourLogBanner,
    NotQueuedForServerBadge,
    SavedLocallyHeadline,
    // main's is the processing <h3> LINE; dfes's (imported above) is
    // the full video-character screen. Different components, one name.
    ShramSathiUnderstanding as ShramSathiUnderstandingLine,
} from './mainViewComponents';
import { getCarriedTasks } from '../../shared/utils/dayState';
import { LedgerRecognitionPanel } from '../../features/logs/components/LedgerRecognitionPanel';
import {
    stashPendingQuestionAnswer, abandonPendingQuestionAnswer, readPendingQuestionAnswer,
} from '../../features/logs/services/pendingQuestionAnswer';
import VoiceSavedReassurance from '../../features/logs/components/shramsathi/VoiceSavedReassurance';
import DailyLoopHero from '../../features/logs/components/shramsathi/DailyLoopHero';
import DailyLoopClarity from '../../features/logs/components/shramsathi/DailyLoopClarity';
import DailyLoopInsight from '../../features/logs/components/shramsathi/DailyLoopInsight';
import DayUnderstandingCard from '../../features/logs/components/shramsathi/DayUnderstandingCard';
import SathiSaidCard from '../../features/logs/components/shramsathi/SathiSaidCard';
import SavedScreenBack from '../../features/logs/components/shramsathi/SavedScreenBack';
import SurfaceSection from '../../features/logs/components/shramsathi/SurfaceSection';
import { buildDailyInsight } from '../../features/logs/intelligence/buildDailyInsight';
import { ShramSathiUnderstanding } from '../../features/logs/components/shramsathi/ShramSathiUnderstanding';
import { findConfirmableTaskCloses, type TaskCloseCandidate } from '../../features/logs/services/taskAutoClose';
import TaskCloseConfirm from '../../features/logs/components/shramsathi/TaskCloseConfirm';
import { logger } from '../../infrastructure/observability/Logger';

import { AppRouterContext } from './routeContext';
import { ReflectPage, ComparePage } from './lazyComponents';
import { DISPLAY_TIME_ZONE } from '../../shared/utils/displayTime';
import {
    formatLogTime,
    getPrimaryWorkDone,
    getSummaryLines,
    getVerificationPresentation
} from './helpers';

/*
 * The four components this module renders live in `./mainViewComponents`.
 *
 * They were moved there to keep this file under the 800-line `check:file-sizes`
 * cap once the farm-wide panel and the two hook-bearing headlines landed. The
 * move is VERBATIM — same DOM, same component identities — so the viewport
 * measurements taken against this screen still hold.
 *
 * `NotQueuedForServerBadge` and `LabourLogBanner` are RE-EXPORTED below because
 * two test files import them from this module, and `labour-log-banner.test.tsx`
 * compares `el.type === LabourLogBanner`. A second copy would satisfy the
 * import and silently fail that identity check.
 */
export { NotQueuedForServerBadge, LabourLogBanner } from './mainViewComponents';

// Task 5 (spec: dfes-companion-2026-07-11) — thin per-candidate wrapper so
// नाही ("hide it for this render") can use real React state. `renderLogView`
// below is a plain function invoked directly inside AppRouter's JSX (see
// AppRouter.tsx `{renderLogView(ctx)}`), not mounted as its own component, so
// a hook can't live directly in its body — this small component gives the
// dismiss toggle its own fiber. Keyed by candidate.task.id at the call site
// so switching to a different top candidate resets the dismissal.
const TaskCloseConfirmSlot: React.FC<{
    candidate: TaskCloseCandidate;
    onConfirm: (candidate: TaskCloseCandidate) => void;
}> = ({ candidate, onConfirm }) => {
    const [dismissed, setDismissed] = React.useState(false);
    if (dismissed) return null;
    return (
        <TaskCloseConfirm
            candidate={candidate}
            onConfirm={() => onConfirm(candidate)}
            onDismiss={() => setDismissed(true)}
        />
    );
};

export const renderReflectView = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'main' || ctx.mainView !== 'reflect') return null;
    return (
        <ReflectPage
            history={ctx.history}
            crops={ctx.crops}
            ledgerDefaults={ctx.ledgerDefaults}
            tasks={ctx.plannedTasks}
            onUpdateTask={(task) => ctx.handleUpdateTask(task.id, task)}
            onAddTask={() => ctx.setShowTaskCreationSheet(true)}
            onEditLog={(log: DailyLog) => {
                ctx.setMainView('log');
                const context = log.context.selection[0];
                ctx.setLogScope({
                    selectedCropIds: [context.cropId],
                    selectedPlotIds: context.selectedPlotIds,
                    mode: 'single',
                    applyPolicy: 'broadcast'
                });
                ctx.setMode('manual');
                ctx.setStatus('idle');
                const agriLogFormat: AgriLogResponse = {
                    // task-0b — `log.dayOutcome` is `DayOutcome | null`;
                    // `AgriLogResponse.dayOutcome` is unchanged and still
                    // required, so this falls back exactly as this edit-draft
                    // conversion already did for every pulled log before task-0b.
                    dayOutcome: log.dayOutcome ?? 'WORK_RECORDED',
                    cropActivities: log.cropActivities || [],
                    irrigation: log.irrigation || [],
                    labour: log.labour || [],
                    inputs: log.inputs || [],
                    machinery: log.machinery || [],
                    activityExpenses: log.activityExpenses || [],
                    disturbance: log.disturbance,
                    questionsForUser: [],
                    summary: '', // Missing in DailyLog
                    missingSegments: []
                };
                // Note: We might need a better adapter here, checking types
                ctx.setDraftLog(agriLogFormat);
            }}
            onUpdateNote={ctx.handleUpdateNote}
            onVerifyLog={ctx.handleVerifyLog}
            currentOperator={ctx.farmerProfile.operators.find(op => op.id === ctx.farmerProfile.activeOperatorId)}
            operators={ctx.farmerProfile.operators}
            navigate={ctx.setCurrentRoute}
            focusLogRequest={ctx.reflectFocusRequest}
            onFocusLogConsumed={() => ctx.setReflectFocusRequest(null)}
        />
    );
};

export const renderCompareView = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'main' || ctx.mainView !== 'compare') return null;
    return (
        <ComparePage
            plots={ctx.crops.flatMap(c => c.plots)}
            crops={ctx.crops}
            logs={ctx.history}
            onBack={() => ctx.setMainView('log')}
        />
    );
};

export const renderLogView = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'main' || ctx.mainView !== 'log') return null;

    const {
        status, mode, recordingSegment,
        setCurrentRoute,
        setMainView,
        // Read by dfes-companion surfaces only: `weatherData` by
        // LedgerRecognitionPanel (Task 4A weather questions), `todayDayState` by
        // DailyLoopHero and DailyLoopClarity. main dropped both from this list
        // when owner-oversight-loop deleted the weather + closure cards; the
        // fields themselves never left AppRouterContext.
        weatherData, todayDayState,
        crops, logScope, setLogScope, setMode, setStatus,
        hasActiveLogContext, isContextReady, error, errorTranscript,
        handleAudioReady, handleTextReady, handleManualSubmit,
        currentLogContext, ledgerDefaults, farmerProfile,
        draftLog, setDraftLog, provenance,
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
        voiceStreamingPhase, liveCaption,
        continuityLevel, savedPendingCaptureId,
        getTodayCounts, getContextColorIndicator,
        plannedTasks, handleUpdateTask,
        history, todayLogs, operatorNameById,
        getLogContextSnapshot, handleEditLog,
        costSnapshot, yesterdayCost,
        setRecordingSegment,
        lastSavedLogSummary, lastSavedLogIds, mockHistory, handleReset,
        logIntent
    } = ctx;

    // Focus the existing recorder by scrolling to (and briefly ringing) the
    // crop selector. Shared by the daily-loop hero tap and the recorder's own
    // "select a context first" nudge (DRY — same scroll+ring pattern).
    const focusRecorder = () => {
        const el = document.getElementById('crop-selector-container');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
            setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
        }
    };

    // Daily Clarity Loop v1 — Fix 1 coherence. Derive the carried element from
    // the SAME today-pending set the hero's N comes from (its overdue subset),
    // using the same tasks + scope todayDayState uses, so carriedCount ≤ N
    // ALWAYS — never a second, divergent count. Computed only when the loop is
    // on so the flag-off home stays a pure no-op.
    const carriedTasks = FEATURE_FLAGS.dailyLoop
        ? getCarriedTasks({
            tasks: plannedTasks ?? [],
            date: getDateKey(),
            selectedCropIds: logScope.selectedCropIds,
            selectedPlotIds: logScope.selectedPlotIds,
        })
        : [];


    return (
        <>
            {/* IDLE / RECORDING STATE */}
            {status !== 'confirming' && status !== 'success' && status !== 'processing' && (
                <>
                    {/* Daily Clarity Loop v1 (spec: dfes-companion-2026-07-11) — the
                        morning trigger: "आज {N} कामं बाकी" (or the empty-day invite)
                        with the carried "काल राहिलं" signal folded in beside it.
                        Flag-gated OFF by default, so production renders exactly the
                        oversight-loop layout below and nothing else.

                        The weather card, Daily Closure card and "Daily Log" heading +
                        owner chip that used to sit around this hero are NOT restored:
                        owner-oversight-loop Task 7/11 deliberately removed them and
                        moved weather into AppHeader (`CompactWeatherChip`). Re-adding
                        them here would render weather twice. */}
                    {/* Founder review 2026-08-26, ruling A2 — the hero now owns
                        its own `mb-4`/entrance wrapper (see its render), because
                        it has a state in which it renders NOTHING: it will not
                        say "काही बाकी नाही" while the oversight strip above is
                        reporting a positive waiting count. A wrapper left here
                        would survive that as a 16px ghost gap. */}
                    {!recordingSegment && FEATURE_FLAGS.dailyLoop && (
                        <DailyLoopHero
                            pendingCount={todayDayState.pendingCount}
                            carriedCount={carriedTasks.length}
                            carriedTitle={carriedTasks.length === 1 ? carriedTasks[0].title : undefined}
                            closurePercent={todayDayState.closurePercent}
                            onFocusRecorder={focusRecorder}
                        />
                    )}

                    {/* spec: owner-oversight-loop (Task 7, design doc §4.2, §5) —
                        the large gradient weather card, the Daily Closure
                        card and the "Daily Log" heading + owner chip used to
                        sit here, above the plot selector, making a farmer
                        scroll ~380px before reaching the only question this
                        screen exists for. The header already shows the
                        owner (canonical strip), the closure/pending-approval
                        facts now live in the oversight drawer. The weather
                        chip that used to sit here (Task 7's one-line
                        `CompactWeatherChip`) MOVED AGAIN in Task 11 — the
                        founder's header restructure put it into `AppHeader`
                        row 1 instead ("in the dead space on the right,
                        before the gear"), so it is not rendered here any
                        more (never rendered twice). */}

                    {/* spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) —
                        promoted from the Task-3.4 dismissible hint to a full
                        banner (founder ask #1). Purely presentational + a
                        null-check on logIntent; no effect on capture/parsing/
                        submission. Tapping it navigates straight back to
                        Labour Management (founder ask #2) — there is no ✕
                        dismiss any more. */}
                    {!recordingSegment && logIntent === 'labour' && (
                        <LabourLogBanner onBackToLabour={() => setCurrentRoute('labour')} />
                    )}

                    {/* spec: owner-oversight-loop (Task 13, change 3) — the
                        Sathi guide card, above the plot selector, per the
                        founder's own reference image. */}
                    {!recordingSegment && <SathiGuideCard forLabour={logIntent === 'labour'} />}

                    {!recordingSegment && (
                        <div id="crop-selector-container" className="mb-6 animate-in slide-in-from-top-4 duration-500">
                            <CropSelector
                                mode="log"
                                crops={crops}
                                selectedCrops={logScope.selectedCropIds}
                                selectedPlots={(() => {
                                    const map: Record<string, string[]> = {};
                                    logScope.selectedCropIds.forEach(cId => {
                                        const relevantPlots = logScope.selectedPlotIds.filter(pid =>
                                            crops.find(c => c.id === cId)?.plots.some(p => p.id === pid)
                                        );
                                        map[cId] = relevantPlots;
                                    });
                                    return map;
                                })()}
                                onSelectionChange={(newCrops, newPlots) => {
                                    const flattenedPlots = Object.values(newPlots).flat();
                                    setLogScope({
                                        selectedCropIds: newCrops,
                                        selectedPlotIds: flattenedPlots,
                                        mode: flattenedPlots.length > 1 ? 'multi' : 'single',
                                        applyPolicy: 'broadcast'
                                    });
                                    // Auto-switch to voice mode to show the recorder immediately
                                    if (flattenedPlots.length > 0) {
                                        setMode('voice');
                                    }
                                }}
                                disabled={false}
                                // spec: owner-oversight-loop (Task 13, change
                                // 4) — "संपूर्ण शेत" demoted out of the
                                // carousel, below as its own quiet row.
                                hideGlobalCard
                            />
                        </div>
                    )}

                    {/* spec: owner-oversight-loop (Task 13, change 5) — the
                        closing help bar. */}
                    {!recordingSegment && <HelpBar />}

                    {/* spec: owner-oversight-loop (Task 7, design doc §4.2,
                        §5) — Running Cost, MOVED below the plot selector:
                        ambient status a farmer sees after acting, not a
                        blocker before it. The "cost may be inaccurate — N
                        unverified" line is REMOVED here (not moved) — that
                        same fact already lives in the oversight drawer's
                        decision rows, and a third copy is exactly what this
                        reorder exists to remove (spec §4.2's own ruling). */}
                    {!recordingSegment && (
                        <div
                            data-testid="running-cost-card"
                            className="mb-6 rounded-2xl bg-stone-900 text-white p-3.5 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500"
                        >
                            <p className="text-[10px] uppercase tracking-wide font-bold text-stone-300">Running Cost</p>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                    <p className="text-stone-400 text-xs">Today</p>
                                    <p className="font-black">Rs {formatCurrencyINR(costSnapshot.today)}</p>
                                </div>
                                <div>
                                    <p className="text-stone-400 text-xs">Yesterday</p>
                                    <p className="font-black">Rs {formatCurrencyINR(yesterdayCost)}</p>
                                </div>
                                <div>
                                    <p className="text-stone-400 text-xs">Running</p>
                                    <p className="font-black">Rs {formatCurrencyINR(costSnapshot.cropSoFar)}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* INPUT METHOD TOGGLE */}
                    {!recordingSegment && status !== 'recording' && (
                        <div className="mb-6 px-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
                            <InputMethodToggle
                                mode={mode}
                                onChange={(newMode) => {
                                    // wave-3.7 — he was taken to the mic to answer Sathi
                                    // and is switching away without speaking. Record the
                                    // SKIP honestly; never invent an answer he did not
                                    // give (P4). Fire-and-forget: a telemetry write must
                                    // never delay the mode switch he asked for.
                                    if (mode === 'voice' && newMode !== 'voice') {
                                        void abandonPendingQuestionAnswer();
                                    }
                                    setMode(newMode);
                                }}
                                disabled={false}
                                suggestInteraction={hasActiveLogContext}
                            />
                        </div>
                    )}

                    {recordingSegment && (
                        <div className={`mb-4 border-2 p-5 rounded-3xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 ${getSegmentVisual(recordingSegment).color}`}>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/50 rounded-full animate-pulse">
                                    {getSegmentVisual(recordingSegment).icon}
                                </div>
                                <div>
                                    <p className="font-bold text-lg leading-none mb-1">Recording {getSegmentVisual(recordingSegment).label}</p>
                                    <p className="text-sm opacity-80">
                                        {recordingSegment === 'labour' ? 'Speak count & duration...' : 'Speak details clearly...'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* wave-3.7, founder decision 3 — the question stays VISIBLE while he
                        answers it. Read straight from the stash, so it survives a reload
                        and needs no second copy of the selection state. */}
                    {mode === 'voice' && (() => {
                        const pendingQuestion = readPendingQuestionAnswer();
                        if (!pendingQuestion) return null;
                        return (
                            <div
                                data-testid="shramsathi-pinned-question"
                                className="mb-4 rounded-xl border px-4 py-3 text-sm font-medium"
                                // The 'ask' tone from SurfaceSection — marigold means "what
                                // Sathi still wants" everywhere else on this surface, so the
                                // pinned question must read as the SAME thing he just tapped.
                                // Literal hex, not a Tailwind token: no marigold scale exists
                                // in this project's config, and a non-existent utility class
                                // would silently render as no colour at all.
                                style={{
                                    fontFamily: "'Noto Sans Devanagari', sans-serif",
                                    backgroundColor: '#FEF8EF', borderColor: '#F6E3C4', color: '#B4650F',
                                }}
                            >
                                {pendingQuestion.selected.resolvedPromptMr}
                            </div>
                        );
                    })()}

                    <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {getContextColorIndicator()}

                        <div className={`transition-all duration-500 ${!isContextReady ? 'opacity-90' : ''}`}>
                            {mode === 'voice' ? (
                                <>
                                    {DEFAULT_VOICE_CONFIG.streamingPcm.enabled ? (
                                        <AudioRecorderStreaming
                                            onAudioCaptured={handleAudioReady}
                                            onProcessingStart={() => setStatus('processing')}
                                            onTextCaptured={handleTextReady}
                                            disabled={!isContextReady}
                                            externalError={error}
                                            transcript={errorTranscript}
                                            suggestInteraction={isContextReady}
                                            onRequestContextSelection={focusRecorder}
                                        />
                                    ) : (
                                        <AudioRecorder
                                            onAudioCaptured={handleAudioReady}
                                            onTextCaptured={handleTextReady}
                                            disabled={!isContextReady}
                                            externalError={error}
                                            transcript={errorTranscript}
                                            suggestInteraction={isContextReady}
                                            onRequestContextSelection={focusRecorder}
                                        />
                                    )}
                                    {/* SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
                                        Cost-safe: consumes the same Sarvam transcribe-stream that
                                        useVoiceRecorder.runTranscribeStage already opened; no
                                        additional Sarvam call. Self-hides when there are no
                                        partials AND the stream isn't open. */}
                                    <LiveCaption
                                        text={liveCaption}
                                        isTranscribing={voiceStreamingPhase === 'transcribing'}
                                    />
                                </>
                            ) : (
                                hasActiveLogContext ? (
                                    <ManualEntry
                                        context={currentLogContext}
                                        crops={crops}
                                        defaults={ledgerDefaults}
                                        profile={farmerProfile}
                                        onSubmit={handleManualSubmit}
                                        disabled={false}
                                        // FOUNDER RULING 2026-08-31 — the labour
                                        // door writes only हजेरी. Filtered HERE,
                                        // at the form's entrance, so the other
                                        // buckets never enter the draft the
                                        // farmer edits and therefore can never
                                        // be saved from this door. Any task he
                                        // stated survives on the labour row
                                        // itself — see attendanceDraft.ts.
                                        initialData={logIntent === 'labour' ? toAttendanceOnlyDraft(draftLog) : draftLog}
                                        attendanceOnly={logIntent === 'labour'}
                                        provenance={provenance}
                                        onDataConsumed={() => setDraftLog(null)}
                                        todayCountsMap={(() => {
                                            const map: Record<string, TodayCounts> = {};
                                            if (currentLogContext) {
                                                const todayStr = getDateKey();
                                                const pids = new Set<string>();
                                                currentLogContext.selection.forEach(s => s.selectedPlotIds.forEach(p => pids.add(p)));
                                                pids.forEach(pid => {
                                                    map[pid] = getTodayCounts(pid, todayStr);
                                                });
                                            }
                                            return map;
                                        })()}
                                        /* LABOUR_PHASE2 P2.4 — the farm-wide half of the
                                           day, carried SEPARATELY. A farm-wide context
                                           yields no plot ids, so the map above is
                                           legitimately `{}` and ManualEntry showed zeros
                                           for a day the farmer HAD recorded work in. The
                                           fix is NOT to fold farm-wide logs into that map:
                                           `R24` measured that its consumer sums it across
                                           the plots in context, turning a plot's 3 labour
                                           entries into 11. No plot key here, so the two can
                                           never be added. */
                                        farmWideToday={getFarmWideDaySummary(history, getDateKey())}
                                        transcriptEntries={(() => {
                                            // Build timeline entries for today's logs in current context
                                            const todayStr = getDateKey();
                                            const contextPlotIds = new Set<string>();
                                            currentLogContext?.selection.forEach(s => s.selectedPlotIds.forEach(p => contextPlotIds.add(p)));

                                            const todayLogsLocal = history.filter(log =>
                                                log.date === todayStr &&
                                                log.context?.selection?.some((sel: { selectedPlotIds?: readonly string[] }) =>
                                                    sel.selectedPlotIds?.some((pid: string) => contextPlotIds.has(pid))
                                                )
                                            );
                                            return buildTimelineEntries(todayLogsLocal, crops);
                                        })()}
                                        todayLogs={(() => {
                                            // Full log objects for loading into editor
                                            const todayStr = getDateKey();
                                            const contextPlotIds = new Set<string>();
                                            currentLogContext?.selection.forEach(s => s.selectedPlotIds.forEach(p => contextPlotIds.add(p)));

                                            return history.filter(log =>
                                                log.date === todayStr &&
                                                log.context?.selection?.some((sel: { selectedPlotIds?: readonly string[] }) =>
                                                    sel.selectedPlotIds?.some((pid: string) => contextPlotIds.has(pid))
                                                )
                                            );
                                        })()}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-64 text-slate-400">
                                        Select a plot to continue...
                                    </div>
                                )
                            )}
                        </div>

                        {/* TODAY'S ACTIVITY LEDGER CARDS */}
                        {!recordingSegment && mode !== 'manual' && (
                            <div className="mt-12 animate-in slide-in-from-bottom-8 relative z-10">


                                {/* Section Divider */}
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                                    <div className="px-4 py-1.5 rounded-full bg-slate-100/80 backdrop-blur-sm border border-slate-200 text-slate-500 text-[10px] font-bold uppercase tracking-widest shadow-sm">
                                        Today's Timeline
                                    </div>
                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                                </div>

                                <div className="flex items-center justify-between px-2 mb-4">
                                    <h3 className="text-slate-800 font-bold text-lg tracking-tight">Activity Feed</h3>
                                    <span className="text-[10px] uppercase font-bold text-slate-500 bg-white border border-slate-100 px-2 py-1 rounded-lg shadow-sm">
                                        {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', timeZone: DISPLAY_TIME_ZONE })}
                                    </span>
                                </div>

                                {todayLogs.length === 0 ? (
                                    <div className="text-center p-8 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-100 text-stone-300 font-medium">
                                        No work logged yet today
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {todayLogs.map(log => {
                                            const contextDetails = getLogContextSnapshot(log);
                                            const verification = getVerificationPresentation(log.verification?.status);
                                            const createdById = log.meta?.createdByOperatorId || '';
                                            // Truth audit T1.12b, finding 4. This used to fall back
                                            // to `ownerDisplayName` — so a record nobody was recorded
                                            // as making was attributed, by name, to a real person.
                                            // `oversightSelectors.ts:20-22` states the opposite rule in
                                            // this same release: "a person can only be counted if they
                                            // were named." `अज्ञात` is the word the app already uses for
                                            // this exact fact (the unattributed row in
                                            // OversightBriefingCard), so "no identity" reads the same
                                            // everywhere. `P4`/`P7`.
                                            const loggedBy = operatorNameById.get(createdById) || 'अज्ञात';
                                            const primaryCropId = log.context.selection[0]?.cropId;
                                            const cropColor = crops.find(crop => crop.id === primaryCropId)?.color || 'bg-slate-400';

                                            return (
                                                <DailyLogCard
                                                    key={log.id}
                                                    logId={log.id}
                                                    workDone={getPrimaryWorkDone(log)}
                                                    plotName={contextDetails.plotName}
                                                    cropName={contextDetails.cropName}
                                                    cropColor={cropColor}
                                                    loggedBy={loggedBy}
                                                    timeLabel={formatLogTime(log.meta?.createdAtISO)}
                                                    statusLabel={verification.label}
                                                    statusTone={verification.tone}
                                                    counts={{
                                                        cropActivities: log.cropActivities.length,
                                                        irrigation: log.irrigation.length,
                                                        labour: log.labour.length,
                                                        inputs: log.inputs.length
                                                    }}
                                                    summaryLines={getSummaryLines(log)}
                                                    onClick={() => handleEditLog(log)}
                                                />
                                            );
                                        })}
                                    </div>
                                )}


                            </div>
                        )}

                        {recordingSegment && (
                            <div className="mt-6 text-center">
                                <button
                                    onClick={() => { setRecordingSegment(null); setStatus('confirming'); }}
                                    className="text-stone-400 font-bold text-sm bg-stone-100 px-6 py-2 rounded-full hover:bg-stone-200"
                                >
                                    Cancel & Go Back
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* PROCESSING / CONFIRM / SUCCESS */}
            {status === 'processing' && (
                FEATURE_FLAGS.dailyLoop ? (
                    /* dfes-companion loop v1 (spec: dfes-companion-2026-07-11) —
                       founder-approved श्रम साथी video-character processing screen.
                       Flag-gated: dailyLoop OFF renders the exact legacy spinner
                       below (byte-equivalent no-op). */
                    <ShramSathiUnderstanding />
                ) : (
                <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-16 text-center">
                    <div className="flex justify-center mb-8">
                        <div className="relative">
                            <div className="w-24 h-24 border-4 border-stone-100 border-t-emerald-500 rounded-full animate-spin"></div>
                            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center"><Leaf size={32} className="text-emerald-600 animate-pulse" /></div>
                        </div>
                    </div>
                    <ShramSathiUnderstandingLine />
                    {/* SARVAM_PRIMARY_VOICE_PIPELINE — live transcript, placed right below the
                        recorder/banner so the farmer sees their words appear as Sarvam transcribes
                        the clip (post-Stop, cost-safe: reuses the single transcribe-stream that
                        runTranscribeStage already opened; no extra Sarvam call). Self-hides when
                        empty; the static placeholder below shows only until the first words land. */}
                    <LiveCaption
                        text={liveCaption}
                        isTranscribing={voiceStreamingPhase === 'transcribing'}
                    />
                    {!liveCaption && voiceStreamingPhase !== 'transcribing' && (
                        <div className="text-sm text-stone-400 max-w-xs mx-auto mt-2 italic">Listening carefully to your log...</div>
                    )}
                </div>
                )
            )}

            {/* dfes-companion Phase 4 — voice-continuity degraded terminal surface.
                Renders only when the ladder produced a durable-but-unstructured
                capture (transcript-only / audio-only); reuses the SAME literal
                "Add Another Log" button + handleReset used by the success card
                below (no new i18n key). Flag-gated OFF by default. */}
            {FEATURE_FLAGS.voiceContinuity
                && status !== 'processing'
                && savedPendingCaptureId
                && (continuityLevel === 'transcript-only' || continuityLevel === 'audio-only') && (
                <div className="mt-4">
                    <VoiceSavedReassurance level={continuityLevel} />
                    <button
                        onClick={handleReset}
                        className="mt-4 w-full rounded-xl bg-stone-900 py-4 text-lg font-bold text-white transition-colors hover:bg-emerald-800"
                    >
                        आणखी नोंद करा
                    </button>
                </div>
            )}

            {status === 'success' && (
                <>
                {/* BUG-2 2026-08-14 (founder: "there is no going back screen after
                    this screen"). The back control lives OUTSIDE the card because
                    the card is `overflow-hidden`, which would kill `position:
                    sticky` inside it. Out here it sticks to the top of the
                    scrolling <main>, so it stays reachable however far the farmer
                    has scrolled. It also owns the hardware-back handling — see
                    SavedScreenBack. `handleReset` is the same safe reset the
                    bottom "आणखी नोंद करा" button uses: it clears DRAFT state only
                    and never touches the already-saved log. */}
                <SavedScreenBack onBack={handleReset} />
                <div data-testid="saved-to-ledger" className="animate-in fade-in duration-500 bg-white rounded-3xl shadow-xl border border-stone-100 p-4 text-center relative overflow-hidden">
                    {/* REDESIGN 2026-08-13 (founder). Was: a 3xl English "Saved to
                        Ledger" headline under a leaf, on an emerald gradient, with
                        eight equally-weighted white cards stacked beneath it. The
                        system announced a storage outcome; the companion the farmer
                        had just been talking to disappeared.

                        Now the character SPEAKS (SathiSaidCard), and every block
                        below sits in a SurfaceSection that names itself and carries
                        a tone colour: green = what you did, blue = what I
                        understood, marigold = what I still need, emerald = your
                        consistency. The card ground is plain white so those four
                        tints are the only colour on the surface and the eye can
                        sort the screen at a glance. */}
                    <div className="relative z-10">
                        <SathiSaidCard />

                            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-600 shadow-sm border border-emerald-50">
                                <Leaf size={40} className="drop-shadow-sm" />
                            </div>
                        <SavedLocallyHeadline />

                        {/* WHAT I UNDERSTOOD — the /10, its bar, and one line saying
                            what the number measures. Self-gates on
                            FEATURE_FLAGS.understandingMeter (renders null when OFF),
                            so the section wrapper must gate too or an empty blue box
                            would show in production. savedLog is derived exactly as
                            the recognition panel below derives it (lastSavedLogIds[0]
                            via history.find). */}
                        {(() => {
                            const savedLogId = lastSavedLogIds && lastSavedLogIds.length > 0
                                ? lastSavedLogIds[0]
                                : undefined;
                            const savedLog = savedLogId
                                ? history.find(l => l.id === savedLogId)
                                : undefined;
                            const selection = savedLog?.context?.selection?.[0];
                            const card = (
                                <DayUnderstandingCard
                                    farmId={ctx.activeFarmId ?? selection?.farmId ?? null}
                                    dayDate={savedLog?.date}
                                    savedLogId={savedLog?.id ?? null}
                                />
                            );
                            return FEATURE_FLAGS.understandingMeter ? (
                                <div className="mt-4">
                                    <SurfaceSection tone="grasp" labelKey="dfes.sectionGrasp" testId="section-grasp">
                                        {card}
                                    </SurfaceSection>
                                </div>
                            ) : card;
                        })()}

                        {/* WHAT YOU DID — the crop/bucket breakdown, now behind a green
                            "आज तुम्ही काय केलं" label so it reads as the farmer's OWN
                            record rather than another anonymous card. */}
                        {lastSavedLogSummary && lastSavedLogSummary.length > 0 ? (
                            <SurfaceSection tone="work" labelKey="dfes.sectionWork" testId="section-work">
                            <div className="space-y-3">
                                {lastSavedLogSummary.map((item, idx) => {
                                    const crop = item.cropId ? crops.find(entry => entry.id === item.cropId) : undefined;
                                    const theme = getCropTheme(crop?.color || 'bg-emerald-500');

                                    return (
                                        <div
                                            key={`${item.logId}-${idx}`}
                                            className={`rounded-[1.8rem] border p-1 shadow-lg ${theme.border} ${theme.shadow}`}
                                        >
                                            <div className={`rounded-[1.5rem] p-4 ${theme.slideBgSelected}`}>
                                                <div className="flex items-center gap-3 text-left mb-3">
                                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-white/70">
                                                        {crop ? <CropSymbol name={crop.iconName} size="md" /> : <Leaf size={22} className="text-emerald-600" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">कुठे</p>
                                                        {/* Since 2b this reads `Grapes • Plot A,
                                                            Plot B, Plot C` and `truncate` silently
                                                            cut it at 412px — the farmer saw which
                                                            plots the record landed on, minus the
                                                            ones that did not fit, with no ellipsis
                                                            to warn him. The DATA was right; the
                                                            presentation was not. `line-clamp-2`
                                                            shows it and still bounds a pathological
                                                            selection. */}
                                                        <p className="line-clamp-2 break-words text-base font-black leading-snug text-stone-900">
                                                            {item.cropName} • {item.plotName}
                                                        </p>
                                                        <NotQueuedForServerBadge syncQueued={item.syncQueued} />
                                                    </div>
                                                </div>
                                                {/* Bucket Breakdown */}
                                                {(() => {
                                                    const savedLog = history.find(l => l.id === item.logId);
                                                    if (!savedLog) return null;
                                                    const buckets = [
                                                        { key: 'irrigation', count: (savedLog.irrigation || []).filter(e => (e.durationHours || 0) > 0 || (e.waterVolumeLitres || 0) > 0 || e.method || e.source).length, icon: <Droplets size={13} />, label: 'पाणी', color: 'bg-blue-100 text-blue-700' },
                                                        { key: 'labour', count: (savedLog.labour || []).length, icon: <Users size={13} />, label: 'मजूर', color: 'bg-amber-100 text-amber-700' },
                                                        { key: 'inputs', count: (savedLog.inputs || []).length, icon: <Package size={13} />, label: 'औषध/खत', color: 'bg-purple-100 text-purple-700' },
                                                        { key: 'machinery', count: (savedLog.machinery || []).length, icon: <Tractor size={13} />, label: 'यंत्र', color: 'bg-stone-100 text-stone-700' },
                                                        { key: 'crop', count: (savedLog.cropActivities || []).length, icon: <Sprout size={13} />, label: 'पीक काम', color: 'bg-emerald-100 text-emerald-700' },
                                                    ].filter(b => b.count > 0);
                                                    if (buckets.length === 0) return null;
                                                    return (
                                                        <div className="flex flex-wrap gap-2">
                                                            {buckets.map(b => (
                                                                <span key={b.key} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${b.color}`}>
                                                                    {b.icon}
                                                                    {b.label} ×{b.count}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            </SurfaceSection>
                        ) : null}

                        {/* Daily Clarity Loop v1 REWARD line (dfes-companion-2026-07-11).
                            Flag-gated OFF by default, so this is a byte-equivalent no-op on
                            the success card in production. When ON, the calm "{done} पूर्ण,
                            {left} बाकी" control-affirming line renders directly ABOVE the
                            recognition panel — so Sathi's ONE gentle question sits just below
                            it (reward = clarity + one question, never points). Decision 3B: NO
                            fact/insight fallback in v1; on a no-question day this line stands
                            alone (the question self-gates on its own flags + content gate). */}
                        {FEATURE_FLAGS.dailyLoop && (
                            <DailyLoopClarity
                                done={todayDayState.completedCount}
                                left={todayDayState.pendingCount}
                            />
                        )}

                        {/* Task 1B (spec: dfes-companion-2026-07-11) — ONE daily
                            intelligence fact from the farmer's own history,
                            sitting directly BELOW the clarity line. Flag-gated
                            OFF by default (byte-equivalent no-op). savedLog is
                            derived the same way the recognition panel below
                            derives it (from lastSavedLogIds[0] via history.find). */}
                        {FEATURE_FLAGS.intelligenceInsights && (() => {
                            const savedLogId = lastSavedLogIds && lastSavedLogIds.length > 0
                                ? lastSavedLogIds[0]
                                : undefined;
                            const savedLog = savedLogId
                                ? history.find(l => l.id === savedLogId)
                                : undefined;
                            const insight = buildDailyInsight(history, savedLog, savedLog?.date ?? '');
                            return insight && insight.render ? <DailyLoopInsight insight={insight} /> : null;
                        })()}

                        {/* DFES recognition surface (dfes-companion-2026-07-11). The panel
                            renders unconditionally; each child self-gates on its flag
                            (understandingMeter for the bar, disciplineSystem for the strip),
                            and the useFarmerEngagement fetch self-gates on those flags, so it
                            stays inert AND network-silent in production until a flag is on. */}
                        {(() => {
                            const savedLogId = lastSavedLogIds && lastSavedLogIds.length > 0
                                ? lastSavedLogIds[0]
                                : undefined;
                            const savedLog = savedLogId
                                ? history.find(l => l.id === savedLogId)
                                : undefined;
                            // Phase 5 (dfes-companion-2026-07-11): derive the farm/plot/crop
                            // context the D8 question engine needs from the saved log's own
                            // context selection — SelectedCropContext carries cropName inline
                            // (domain/types/log.types.ts), so no separate crops[] lookup for
                            // the {crop} placeholder. `crops` IS threaded through separately
                            // (Task 3B) for the panel's schedule-gap lookup, which needs the
                            // plot's schedule/template — not derivable from the log alone.
                            // `weatherData` (Task 4A) is threaded the same way — same live
                            // object the WeatherWidget above already renders — so the panel
                            // can wake the P1/P2 forward-looking safety/weather questions.
                            const selection = savedLog?.context?.selection?.[0];
                            // The panel hosts BOTH the marigold "साथीला अजून हवं आहे"
                            // question and the emerald streak strip. It owns the single
                            // shared useFarmerEngagement fetch, so it must stay ONE
                            // element — splitting it into two SurfaceSections here would
                            // duplicate that fetch. It therefore labels its own two
                            // zones internally (see LedgerRecognitionPanel).
                            return (
                                <LedgerRecognitionPanel
                                    // BUGFIX_2026-07-19: prefer the session's ACTIVE farm.
                                    // `selection.farmId` is optional on SelectedCropContext and
                                    // nothing ever populates it, so this was always null — which
                                    // made useDayUnderstanding skip its fetch entirely and pinned
                                    // the understanding bar to its pending state permanently.
                                    farmId={ctx.activeFarmId ?? selection?.farmId ?? null}
                                    plotId={selection?.selectedPlotIds?.[0] ?? null}
                                    crop={selection?.cropName ?? ''}
                                    todayLocalDate={savedLog?.date}
                                    crops={crops}
                                    savedLog={savedLog}
                                    allLogs={history}
                                    weather={weatherData}
                                    // wave-3.7, founder decision 3 — "no taps before he
                                    // speaks". The tap writes NOTHING (question_events is
                                    // append-only, so a row written now could never
                                    // acquire his answer); it stashes the pending answer
                                    // and hands him the SAME microphone entry point
                                    // globalSheets' QuickLogSheet uses. Do not build a
                                    // second recording surface.
                                    onAnswerBySpeaking={(pending) => {
                                        stashPendingQuestionAnswer(pending);
                                        setStatus('idle');
                                        setMode('voice');
                                        setMainView('log');
                                    }}
                                />
                            );
                        })()}

                        {/* Task 5 (spec: dfes-companion-2026-07-11) — "राहिलं → झालं"
                            suggest-and-confirm task close. Flag-gated: OFF means
                            findConfirmableTaskCloses is never even called (the whole
                            block short-circuits on FEATURE_FLAGS.taskCloseConfirm), so
                            there is zero extra computation, not just a hidden render.
                            ON: the single top conservative candidate (same plot + due
                            window + title containment — see taskAutoClose.ts) surfaces
                            below the recognition panel. Only the farmer's own होय tap
                            calls handleUpdateTask (the SAME reversible mutation
                            ToDoTasksBlock's toggle uses) — नाही only hides the card for
                            this render and leaves the task pending, no penalty. */}
                        {FEATURE_FLAGS.taskCloseConfirm && (() => {
                            const savedLogId = lastSavedLogIds && lastSavedLogIds.length > 0
                                ? lastSavedLogIds[0]
                                : undefined;
                            const savedLog = savedLogId
                                ? history.find(l => l.id === savedLogId)
                                : undefined;
                            const todayLocalDate = savedLog?.date ?? getDateKey();
                            const topCandidate = findConfirmableTaskCloses(
                                plannedTasks ?? [],
                                savedLog,
                                todayLocalDate,
                            )[0];
                            if (!topCandidate) return null;

                            return (
                                <TaskCloseConfirmSlot
                                    key={topCandidate.task.id}
                                    candidate={topCandidate}
                                    onConfirm={(candidate) => {
                                        // Reuses the SAME mutation ToDoTasksBlock's toggle
                                        // uses — reversible by re-opening the task there.
                                        handleUpdateTask(candidate.task.id, {
                                            status: 'done',
                                            completedAt: new Date().toISOString(),
                                        });
                                        // Traceability: a wrong close must be traceable.
                                        logger.info('task_close.confirmed', {
                                            component: 'TaskCloseConfirm',
                                            action: 'task_close_confirmed',
                                            taskId: candidate.task.id,
                                            plotId: candidate.task.plotId,
                                            matchedActivityTitle: candidate.matchedActivityTitle,
                                        });
                                    }}
                                />
                            );
                        })()}

                        <div className="flex flex-col gap-3">
                            {/* Review Details Button (New) */}
                            {lastSavedLogIds && lastSavedLogIds.length > 0 && (
                                <button
                                    onClick={() => {
                                        if (lastSavedLogIds.length > 1) {
                                            setStatus('idle');
                                            setMode('manual');
                                            setMainView('log');
                                            return;
                                        }
                                        const logId = lastSavedLogIds[0];
                                        const logToEdit = history.find(l => l.id === logId) || mockHistory.find(l => l.id === logId);
                                        if (logToEdit) {
                                            // Trigger Edit Logic (Copied from ReflectPage onEditLog)
                                            handleEditLog(logToEdit);
                                        }
                                    }}
                                    className="w-full bg-white text-emerald-700 border border-emerald-200 py-4 rounded-xl font-bold text-lg hover:bg-emerald-50 transition-colors mb-1"
                                >
                                    {lastSavedLogIds.length > 1 ? 'सर्व नोंदी पाहा' : 'नोंद पाहा'}
                                </button>
                            )}

                            <button onClick={() => setMainView('reflect')} className="w-full bg-stone-100 text-stone-700 py-4 rounded-xl font-bold text-lg hover:bg-stone-200 transition-colors">
                                कामाचा नकाशा
                            </button>
                            <button onClick={handleReset} className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-800 transition-colors shadow-lg shadow-emerald-900/20">
                                आणखी नोंद करा
                            </button>
                        </div>
                    </div>
                </div>
                </>
            )}




        </>
    );
};
