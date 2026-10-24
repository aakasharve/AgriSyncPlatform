/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The saved-to-ledger screen — what the farmer sees after a record commits.
 *
 * WHY IT LIVES HERE: `mainView.tsx` was 978 lines against an 800-line budget
 * (`npm run check:file-sizes`), and this branch was 311 of them. PURE CODE
 * MOVE — the JSX below is byte-identical to the `status === 'success'` branch
 * it came from, and `renderLogView` now calls it in exactly the place that
 * branch used to sit.
 *
 * WHY THIS BRANCH AND NOT ANOTHER: it was the only block in that file that
 * closes over NOTHING local. It reads 49 fields off `AppRouterContext` and not
 * one value computed inside `renderLogView`, so it could move without threading
 * a single argument through — which is why this is a move rather than a
 * refactor, and why it carries no behaviour risk.
 */
// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// The "main" route's three sub-views (reflect / compare / log) were the
// largest piece of AppRouter. Lifted verbatim into render functions so the
// orchestrator stays small.

import React from 'react';
import { CropSymbol } from '../../features/context/components/CropSelector';
// `ArrowLeft` left with `LabourLogBanner`, its only consumer. `Users` stays —
// the success card's bucket chips still use it.
import { Leaf, Droplets, Users, Package, Tractor, Sprout } from 'lucide-react';
import { getDateKey } from '../domain/services/DateKeyService';
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
// spec: owner-oversight-loop (Task 13, changes 3 + 5) — real components
// (not inlined here), because both call `useLanguage()` internally and this
// file's render functions are plain functions, not components — see
// `mainViewComponents.tsx`'s header for why that hook rule forces the split.
import {
    NotQueuedForServerBadge,
    SavedLocallyHeadline,
} from './mainViewComponents';
import { LedgerRecognitionPanel } from '../../features/logs/components/LedgerRecognitionPanel';
import {
    stashPendingQuestionAnswer, } from '../../features/logs/services/pendingQuestionAnswer';
import DailyLoopClarity from '../../features/logs/components/shramsathi/DailyLoopClarity';
import DayUnderstandingCard from '../../features/logs/components/shramsathi/DayUnderstandingCard';
import SathiSaidCard from '../../features/logs/components/shramsathi/SathiSaidCard';
import SavedScreenBack from '../../features/logs/components/shramsathi/SavedScreenBack';
import SurfaceSection from '../../features/logs/components/shramsathi/SurfaceSection';
import { findConfirmableTaskCloses, type TaskCloseCandidate } from '../../features/logs/services/taskAutoClose';
import TaskCloseConfirm from '../../features/logs/components/shramsathi/TaskCloseConfirm';
import { logger } from '../../infrastructure/observability/Logger';

import { AppRouterContext } from './routeContext';
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

export const renderSavedView = (ctx: AppRouterContext): React.ReactNode => {
    const {
        setMainView,
        // Read by dfes-companion surfaces only: `weatherData` by
        // LedgerRecognitionPanel (Task 4A weather questions), `todayDayState` by
        // DailyLoopClarity and by the done/left counters further down. It was
        // ALSO read by `DailyLoopHero` until the founder's 2026-08-29 ruling
        // removed that component (see its former render site below); the field
        // itself stays because those two other readers still need it.
        weatherData, todayDayState,
        crops, setMode, setStatus,
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
        plannedTasks, handleUpdateTask,
        history, handleEditLog,
        lastSavedLogSummary, lastSavedLogIds, mockHistory, handleReset
    } = ctx;

    return (
        <>
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
                                                        { key: 'labour', count: (savedLog.labour || []).length, icon: <Users size={13} />, label: 'जण', color: 'bg-amber-100 text-amber-700' },
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
        </>
    );
};
