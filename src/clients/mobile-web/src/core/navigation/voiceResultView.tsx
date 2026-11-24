/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — what the log tab shows after a VOICE auto-save:
 * the ONE result screen (`VoiceResultContainer`) instead of the old saved card. Since lane L6b what he types to
 * Sathi ("साथीला पाठवा") is auto-saved the same way and lands here too. The saved card (`savedView.tsx`) stays for
 * the hand-filled form ("किंवा फॉर्ममध्ये स्वतः भरा") and the हजेरी door.
 *
 * Every real piece the saved card had for a voice save is kept here: the meter (now the ring, in the hero),
 * what was understood (now part by part), the "not queued" honesty badge (for EACH plot's log when he named
 * several, as the saved card listed them), Sathi's ONE question
 * (`LedgerRecognitionPanel`, flag-gated inside, remounted per save so a spoken answer settles), the daily
 * clarity line (`dailyLoop`), the conservative task close (`taskCloseConfirm`), "बदला" (lane E1: the speak-the-change
 * screen, no longer the old form) and the way back to the mic of the same plot. "कामाचा नकाशा" is the आढावा tab, one tap
 * away in the page switcher; it is not repeated on this screen.
 *
 * Lane FX-1 (founder ATT-LOG, 2026-10-31) — when this recording says what work was done but not how many people worked,
 * and the day has no headcount yet, the log page's EMPTY हजेरी card shows here too (only to someone who may take हजेरी).
 * Its "किती जण होते ते सांगा" opens the ONE mic on the crop question first, then the plot (rule CTX-1).
 *
 * spec: voice-flow-v2-2026-11-23 (Task 12; amendment M5) — behind `FEATURE_FLAGS.voiceFlowV2` only: the sticky back first takes
 * the one step inside the surface (the detail page → the saved screen), and the saved screen's 30-second self-close lands on the
 * WORK HOME (the reset, with no plot chosen: the entry flow opens on its home, so the mic is never armed by it — spec V2-5).
 */
import React from 'react';
import { FEATURE_FLAGS } from '../../app/featureFlags';
import type { VoiceResultState } from '../../app/hooks/useVoiceAutoSave';
import { LedgerRecognitionPanel } from '../../features/logs/components/LedgerRecognitionPanel';
import DailyLoopClarity from '../../features/logs/components/shramsathi/DailyLoopClarity';
import SavedScreenBack from '../../features/logs/components/shramsathi/SavedScreenBack';
// The model's own rule for "the log that carries his words" (useVoiceAutoSave keeps the same one-liner): it keeps the
// auto-save hook and its clip store out of the log tab's first load.
import { primaryOf } from '../../features/logs/components/voiceResult/resultModel';
import { resultStr } from '../../features/logs/components/voiceResult/resultStrings';
import { cropNameIn } from '../../shared/names/namesIn';
import { placeWords } from '../../shared/names/placeWords';
import { stashPendingQuestionAnswer } from '../../features/logs/services/pendingQuestionAnswer';
import { requestSpeak, type SpeakRequestInput } from '../speak/speakStore';
import { findConfirmableTaskCloses } from '../../features/logs/services/taskAutoClose';
import { logger } from '../../infrastructure/observability/Logger';
import type { DailyLog, LogScope } from '../../types';
import { getDateKey } from '../domain/services/DateKeyService';
import type { AppRouterContext } from './routeContext';
import { VoiceResultContainer } from './lazyComponents';
import { TaskCloseConfirmSlot } from './savedView';
import { TodayAttendanceCard } from '../../features/logs/components/entry/TodayAttendanceCard';
import { entryAttendance } from '../../features/logs/components/entry/todayAttendance';
import { leaveDetailIfOpen } from '../../features/logs/components/voiceFlowV2/detailBack';
import { VoiceLayer } from '../../features/logs/components/voiceFlowV2/VoiceLayer';

/** No plot chosen: the entry flow opens on the work home (`LogEntryFlow` starts at home without a selection). */
const WORK_HOME_SCOPE: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

/** The voice result to show: only while it is the latest save (a typed save afterwards gets the saved card). */
export const currentVoiceResult = (ctx: AppRouterContext): VoiceResultState | null => {
    const r = ctx.voiceResult;
    return r && r.logIds.length > 0 && r.logIds[0] === ctx.lastSavedLogIds?.[0] ? r : null;
};

