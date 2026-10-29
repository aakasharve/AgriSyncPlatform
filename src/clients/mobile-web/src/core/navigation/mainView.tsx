// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// The "main" route's three sub-views (reflect / compare / log) were the
// largest piece of AppRouter. Lifted verbatim into render functions so the
// orchestrator stays small.

import React from 'react';
import {
    AgriLogResponse, DailyLog
} from '../../types';
import type { TodayCounts } from '../../domain/types/farm.types';
import AudioRecorder from '../../features/voice/components/AudioRecorder';
import AudioRecorderStreaming from '../../features/voice/components/AudioRecorderStreaming';
import LiveCaption from '../../features/voice/components/LiveCaption';
import { DEFAULT_VOICE_CONFIG } from '../../infrastructure/voice/types';
import ManualEntry from '../../features/logs/components/ManualEntry';
// `ArrowLeft` left with `LabourLogBanner`, its only consumer. `Users` stays —
// the success card's bucket chips still use it.
import { Leaf } from 'lucide-react';
import { getDateKey } from '../domain/services/DateKeyService';
import { buildTimelineEntries } from '../../services/transcriptTimelineService';
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
// spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the आजची कामे tab's entry flow (work
// home -> crop -> plots + mic) and the band for saying one part again. They REPLACE the owner-oversight
// SathiGuideCard + HelpBar on this screen (the guide's question is now Sathi's, in the founder's words;
// the always-disabled "श्रम साथीशी बोला" is gone — P5).
import { LogEntryFlow } from '../../features/logs/components/entry/LogEntryFlow';
import { SegmentBanner, SegmentCancel } from '../../features/logs/components/entry/SegmentBanner';
import { ReviewBackBar } from '../../features/logs/components/entry/ReviewBackBar';
import { mayShowFarmMoney } from '../../features/labour/homeAttendanceDoor';
import { toAttendanceOnlyDraft, toAttendanceSubmission, attendanceCaptureDay } from '../../features/logs/attendanceDraft';
import { draftProvenance } from '../../features/voice/draftProvenance';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
// Labour V2 R1 Task 3.4b — the Labour-owned result surface + the anchor it
// renders against. The invoking feature owns the meaning of a labour parse.
import AttendanceResult from '../../features/labour/components/AttendanceResult';
import { resolveLabourAnchor } from '../../features/labour/labourAnchor';
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
import { buildFeedEntries } from './activityFeedEntries';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';
import { ReflectPage, ComparePage } from './lazyComponents';
import { compareTabProps } from './compareTab';
import { openLogFlow } from './openLogFlow';
import { DISPLAY_TIME_ZONE } from '../../shared/utils/displayTime';

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
import { currentVoiceResult, renderVoiceResultView } from './voiceResultView';

// `TaskCloseConfirmSlot` moved to `savedView.tsx` with the branch that was
// its only consumer.

// Labour V2 R1 Task 3.4b — the labour door's stable frame. `renderLogView`
// is a plain function (no hooks — see TaskCloseConfirmSlot above), so the one
// piece of memory this branch needs lives here instead.
//
// WHY MEMORY IS NEEDED AT ALL: the बदल करा edit surface is the byte-for-byte
// ManualEntry(attendanceOnly) call, and that call CONSUMES the draft on mount
// (useManualEntryHydration → onDataConsumed → setDraftLog(null)). If the
// landing decision read the live draftLog alone, that consumption would flip
// the branch from <AttendanceResult> to a bare <ManualEntry> one commit after
// बदल करा — React replaces the subtree on the type change, the freshly
// hydrated form remounts EMPTY (initialData is null by then, and the parse is
// in no saved log to rehydrate from), and the farmer's spoken हजेरी silently
// evaporates on the CORRECTION button — a rule-1 / D9.6 violation. The latch
// keeps the LAST result element standing once the draft is consumed, so
// AttendanceResult — and the ManualEntry instance it hosts — stay mounted
// until the save routes away (useLogCommands routes logIntent==='labour' back
// to Labour, which unmounts this frame). While the draft is alive the
// children are fresh each render; the frozen element only takes over after
// consumption, when the edit surface is deliberately running on its own
// internal state anyway (useManualEntryHydration's re-run guard).
// Exported for labourResultOwnership.test.tsx's plain-node assertions (the
// same reason NotQueuedForServerBadge/LabourLogBanner are re-exported above:
// identity checks need THIS component, not a copy).
export const LabourResultHost: React.FC<{
    renderManualEntry: () => React.ReactNode;
    children: React.ReactNode;
}> = ({ renderManualEntry, children }) => {
    const lastResult = React.useRef<React.ReactNode>(null);
    // Ref write during render: idempotent (same element object on a
    // StrictMode double-render), and its only reader is this render path.
    if (children != null) lastResult.current = children;
    return <>{children ?? lastResult.current ?? renderManualEntry()}</>;
};

