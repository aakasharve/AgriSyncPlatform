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
import { stashPendingQuestionAnswer } from '../../features/logs/services/pendingQuestionAnswer';
import { requestSpeak, type SpeakRequestInput } from '../speak/speakStore';
import { findConfirmableTaskCloses } from '../../features/logs/services/taskAutoClose';
import { logger } from '../../infrastructure/observability/Logger';
import type { DailyLog } from '../../types';
import { getDateKey } from '../domain/services/DateKeyService';
import type { AppRouterContext } from './routeContext';
import { VoiceResultContainer } from './lazyComponents';
import { TaskCloseConfirmSlot } from './savedView';

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
export const placeOf = (logs: readonly DailyLog[], language?: string): string => {
    const sel = logs.flatMap(l => l.context?.selection ?? []);
    if (sel.length === 0 || sel.every(s => s.cropId === 'FARM_GLOBAL')) return resultStr(language).wholeFarm;
    const crops = [...new Set(sel.map(s => cropNameIn(s.cropName, language)).filter(Boolean))];
    const plots = [...new Set(sel.flatMap(s => s.selectedPlotNames ?? []).filter(Boolean))];
    return [crops.join(', '), plots.join(', ')].filter(Boolean).join(' · ');
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

    const extras = (FEATURE_FLAGS.dailyLoop || topTaskClose) ? (
        <div className="space-y-3">
            {FEATURE_FLAGS.dailyLoop && <DailyLoopClarity done={ctx.todayDayState.completedCount} left={ctx.todayDayState.pendingCount} />}
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

    return (
        <>
            {/* The existing sticky back (BUG-2 2026-08-14): reachable however far he scrolls, and it owns the
                phone's hardware back. Same one step as the bottom bar's "मागे": the mic of the same plot. */}
            <SavedScreenBack onBack={ctx.handleReset} />
            {/* Loaded on first show (lazyComponents); the brief wait shows nothing rather than an English "Loading...". */}
            <React.Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" data-testid="voice-result-loading" />}>
                <VoiceResultContainer
                    result={result}
                    history={ctx.history}
                    farmerProfile={ctx.farmerProfile}
                    operatorNameById={ctx.operatorNameById}
                    farmId={farmId}
                    farmRole={ctx.farmRole}
                    placeLabel={language => placeOf(logs, language)}
                    syncQueuedById={new Map(ctx.lastSavedLogSummary.map(s => [s.logId, s.syncQueued] as const))}
                    onEdit={ctx.handleEditLog}
                    onBack={ctx.handleReset}
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
};
