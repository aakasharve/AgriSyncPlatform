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
import { MeterDisplay } from '../../features/logs/components/MeterDisplay';
// Only the SUMMARY is needed here — `mainView` hands it to `ManualEntry`,
// which owns the decision to render the panel (it is the component that knows
// whether the farmer's context is the whole farm).
import { getFarmWideDaySummary } from '../../app/helpers/appContentDailyCounts';
import {
    LabourLogBanner,
    NotQueuedForServerBadge,
    SavedLocallyHeadline,
    ShramSathiUnderstanding,
} from './mainViewComponents';

import { AppRouterContext } from './routeContext';
import { ReflectPage, ComparePage } from './lazyComponents';
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
        ownerDisplayName, setMainView,
        crops, logScope, setLogScope, setMode, setStatus,
        hasActiveLogContext, isContextReady, error, errorTranscript,
        handleAudioReady, handleTextReady, handleManualSubmit,
        currentLogContext, ledgerDefaults, farmerProfile,
        draftLog, setDraftLog, provenance,
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
        voiceStreamingPhase, liveCaption,
        getTodayCounts, getContextColorIndicator,
        history, todayLogs, operatorNameById,
        getLogContextSnapshot, handleEditLog,
        costSnapshot, yesterdayCost,
        setRecordingSegment,
        lastSavedLogSummary, lastSavedLogIds, mockHistory, handleReset,
        logIntent
    } = ctx;

    return (
        <>
            {/* IDLE / RECORDING STATE */}
            {status !== 'confirming' && status !== 'success' && status !== 'processing' && (
                <>
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
                            />
                        </div>
                    )}

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
                                onChange={(newMode) => setMode(newMode)}
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
                                            onRequestContextSelection={() => {
                                                const el = document.getElementById('crop-selector-container');
                                                if (el) {
                                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                    el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
                                                    setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <AudioRecorder
                                            onAudioCaptured={handleAudioReady}
                                            onTextCaptured={handleTextReady}
                                            disabled={!isContextReady}
                                            externalError={error}
                                            transcript={errorTranscript}
                                            suggestInteraction={isContextReady}
                                            onRequestContextSelection={() => {
                                                const el = document.getElementById('crop-selector-container');
                                                if (el) {
                                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                    el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
                                                    setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
                                                }
                                            }}
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
                                        {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' })}
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
                                            const loggedBy = operatorNameById.get(createdById) || ownerDisplayName;
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
                <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-16 text-center">
                    <div className="flex justify-center mb-8">
                        <div className="relative">
                            <div className="w-24 h-24 border-4 border-stone-100 border-t-emerald-500 rounded-full animate-spin"></div>
                            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center"><Leaf size={32} className="text-emerald-600 animate-pulse" /></div>
                        </div>
                    </div>
                    <ShramSathiUnderstanding />
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
            )}

            {status === 'success' && (
                <div data-testid="saved-to-ledger" className="animate-in fade-in duration-500 bg-gradient-to-br from-emerald-50 to-white rounded-3xl shadow-xl border border-emerald-100 p-8 text-center relative overflow-hidden">
                    {/* Decorative Background Elements */}
                    <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500/20"></div>
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-100 rounded-full blur-3xl opacity-50"></div>

                    <div className="relative z-10">
                            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-600 shadow-sm border border-emerald-50">
                                <Leaf size={40} className="drop-shadow-sm" />
                            </div>
                        <SavedLocallyHeadline />

                        {/* Dynamic Feedback Summary */}
                        {lastSavedLogSummary && lastSavedLogSummary.length > 0 ? (
                            <div className="mb-8 space-y-3">
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
                                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Stored In</p>
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
                                                        { key: 'irrigation', count: (savedLog.irrigation || []).filter(e => (e.durationHours || 0) > 0 || (e.waterVolumeLitres || 0) > 0 || e.method || e.source).length, icon: <Droplets size={13} />, label: 'Irrigation', color: 'bg-blue-100 text-blue-700' },
                                                        { key: 'labour', count: (savedLog.labour || []).length, icon: <Users size={13} />, label: 'Labour', color: 'bg-amber-100 text-amber-700' },
                                                        { key: 'inputs', count: (savedLog.inputs || []).length, icon: <Package size={13} />, label: 'Inputs', color: 'bg-purple-100 text-purple-700' },
                                                        { key: 'machinery', count: (savedLog.machinery || []).length, icon: <Tractor size={13} />, label: 'Machinery', color: 'bg-stone-100 text-stone-700' },
                                                        { key: 'crop', count: (savedLog.cropActivities || []).length, icon: <Sprout size={13} />, label: 'Crop Work', color: 'bg-emerald-100 text-emerald-700' },
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
                        ) : (
                            <p className="text-stone-500 mb-8">Your activity has been logged successfully.</p>
                        )}

                        {/* Understanding Meter scaffold (1d-infra, flag-gated, OFF by default).
                            WP-4 data-wiring (Task 10): pass the just-saved log's `understanding`
                            VlogScore (looked up by lastSavedLogIds in history) + the farmer's full
                            logs list for the arrival gate. Logic only — visual polish deferred to
                            founder art assets (build-infra-now-defer-ui-polish-until-assets). */}
                        {FEATURE_FLAGS.understandingMeter && (() => {
                            const savedLogId = lastSavedLogIds && lastSavedLogIds.length > 0
                                ? lastSavedLogIds[0]
                                : undefined;
                            const savedLog = savedLogId
                                ? history.find(l => l.id === savedLogId)
                                : undefined;
                            return (
                                <MeterDisplay
                                    score={savedLog?.understanding}
                                    allLogs={history}
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
                                    {lastSavedLogIds.length > 1 ? 'Review Saved Targets' : 'Review Details'}
                                </button>
                            )}

                            <button onClick={() => setMainView('reflect')} className="w-full bg-stone-100 text-stone-700 py-4 rounded-xl font-bold text-lg hover:bg-stone-200 transition-colors">
                                View Activity Heatmap
                            </button>
                            <button onClick={handleReset} className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-800 transition-colors shadow-lg shadow-emerald-900/20">
                                Add Another Log
                            </button>
                        </div>
                    </div>
                </div>
            )}




        </>
    );
};