/**
 * "Crop · plot, plot" in the app's language; the whole farm by its own name. spec I18: `cropName` is stored as the
 * server sent it (English only) and is SHOWN through the one crop-name helper ("Grapes" → "द्राक्ष" in Marathi mode);
 * the plot names are his own words, as written.
 */
export const placeOf = (logs: readonly DailyLog[], language?: string, farmCrops?: readonly { id: string; plots?: readonly unknown[] }[]): string => {
    const sel = logs.flatMap(l => l.context?.selection ?? []);
    if (sel.length === 0 || sel.every(s => s.cropId === 'FARM_GLOBAL')) return resultStr(language).wholeFarm;
    const crops = [...new Set(sel.map(s => cropNameIn(s.cropName, language)).filter(Boolean))];
    const plots = [...new Set(sel.flatMap(s => s.selectedPlotNames ?? []).filter(Boolean))];
    // The crop's whole plot count (when the caller knows the farm): lets the shared rule say "सर्व १५ प्लॉट" for every plot of a crop.
    const totalOf = (cropId: string | undefined): number | undefined => {
        const total = farmCrops?.find(c => c.id === cropId)?.plots?.length;
        return total && total > 0 ? total : undefined;
    };
    // Lane OF fix 1 (10): one crop — the shared rule (a plot named after its crop is said alone; from 4 plots a count, founder 2026-11-21).
    if (crops.length === 1) {
        const first = sel.find(s => s.cropName);
        return placeWords(first?.cropName, plots, language, totalOf(first?.cropId)) || crops[0];
    }
    // Several crops: each crop with its own plots (the same rule per crop), joined by the app's " + ".
    const byCrop = [...new Set(sel.filter(s => s.cropId !== 'FARM_GLOBAL' && s.cropName).map(s => s.cropName))].map(name => {
        const mine = sel.filter(s => s.cropName === name);
        const names = [...new Set(mine.flatMap(s => s.selectedPlotNames ?? []).filter(Boolean))];
        return placeWords(name, names, language, totalOf(mine[0]?.cropId));
    }).filter(Boolean);
    return byCrop.join(' + ') || [crops.join(', '), plots.join(', ')].filter(Boolean).join(' · ');
};

/**
 * Lane MIC-1 — every speak button on this screen opens THE ONE mic for the plots of this recording (no pickers) and
 * lands back on this screen, which then shows the new recording with the day: "आणखी सांगा", a part not told yet ("…
 * सांगितलं नाही. दाबा आणि बोला"), and Sathi's question answered by speaking.
 */
const speakHere = (input: Omit<SpeakRequestInput, 'returnTo'>): void => {
    requestSpeak({ ...input, returnTo: { route: 'main', mainView: 'log' } });
};

