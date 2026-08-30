// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// The "main" route's three sub-views (reflect / compare / log) were the
// largest piece of AppRouter. Lifted verbatim into render functions so the
// orchestrator stays small.

import React from 'react';
import {
    AgriLogResponse, DailyLog
} from '../../types';
import type { TodayCounts } from '../../domain/types/farm.types';
import CropSelector from '../../features/context/components/CropSelector';
import InputMethodToggle from '../../shared/components/ui/InputMethodToggle';
import AudioRecorder from '../../features/voice/components/AudioRecorder';
import AudioRecorderStreaming from '../../features/voice/components/AudioRecorderStreaming';
import LiveCaption from '../../features/voice/components/LiveCaption';
import { DEFAULT_VOICE_CONFIG } from '../../infrastructure/voice/types';
import ManualEntry from '../../features/logs/components/ManualEntry';
import DailyLogCard from '../../features/logs/components/DailyLogCard';
// `ArrowLeft` left with `LabourLogBanner`, its only consumer. `Users` stays —
// the success card's bucket chips still use it.
import { Leaf } from 'lucide-react';
import { getSegmentVisual } from '../../shared/utils/uiUtils';
import { getDateKey } from '../domain/services/DateKeyService';
import { buildTimelineEntries } from '../../services/transcriptTimelineService';
import { formatCurrencyINR } from '../../shared/utils/dayState';
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
import HelpBar from '../../features/oversight/components/HelpBar';
import {
    LabourLogBanner,
    // main's is the processing <h3> LINE; dfes's (imported above) is
    // the full video-character screen. Different components, one name.
    ShramSathiUnderstanding as ShramSathiUnderstandingLine,
} from './mainViewComponents';
import {
    abandonPendingQuestionAnswer, readPendingQuestionAnswer,
} from '../../features/logs/services/pendingQuestionAnswer';
import VoiceSavedReassurance from '../../features/logs/components/shramsathi/VoiceSavedReassurance';
import { ShramSathiUnderstanding } from '../../features/logs/components/shramsathi/ShramSathiUnderstanding';

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
// RE-EXPORTED, not merely imported: `NotQueuedForServerBadge` has consumers
// that import it `from './mainView'`, and the eslint unused-vars pass during
// the 800-line split briefly dropped it because a re-export is not a "use".
// It is one — `notQueuedBadge.test.tsx` binds to exactly this path.
export { NotQueuedForServerBadge, LabourLogBanner } from './mainViewComponents';
import { renderSavedView } from './savedView';

// `TaskCloseConfirmSlot` moved to `savedView.tsx` with the branch that was
// its only consumer.

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
                    dayOutcome: log.dayOutcome,
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
        // Read by dfes-companion surfaces only: `weatherData` by
        // LedgerRecognitionPanel (Task 4A weather questions), `todayDayState` by
        // DailyLoopClarity and by the done/left counters further down. It was
        // ALSO read by `DailyLoopHero` until the founder's 2026-08-29 ruling
        // removed that component (see its former render site below); the field
        // itself stays because those two other readers still need it.
        crops, logScope, setLogScope, setMode, setStatus,
        hasActiveLogContext, isContextReady, error, errorTranscript,
        handleAudioReady, handleTextReady, handleManualSubmit,
        currentLogContext, ledgerDefaults, farmerProfile,
        draftLog, setDraftLog, provenance,
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
        voiceStreamingPhase, liveCaption,
        continuityLevel, savedPendingCaptureId,
        getTodayCounts, getContextColorIndicator,
        history, todayLogs, operatorNameById,
        getLogContextSnapshot, handleEditLog,
        costSnapshot, yesterdayCost,
        setRecordingSegment,
        handleReset,
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

    return (
        <>
            {/* IDLE / RECORDING STATE */}
            {status !== 'confirming' && status !== 'success' && status !== 'processing' && (
                <>
                    {/* FOUNDER RULING 2026-08-29 — `DailyLoopHero` is GONE from
                        this screen, not flag-gated off. He read the home screen
                        and found two blocks asking the same thing: this hero's
                        "आज काहीच सांगितलं नाही…" and `SathiGuideCard`'s "आज कोणत्या
                        प्लॉटवर काम केलं?". He had already ruled once on this exact
                        duplication (2026-08-27, *"there are two line only keep
                        which is on the oversight bar"*) — that pass deleted only
                        the SETTLED line and left the "nothing told" one, so the
                        pair survived. This removes the whole surface.

                        WHAT NOW OWNS EACH FACT — no fact was dropped with it:
                          • the waiting COUNT  → the oversight strip's ring above
                          • "what did you do" → `SathiGuideCard`, now the hero
                        The hero's third input, the carried "काल राहिलं" signal,
                        had no second home and is not restated anywhere; it was
                        only ever a decoration on a line the strip already made. */}

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
                    {!recordingSegment && <SathiGuideCard />}

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
                                        initialData={draftLog}
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

            {/* The saved-to-ledger screen moved to `savedView.tsx` — 311 lines
                of this file, and the only branch in it that closed over nothing
                local. See that file for why it was the one that could move. */}
            {status === 'success' && renderSavedView(ctx)}




        </>
    );
};