export const renderReflectView = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'main' || ctx.mainView !== 'reflect') return null;
    // The Activity Feed (today's logs), reached from its own button on this page. Tapping a card opens that
    // log to edit, exactly as it did on the log page.
    const openLogToEdit = (log: DailyLog) => {
        ctx.setMainView('log');
        ctx.handleEditLog(log);
    };
    const activityFeed = {
        entries: buildFeedEntries(ctx.todayLogs, {
            crops: ctx.crops, operatorNameById: ctx.operatorNameById, getLogContextSnapshot: ctx.getLogContextSnapshot, onOpenLog: openLogToEdit,
            youIds: new Set([ctx.farmerProfile?.activeOperatorId, getSessionUserId()].filter((x): x is string => !!x)),
        }),
        dateLabel: new Date().toLocaleDateString('mr-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: DISPLAY_TIME_ZONE }),
    };
    return (
        <ReflectPage
            activityFeed={activityFeed}
            history={ctx.history}
            crops={ctx.crops}
            ledgerDefaults={ctx.ledgerDefaults}
            tasks={ctx.plannedTasks}
            onUpdateTask={(task) => ctx.handleUpdateTask(task.id, task)}
            // spec: plr-d10 (I14, T2) — a to-do is added in place, in Marathi ("आठवण जोडा"), into the SAME
            // task store the English "Add New Task" sheet wrote; "बोलून सांगा" opens the voice log flow, where a
            // spoken reminder already becomes a to-do (LogFactory), through the one door (`openLogFlow.ts`).
            // This list was the sheet's ONLY opener (`SchedulerPage` takes `onOpenTaskCreator` but never calls
            // it), so the sheet — and its "Assign to" chips, whose `assigneeId` nothing ever reads — is no
            // longer reachable (P5; reported, not hidden).
            onSaveTask={ctx.handleSaveTask}
            onTellTodo={() => { openLogFlow(ctx); }}
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
            // spec: plr-d10 (I14, H16) — लक्ष द्या's "तुकडा पहा": open narrowed to that plot, once.
            focusPlotId={ctx.reflectFocusPlotId ?? null}
            onFocusPlotConsumed={() => ctx.setReflectFocusPlotId?.(null)}
        />
    );
};