export const renderVoiceResultView = (ctx: AppRouterContext, result: VoiceResultState): React.ReactNode => {
    // lane F1 — Sathi's question reads the RECORD (a pull now keeps every item's details); the phone's own write
    // stands in only while the record has not reached the history yet, never over it.
    const logs = result.logIds.map(id => ctx.history.find(l => l.id === id) ?? result.written?.find(l => l.id === id))
        .filter((l): l is DailyLog => !!l);
    const savedLog = primaryOf(logs);
    const selection = savedLog?.context?.selection?.[0];
    const farmId = ctx.activeFarmId ?? selection?.farmId ?? null;
    const topTaskClose = FEATURE_FLAGS.taskCloseConfirm
        ? findConfirmableTaskCloses(ctx.plannedTasks ?? [], savedLog, savedLog?.date ?? getDateKey())[0]
        : undefined;

    // Lane FX-1 — the empty हजेरी card: this recording states work, no headcount, and the day has none yet.
    const attendance = ctx.canOpenAttendanceFromHome ? entryAttendance(logs, ctx.history) : null;

    const extras = (FEATURE_FLAGS.dailyLoop || topTaskClose || attendance) ? (
        <div className="space-y-3">
            {attendance && (
                // No place given: the ONE mic asks the crop, then the plot, then listens (CTX-1) — never the mic directly.
                <TodayAttendanceCard state={attendance} onTell={() => speakHere({ purpose: 'fillPart', context: { part: 'labour' } })} />
            )}
            {/* H1 (HONESTY-1, P4): the count is drawn only when it stands on a real plan - never on a stand-in or an unchecked default. */}
            {FEATURE_FLAGS.dailyLoop && ctx.todayDayState.planIsReal === true && <DailyLoopClarity done={ctx.todayDayState.completedCount} left={ctx.todayDayState.pendingCount} />}
            {topTaskClose && (
                <TaskCloseConfirmSlot key={topTaskClose.task.id} candidate={topTaskClose} onConfirm={(candidate) => {
                    ctx.handleUpdateTask(candidate.task.id, { status: 'done', completedAt: new Date().toISOString() });
                    logger.info('task_close.confirmed', {
                        component: 'TaskCloseConfirm', action: 'task_close_confirmed', taskId: candidate.task.id,
                        plotId: candidate.task.plotId, matchedActivityTitle: candidate.matchedActivityTitle,
                    });
                }} />
            )}
        </div>
    ) : undefined;

    const backBar = <SavedScreenBack onBack={ctx.handleReset} onStepBack={FEATURE_FLAGS.voiceFlowV2 ? leaveDetailIfOpen : undefined} variant={FEATURE_FLAGS.voiceFlowV2 ? 'chip' : 'bar'} />;
    const container = (
        <>
            {/* Loaded on first show (lazyComponents); the brief wait shows nothing rather than an English "Loading...". */}
            <React.Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" data-testid="voice-result-loading" />}>
                <VoiceResultContainer
                    result={result}
                    history={ctx.history}
                    farmerProfile={ctx.farmerProfile}
                    operatorNameById={ctx.operatorNameById}
                    farmId={farmId}
                    crops={ctx.crops}
                    farmRole={ctx.farmRole}
                    placeLabel={language => placeOf(logs, language, ctx.crops)}
                    syncQueuedById={new Map(ctx.lastSavedLogSummary.map(s => [s.logId, s.syncQueued] as const))}
                    onEdit={ctx.handleEditLog}
                    onMoveDay={ctx.moveSavedDay}
                    onBack={ctx.handleReset}
                    onAutoClose={FEATURE_FLAGS.voiceFlowV2 ? () => { ctx.handleReset(); ctx.setLogScope(WORK_HOME_SCOPE); } : undefined}
                    onAddAnother={() => speakHere({ purpose: 'addToDay', context: { place: 'current' } })}
                    onTellMore={part => speakHere({ purpose: 'fillPart', context: { place: 'current', part } })}
                    questionPanel={savedLog ? (
                        <LedgerRecognitionPanel
                            key={savedLog.id}
                            farmId={farmId}
                            plotId={selection?.selectedPlotIds?.[0] ?? null}
                            crop={selection?.cropName ?? ''}
                            todayLocalDate={savedLog.date}
                            crops={ctx.crops}
                            savedLog={savedLog}
                            allLogs={ctx.history}
                            weather={ctx.weatherData}
                            // Lane L6b — the founder's designed amber question card (SathiQuestionCard).
                            look="sathi"
                            // Lane DFES-Q (founder D-D, D-H) - "why wasn't this done?" only for a person who plans the work, and its
                            // "केलं, पण नोंद केली नाही" opens that day's "त्या दिवसाचं काम सांगा" on the ONE mic.
                            mayPlanWork={ctx.mayPlanWork ?? ctx.farmRole === 'PrimaryOwner'}
                            onTellPastDay={dateKey => speakHere({ purpose: 'addToDay', context: { date: dateKey } })}
                            // wave-3.7, founder decision 3 — the tap writes nothing; it stashes the answer and hands
                            // him the SAME microphone (no second recording surface) — lane MIC-1: the ONE mic, with
                            // the question kept in sight; the next result screen settles the answer.
                            onAnswerBySpeaking={(pending) => {
                                stashPendingQuestionAnswer(pending);
                                speakHere({ purpose: 'answerQuestion', context: { place: 'current', question: pending.selected.resolvedPromptMr } });
                            }}
                        />
                    ) : undefined}
                    extras={extras}
                />
            </React.Suspense>
        </>
    );
    // spec voice-flow-v2-2026-11-23 (F2): the saved screen is the last part of the voice journey's ONE full-screen layer: its top row
    // holds "मागे" and the place chip; the bottom bar ("आणखी सांगा") is the layer's bottom slot.
    if (FEATURE_FLAGS.voiceFlowV2) {
        return <VoiceLayer step="saved" back={backBar} placeLabel={language => placeOf(logs, language, ctx.crops)}>{container}</VoiceLayer>;
    }
    return (
        <>
            {/* The existing sticky back (BUG-2 2026-08-14): reachable however far he scrolls, and it owns the
                phone's hardware back. Same one step as the bottom bar's "मागे": the mic of the same plot. */}
            {backBar}
            {container}
        </>
    );
};