// spec: plr-d10 (I14 — CMP-1/2/3) — तुलना is a home tab with no back of its own; a worker gets nothing
// here even for one frame. The wiring lives in `./compareTab.ts`.
export const renderCompareView = (ctx: AppRouterContext): React.ReactNode => {
    const props = compareTabProps(ctx);
    return props ? <ComparePage {...props} /> : null;
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
        history,
        costSnapshot, yesterdayCost,
        setRecordingSegment,
        handleReset,
        logIntent
    } = ctx;

    // The recorder's own "choose a plot first" nudge: scroll to (and briefly ring)
    // the crop/plot choice. Same scroll+ring pattern as before.
    const focusRecorder = () => {
        const el = document.getElementById('crop-selector-container');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
            setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
        }
    };

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — THE आजची कामे TAB IS NOW TWO THINGS.
    //   1. The REVIEW of a parsed entry / a log being corrected: shown exactly when the old screen
    //      showed ManualEntry (manual mode with a crop/plot chosen). Since I13 a successful parse of a
    //      RECORDING no longer lands here (it auto-saves and shows the ONE result screen); typed text,
    //      the हजेरी door, an empty parse and "बदला" still do. It did gain the one-step "मागे" back to the mic of the same plots
    //      (`ReviewBackBar`, I12-V1-M1): on the old screen the carousel + voice toggle above the form
    //      were the way to say it again or change the plots.
    //   2. Everything else: the founder-approved ENTRY flow (`LogEntryFlow`) — work home -> crop ->
    //      that crop's plots + the mic. It replaces the legacy screen that stood here: SathiGuideCard
    //      (its question is now Sathi's, in the founder's words), the carousel CropSelector (now the
    //      stepper), the permanently disabled HelpBar "श्रम साथीशी बोला" (REMOVED: a dead control, P5;
    //      help lives in सेट-अप केंद्र), the dark running-cost card (re-homed on the work home), the
    //      voice/manual InputMethodToggle (now the quiet "type instead" line + the hand-filled form),
    //      and the English "Recording…", "Select a plot to continue..." and "Cancel & Go Back".
    const showReview = mode !== 'voice' && hasActiveLogContext;

    // Saying one part again is cancelled back to the review it belongs to. It used to set the
    // status 'confirming', which nothing renders — the farmer was left on a blank screen.
    const cancelSegment = () => { setRecordingSegment(null); setMode('manual'); };

    // I12-V1-M1 — "मागे" on the review: ONE step, to the mic of the same plots (the scope is kept, so
    // the entry flow opens on its plot + mic step). The unsaved parse is dropped, exactly as the old
    // voice toggle above the form dropped it; nothing saved is touched. The draft is cleared so the
    // hand-filled form step cannot reopen with this parse in it.
    const backFromReview = () => { setDraftLog(null); setMode('voice'); };

    // Labour V2 R1 Task 3.4b — the ONE ManualEntry call, moved up (not modified) so the review below
    // and the entry flow's hand-filled form use the same form. `labourEdit`: the बदल करा surface of
    // the labour door's confirm card. It takes THAT draft's own parse provenance (never the voice
    // state's last one) and its capture day.
    const renderManualEntry = (labourEdit?: { provenance: LogProvenance | undefined; recordedDateKey: string }) => (
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
            provenance={labourEdit ? labourEdit.provenance : provenance}
            recordedDateKey={labourEdit?.recordedDateKey}
            // Labour door: the server takes only labour from the voice job.
            captureScope={logIntent === 'labour' ? 'labour' : undefined}
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
    );

    return (
        <>
            {/* IDLE / RECORDING STATE */}
            {status !== 'confirming' && status !== 'success' && status !== 'processing' && (
                <>
                    {/* spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) —
                        the banner that says why he is here and takes him back to
                        Labour Management. Purely presentational + a null-check on
                        logIntent; no effect on capture/parsing/submission. */}
                    {!recordingSegment && logIntent === 'labour' && (
                        <LabourLogBanner onBackToLabour={() => setCurrentRoute('labour')} />
                    )}

                    {showReview ? (
                        <>
                            {/* While one part is being said again, its own "रद्द करा" (SegmentCancel) is the way back. */}
                            {!recordingSegment && <ReviewBackBar onBack={backFromReview} />}
                            {recordingSegment && <SegmentBanner segment={recordingSegment} />}
                            <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {getContextColorIndicator()}
                                <div className={`transition-all duration-500 ${!isContextReady ? 'opacity-90' : ''}`}>
                                    {(() => {
                                        // Labour V2 R1 Task 3.4b — the invoking feature owns the
                                        // result surface. The generic ManualEntry(attendanceOnly)
                                        // branch is KEPT as the बदल करा edit surface.
                                        const attendanceDraft = logIntent === 'labour' ? toAttendanceOnlyDraft(draftLog) : null;
                                        if (logIntent === 'labour') {
                                            // The labour door lands on the Labour-owned screen. A
                                            // draft with no labour rows falls through to the empty
                                            // ManualEntry — "he said something this door cannot
                                            // record… He sees it and decides" survives as behaviour.
                                            // Only THIS draft's parse provenance (bound when the parse
                                            // arrived), never the voice state's last one; and the day he
                                            // spoke, which the record, its marks and the anchor all use.
                                            const ownProvenance = draftProvenance(draftLog);
                                            const captureDay = attendanceCaptureDay(ownProvenance);
                                            const anchorForDraft = resolveLabourAnchor(history, captureDay);
                                            const anchorLog = history.find((l) => anchorForDraft.state === 'anchored' && l.id === anchorForDraft.logId);
                                            return (
                                                <LabourResultHost renderManualEntry={renderManualEntry}>
                                                    {attendanceDraft && attendanceDraft.labour.length > 0 ? (
                                                        <AttendanceResult
                                                            draft={attendanceDraft}
                                                            anchor={anchorForDraft}
                                                            farmId={anchorLog?.meta?.farmId ?? currentLogContext?.selection?.[0]?.farmId}
                                                            workDate={captureDay}
                                                            // Labour only, dated and attributed (see toAttendanceSubmission).
                                                            onConfirm={(d) => { void handleManualSubmit(toAttendanceSubmission(d, ownProvenance)); setDraftLog(null); }}
                                                            renderEditSurface={() => renderManualEntry({ provenance: ownProvenance, recordedDateKey: captureDay })}
                                                            onSpeakMore={() => { setRecordingSegment('labour'); setMode('voice'); }}
                                                        />
                                                    ) : null}
                                                </LabourResultHost>
                                            );
                                        }
                                        return renderManualEntry();
                                    })()}
                                </div>
                                {recordingSegment && <SegmentCancel onCancel={cancelSegment} />}
                            </div>
                        </>
                    ) : (
                        <LogEntryFlow
                            crops={crops}
                            logScope={logScope}
                            setLogScope={setLogScope}
                            onChooseVoice={() => { if (mode !== 'voice') setMode('voice'); }}
                            labourIntent={logIntent === 'labour'}
                            onBackToLabour={() => setCurrentRoute('labour')}
                            onClearLabourIntent={() => ctx.setLogIntent(null)}
                            recordingSegment={recordingSegment}
                            onCancelSegment={cancelSegment}
                            homeRequested={ctx.logHomePending ?? false}
                            onHomeRequestHandled={ctx.consumeLogHome}
                            // H10 — the हजेरी door only for the owner tier or the owner's labour grant.
                            // merge-review m1 — opened as a PLACE over the home tabs, so हजेरी's मागे
                            // lands on home (a plain route change could hand back the history of an
                            // earlier, abandoned "बोलून हजेरी" round trip and land on the hub).
                            onOpenAttendance={ctx.canOpenAttendanceFromHome
                                ? () => (ctx.openPlace ? ctx.openPlace('labour') : setCurrentRoute('labour'))
                                : undefined}
                            // The running-cost card (c95afa1c), re-homed on the work home. A worker sees no
                            // money (PLR-D9 §6: "कामगार — … no money"), and neither does a role the
                            // server has not told this phone yet (unknown stays closed, I12-V1-m6).
                            cost={!mayShowFarmMoney(ctx.farmRole) ? undefined : {
                                today: costSnapshot.today, yesterday: yesterdayCost, soFar: costSnapshot.cropSoFar, scopeLabel: costSnapshot.scopeLabel,
                            }}
                            // wave-3.7, founder decision 3 — the question stays VISIBLE while he answers it.
                            // Read straight from the stash, so it survives a reload.
                            pinnedQuestion={mode === 'voice' ? readPendingQuestionAnswer()?.selected.resolvedPromptMr ?? null : null}
                            // wave-3.7 — leaving the mic for the hand-filled form records the SKIP honestly;
                            // never an invented answer (P4). Fire-and-forget.
                            onLeaveVoice={() => { void abandonPendingQuestionAnswer(); }}
                            renderForm={() => renderManualEntry()}
                            renderRecorder={({ onRecordingChange, onOpenForm }) => (
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
                                            onRecordingChange={onRecordingChange}
                                            onOpenForm={onOpenForm}
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
                                            onRecordingChange={onRecordingChange}
                                            onOpenForm={onOpenForm}
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
                            )}
                        />
                    )}
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
                        <div className="text-sm text-stone-400 max-w-xs mx-auto mt-2 italic">श्रम साथी तुम्ही जे बोललात ते समजून घेत आहे</div>
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
                        {/* PLR-D5 :65 — "आणखी सांगा", the word नोंद removed from the screens after he speaks. */}
                        आणखी सांगा
                    </button>
                </div>
            )}

            {/* The saved-to-ledger screen moved to `savedView.tsx` — 311 lines
                of this file, and the only branch in it that closed over nothing
                local. See that file for why it was the one that could move. */}
            {status === 'success' && (() => {
                // I12 — "आणखी सांगा" and the saved screen's मागे land on the mic of the same plots
                // (the entry flow), not on an empty hand-filled form.
                const savedCtx = { ...ctx, handleReset: () => { handleReset(); setMode('voice'); } };
                // I13 — a VOICE auto-save shows the ONE result screen; typed and हजेरी saves keep the saved card.
                const voiceResult = currentVoiceResult(ctx);
                return voiceResult ? renderVoiceResultView(savedCtx, voiceResult) : renderSavedView(savedCtx);
            })()}




        </>
    );
};

