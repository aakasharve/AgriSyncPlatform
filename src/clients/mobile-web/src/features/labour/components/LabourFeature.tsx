/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourFeature — the Labour Management root. Registered as ONE app route
 * ('labour'); all sub-navigation is LOCAL here (a small screen stack) so the
 * shipped nav machine is untouched. `onExit` returns to Profile. Data comes
 * from useLabourState() (mock now, real backend later behind the same hook).
 *
 * `onGoToLog` is the single doorway every labour mic (hub voice card,
 * attendance mic) uses to reach the app's ONE canonical voice-capture
 * surface — the log page. It is optional: the real app always supplies it
 * (`simpleRoutes.tsx` wires it to `setCurrentRoute('main')`), but the
 * `?preview=labour` mount (`LabourPreview.tsx`) has no router at all, so it
 * omits the prop on purpose — the fallback below surfaces the feature's own
 * existing toast instead of crashing or attempting to navigate.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLabourState } from '../useLabourState';
import { resolveEffectiveLabourAnchor } from '../labourAnchor';
import { resolveStatedHeadcount } from '../attendanceDisagreement';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getRootStore } from '../../../app/state/RootStore';
import { hasDeclaredNoWorkDay } from '../../../core/navigation/noWorkDay';
import type { BucketIssueType } from '../../../domain/types/log.types';
import { isAttendanceDoorEnabled } from '../attendanceDoor';
import { ClipboardCheck } from 'lucide-react';
import {
    listParkedAttendanceContradictions,
    buildContradictionQuestion,
    answerAttendanceContradiction,
    type ContradictionQuestion,
    type ParkedAttendanceContradiction,
} from '../data/attendanceParked';
import {
    listRefusedLabourState,
    EMPTY_REFUSED_LABOUR_STATE,
    type RefusedLabourState,
} from '../data/attendanceRefused';
import { readCachedRoster } from '../data/fieldOperatorRosterCache';
import { ConflictResolutionService } from '../../sync/conflict/ConflictResolutionService';
import { t as translate } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import type { DailyLog, LedgerDefaults } from '../../../types';
import type { LedgerRow } from '../labour.types';
import { BackHeader, LoadErrorBanner, LoadingState } from './LabourUiKit';
import LabourHub from './LabourHub';
import MukadamDetail from './MukadamDetail';
import PersonDetail from './PersonDetail';
import Attendance, { type ManualAttendanceMark } from './Attendance';
import WeeklyDashboard from './WeeklyDashboard';
import HajeriLedger from './HajeriLedger';
import HajeriCellDetail from './HajeriCellDetail';
import AttendanceContradictionPrompt from './AttendanceContradictionPrompt';
import RefusedLabourNotice from './RefusedLabourNotice';
import ReviewSheet from './ReviewSheet';
import { createEarlyAccessTapHandler, earlyAccessToastText } from '../earlyAccess';
import FarmInviteQrSheet from '../../onboarding/qr/FarmInviteQrSheet';

/**
 * Labour V2 R1 Task 3.5c — the honest offline vocabulary for a queued mark,
 * resolved from the ONE source at the pinned language (the ReviewSheet.tsx:226
 * idiom): लक्षात ठेवलं ✓ — never transcribed, so a founder copy edit reaches
 * this toast automatically.
 */
const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

type ScreenName = 'hub' | 'mukadam' | 'person' | 'attendance' | 'dashboard' | 'ledger';
interface ScreenState { name: ScreenName; id?: string; mode?: 'normal' | 'no-work' }

const TITLES: Record<ScreenName, string> = {
    /*
     * FOUNDER VOCABULARY RULE (2026-09-03) — farmer-facing copy may not say
     * "Labour" / "Labour Management", and may not name a CLASS OF PERSON.
     * `कामगार व्यवस्थापन` was both: it is literally "Labour Management", and
     * `कामगार` classifies the human. Replaced with the smallest neutral
     * WORK-CENTRED wording — `कामाच्या नोंदी`, "the records of the work" —
     * which describes what the screen holds, not who the people are.
     *
     * This is PROVISIONAL and deliberately not a brand: the founder runs a
     * dedicated naming session, which owns the permanent noun. Internal
     * names (LabourFeature, LabourAssignment, the `labour` route) are
     * UNTOUCHED by design — presentation and internal vocabulary are allowed
     * to diverge.
     */
    hub: 'कामाचा हिशोब',
    mukadam: 'मुकादम',
    person: 'कामगार',
    attendance: 'आजची हजेरी',
    /*
     * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — was
     * `या आठवड्याचा आढावा` ("this week's review"). Commit `da07f668` made the
     * server's default window all-time and gave the farmer three others to
     * choose from, so a title naming ONE fixed period is false three times out
     * of four and false by default. Shortened to `आढावा` (founder-approved):
     * the title now names the SCREEN, and the control on it names the period.
     * No new word — this is the existing title with the week clause deleted.
     */
    dashboard: 'आढावा',
    ledger: 'हजेरी वही',
};

export const LabourFeature: React.FC<{
    onExit: () => void;
    onGoToLog?: (opts?: { anchoredByServer?: boolean }) => void;
    /**
     * Task 3.5 — optional log-history threading so the hub can show a
     * labour-only "just logged" summary after an auto-return from the log
     * page. All three are optional together: `LabourPreview.tsx`'s bare
     * `?preview=labour` mount has no app history or ledger settings to
     * offer, and must stay crash-free (renders the hub exactly as before).
     */
    history?: DailyLog[];
    ledgerDefaults?: LedgerDefaults;
    lastLabourLogIds?: string[];
    /**
     * The rained-out-day lane (`काम झालं नाही, पण मजूर आले`). `onDeclareNoWorkDay`
     * records the day as a declared no-work day through the app's one existing
     * path and resolves TRUE only when that really happened. Both are absent on
     * the bare `?preview=labour` mount, and then the lane's door is not drawn:
     * a door that could only half-record the day would be a false promise.
     */
    onBeginNoWorkLane?: () => void;
    onDeclareNoWorkDay?: (cause?: BucketIssueType) => Promise<boolean>;
}> = ({ onExit, onGoToLog, history, ledgerDefaults, lastLabourLogIds, onBeginNoWorkLane, onDeclareNoWorkDay }) => {
    const { data, loading, error, refresh, timeWindow, setTimeWindow } = useLabourState();
    // Safe (non-throwing) outside a provider (`?preview=labour` mounts with
    // none) — `farm` stays `null` there, and the QR-invite CTA below hides
    // itself accordingly.
    const farmCtx = useOptionalFarmContext();
    const farm = farmCtx?.currentFarm ?? null;
    const [inviteOpen, setInviteOpen] = useState(false);
    const [stack, setStack] = useState<ScreenState[]>([{ name: 'hub' }]);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [cellDetail, setCellDetail] = React.useState<{ row: LedgerRow; dayIndex: number } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);
    const earlyTap = useRef(createEarlyAccessTapHandler()).current;

    /**
     * Screen honesty (Decision 4b, 2026-07-19; extended Task 6d, 2026-08-28)
     * — a money screen must never show a confident ₹0 it hasn't verified.
     * This used to gate only the VERY FIRST load (`hasLoadedOnceRef` latched
     * once `loading` went false, so a later background refresh — e.g.
     * ReviewSheet's `onApproved -> refresh()` — updated the screen "in
     * place" instead of blanking it). But `useLabourState.ts:135` resets
     * `data` to `EMPTY_LABOUR_DATA` before EVERY fetch, first or not, so
     * "in place" actually meant a flash of fabricated zeros/"no workers"
     * over the farmer's real numbers on every refresh. Gating on `loading`
     * itself removes that flash: any fetch in flight shows the honest
     * spinner, never `EMPTY_LABOUR_DATA` dressed up as real.
     */

    const cur = stack[stack.length - 1];

    /**
     * TASK 17 (spec: 2026-08-28-labour-v2-release-1) — R14 SUPERSEDED.
     * Task 12 reset `timeWindow` to `DEFAULT_LABOUR_WINDOW` here the instant
     * the visible screen stopped being आढावा, because at the time a narrowed
     * window leaking to the hub would silently shrink every worker's काम
     * झालं figure with no control on that screen explaining why. The founder
     * has since ruled the opposite: his window choice should be REMEMBERED
     * across visits, not reset.
     *
     * That reversal is safe because R14's own hazard is independently gone:
     * per-person `recordedWages`/`paid` now read from the ALL-TIME
     * dictionaries and `daysActive` from the membership grant date, not the
     * window (`GetLabourDataHandler.cs`, R15/Task 13) — so nothing per-person
     * moves with `timeWindow` any more, on any screen, regardless of what
     * आढावा is set to. There is therefore nothing left for a reset to
     * protect against, and no effect here at all: `timeWindow` and
     * `setTimeWindow` pass straight through to `WeeklyDashboard` below, and
     * persistence across this component's own unmount/remount (leaving and
     * re-entering the whole Labour feature, not just आढावा) is
     * `useLabourState.ts`'s job via `SessionStore` — this component holds no
     * state of its own to reset or preserve.
     */

    /**
     * Task 9 (B001) — the PARKED contradiction questions for this farm.
     * EditSurfaceRegistry has routed attendance.mark conflicts here since
     * 3.5c; this is the render that was missing at the end of that route.
     * A park whose question the local rebuild cannot reproduce is filtered
     * (never fabricated — attendanceParked.ts's own rule); the refused mark
     * itself stays visible in the register as weaker intent either way.
     */
    const [parkedQuestions, setParkedQuestions] = useState<Array<{
        park: ParkedAttendanceContradiction; question: ContradictionQuestion;
    }>>([]);
    const farmId = farm?.farmId;
    /**
     * Journey fixes D1/D6 - what the SERVER REFUSED (a mark with no
     * responsibility behind it, a no-work declaration that did not land),
     * read from the same parked rows the ⚠ badge counts.
     */
    const [refused, setRefused] = useState<RefusedLabourState>(EMPTY_REFUSED_LABOUR_STATE);
    const loadParkedQuestions = useCallback(async () => {
        if (!farmId) { setParkedQuestions([]); setRefused(EMPTY_REFUSED_LABOUR_STATE); return; }
        try {
            setRefused(await listRefusedLabourState(farmId));
        } catch {
            setRefused(EMPTY_REFUSED_LABOUR_STATE); // no queue, nothing refused
        }
        try {
            const parks = await listParkedAttendanceContradictions(farmId);
            setParkedQuestions(parks.flatMap((park) => {
                const question = buildContradictionQuestion(park, history ?? []);
                return question === null ? [] : [{ park, question }];
            }));
        } catch {
            // Storage unavailable (a dev shell without indexedDB): no parks
            // can exist where no queue exists — render none, never crash.
            setParkedQuestions([]);
        }
    }, [farmId, history]);
    useEffect(() => { void loadParkedQuestions(); }, [loadParkedQuestions]);

    const retryRefused = useCallback(() => {
        void (async () => {
            for (const id of refused.clientRequestIds) {
                try { await ConflictResolutionService.retry(id); } catch { /* the notice stays if it fails */ }
            }
            await loadParkedQuestions();
        })();
    }, [refused, loadParkedQuestions]);

    const push = useCallback((s: ScreenState) => setStack((st) => [...st, s]), []);
    const back = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);
    const handleBack = () => { if (stack.length > 1) back(); else onExit(); };
    const showToast = useCallback((m: string) => {
        setToast(m);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2000);
    }, []);
    // No router available (e.g. bare `?preview=labour` mount) → surface the
    // existing toast instead of navigating or crashing.
    const goToLogFallback = () => showToast('🎙 बोलून नोंद करायची असेल तर कामाच्या पानावर जा.');

    const title = cur.name === 'mukadam' && cur.id ? (data.people[cur.id]?.name ?? 'मुकादम')
        : cur.name === 'person' && cur.id ? (data.people[cur.id]?.name ?? 'कामगार')
            : TITLES[cur.name];

    // Labour V2 R1 Task 3.1 — the labour mic anchor, derived from the same
    // optional log history the hub already receives. The real app always
    // supplies `history` (AppRouterContext.history is a required DailyLog[]),
    // so every real mount gets a concrete anchored/no-anchor verdict. The bare
    // `?preview=labour` mount has NO history to judge from — there `anchor`
    // stays undefined, which the hub's contract reads as "keep today's
    // behaviour: hero active" (its onGoToLog fallback is already a toast).
    const anchor = React.useMemo(
        () => (history ? resolveEffectiveLabourAnchor(history, getDateKey(), data.home.onFarmToday) : undefined),
        [history, data.home.onFarmToday],
    );
    // The route re-checks the anchor from THIS device's history; tell it when
    // the day is anchored by the server's read-out instead (journey fix D4).
    const goToLog = onGoToLog
        ? () => onGoToLog({ anchoredByServer: anchor?.state === 'anchored' && anchor.source === 'server' })
        : goToLogFallback;

    /**
     * Refetch when the sync actor settles (SYNC_DONE). Nothing refetched after
     * an acknowledgement before, so a cell the farmer just marked stayed
     * "weaker" (queued) until he re-entered the screen. The refetch resets the
     * hook to its loading state, which would unmount the attendance screen and
     * throw away what he has tapped, so while that screen is open the refresh
     * is deferred until he leaves it.
     */
    const settledRef = useRef<() => void>(() => {});
    settledRef.current = () => { if (farm) { refresh(); void loadParkedQuestions(); } };
    const onAttendanceScreenRef = useRef(false);
    onAttendanceScreenRef.current = cur.name === 'attendance';
    const refreshOwedRef = useRef(false);
    useEffect(() => {
        const sync = getRootStore().sync;
        let previous = String(sync.getSnapshot().value);
        const subscription = sync.subscribe((snapshot) => {
            const now = String(snapshot.value);
            const finishedCycle = previous === 'syncing' && now !== 'syncing' && now !== 'offline';
            previous = now;
            if (!finishedCycle) return;
            if (onAttendanceScreenRef.current) refreshOwedRef.current = true;
            else settledRef.current();
        });
        return () => subscription.unsubscribe();
    }, []);
    useEffect(() => {
        if (cur.name !== 'attendance' && refreshOwedRef.current) {
            refreshOwedRef.current = false;
            settledRef.current();
        }
    }, [cur.name]);

    /**
     * The REAL save of the manual door. One `attendance.mark` per person the
     * farmer stated something about (untouched people never reach here); each
     * is queued locally, so what we may claim is "remembered on the phone"
     * (P10), never "saved" - the register shows it weaker until acknowledged.
     * Rejecting leaves the screen open so he can press the button again; the
     * value-keyed request id makes a retry safe (no duplicate marks).
     */
    const saveManualAttendance = async (marks: ManualAttendanceMark[], noWorkCause?: BucketIssueType): Promise<void> => {
        if (!farm) throw new Error('no farm context'); // the button is disabled without a farm
        const workDate = getDateKey();
        try {
            await Promise.all(marks.map(({ fieldOperatorId, ...facts }) => MarkAttendanceCommand.enqueue({
                attendanceMarkId: crypto.randomUUID(),
                farmId: farm.farmId,
                fieldOperatorId,
                workDate,
                ...facts,
            })));
            if (cur.mode === 'no-work' && onDeclareNoWorkDay && !hasDeclaredNoWorkDay(history ?? [], workDate)) {
                if (!(await onDeclareNoWorkDay(noWorkCause))) throw new Error('no_work_day_not_declared');
            }
        } catch (error: unknown) {
            // Named landing place: do not navigate away and do not claim
            // remembering. 'पुन्हा प्रयत्न करा' is the feature's existing retry
            // vocabulary (LabourUiKit.tsx) - no new Marathi.
            console.error(JSON.stringify({
                component: 'LabourFeature',
                action: 'attendance_mark_enqueue_failed',
                reason: error instanceof Error ? error.message : String(error),
            }));
            showToast('पुन्हा प्रयत्न करा');
            throw error;
        }
        // Best effort: the queue is the durable path, the periodic worker retries.
        void Promise.resolve().then(() => backgroundSyncWorker.triggerNow()).catch(() => { /* queued either way */ });
        showToast(ON_PHONE_MR);
        // Show him where it landed: replace this screen with the हजेरी वही.
        setStack((st) => [...st.slice(0, -1), { name: 'ledger' }]);
        // AFTER the queue rows exist, so the register composes the new marks
        // (attendanceOverlay); offline the refetch fails into the local-plane
        // register with the marks intact.
        refresh();
        void loadParkedQuestions();
    };

    const attendanceScreen = (
        <Attendance
            data={data}
            farmId={farm?.farmId}
            mode={cur.mode ?? 'normal'}
            statedHeadcount={resolveStatedHeadcount(anchor, data.home.onFarmToday)}
            onSave={saveManualAttendance}
            onToast={showToast}
        />
    );

    return (
        <div className="relative flex min-h-screen flex-col bg-[#f6f7f5]">
            <BackHeader
                title={title}
                onBack={handleBack}
                onTitleTap={() => {
                    // Founder-only early access: 7 quick taps toggle the per-device attendance door.
                    const r = earlyTap();
                    if (r !== null) showToast(earlyAccessToastText(r));
                }}
            />
            {error && <LoadErrorBanner onRetry={refresh} />}
            <div className="flex-1">
                {/* Task 9 (B001) — the parked contradiction question(s). The
                    end of EditSurfaceRegistry's 'labour' route: rendered above
                    whatever screen is open, because an unanswered question is
                    what stands between a spoken mark and the register. */}
                {!loading && parkedQuestions.map(({ park, question }) => (
                    <AttendanceContradictionPrompt
                        key={park.clientRequestId}
                        question={question}
                        onAnswer={(fact) => {
                            void (async () => {
                                const answered = await answerAttendanceContradiction(park, fact);
                                if (answered) {
                                    // The mark is PENDING again — remembered on
                                    // the phone, not saved: the honest claim.
                                    showToast(ON_PHONE_MR);
                                }
                                await loadParkedQuestions();
                            })();
                        }}
                    />
                ))}
                {!loading && (
                    <RefusedLabourNotice
                        state={refused}
                        nameOf={(operatorId) => {
                            const fromRegister = data.ledger.rows.find((r) => r.fieldOperatorId === operatorId)?.name;
                            if (fromRegister) return fromRegister;
                            return farmId ? readCachedRoster(farmId)?.find((o) => o.id === operatorId)?.displayName : undefined;
                        }}
                        onRetry={retryRefused}
                    />
                )}
                {loading ? (
                    <LoadingState />
                ) : error ? (
                    /*
                     * Task 9 (B001) — the outage is no longer a dead-end when
                     * THIS DEVICE holds attendance facts: useLabourState
                     * serves the offline register (view 'own', queue intent
                     * weaker) and it renders here BESIDE the banner — the
                     * banner stays the honest label for everything else this
                     * screen cannot claim (money, workers, review). An empty
                     * plane keeps rendering nothing, exactly as Task 6d ruled.
                     */
                    cur.name === 'attendance' ? attendanceScreen : (
                        <>
                            {/*
                              * The manual door is a CAPTURE door, not a claim: it
                              * needs no server answer (the roster is cached on the
                              * device, marks queue locally), so an outage must not
                              * lock the farmer out of taking हजेरी. The hub stays
                              * withheld; only this door and the local register show.
                              */}
                            {isAttendanceDoorEnabled() && (
                                <button type="button" data-testid="attendance-door-offline"
                                    onClick={() => push({ name: 'attendance' })}
                                    className="mx-4 mt-2 flex min-h-[92px] w-[calc(100%-2rem)] items-center gap-3.5 rounded-[20px] border border-stone-100 bg-white p-4 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
                                    <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><ClipboardCheck size={20} /></span>
                                    <span className="min-w-0">
                                        <span className="block text-[19px] font-bold leading-tight text-stone-800">हजेरी घ्या</span>
                                        <span className="mt-0.5 block truncate text-[16px] text-stone-500">आज कोण आलं</span>
                                    </span>
                                </button>
                            )}
                            {data.ledger.rows.length > 0 ? (
                                <HajeriLedger
                                    data={data}
                                    onToast={showToast}
                                    onOpenCell={(row, dayIndex) => setCellDetail({ row, dayIndex })}
                                />
                            ) : null}
                        </>
                    )
                ) : (
                    /*
                     * Task 6d (spec: 2026-08-28-labour-v2-release-1, P4/P5,
                     * Ruling R8) — an outage withholds every CLAIM: the
                     * banner above, plus (Task 9) only what the device can
                     * evidence — the local-plane register, never the hub.
                     * Before this, a failed fetch still fell
                     * through to this content switch over
                     * `EMPTY_LABOUR_DATA`, so the hub asserted "अजून कोणी
                     * कामगार जोडलेला नाही" (no worker added yet) and "0
                     * नोंदी" to a farmer whose data simply hadn't loaded —
                     * a false SENTENCE, not just a false number. This branch
                     * is keyed on `error` alone, never on "data looks
                     * empty": when the fetch genuinely SUCCEEDS with no
                     * workers (or no farm has resolved yet — both come
                     * through as `error: false`, per `useLabourState.ts`),
                     * that same empty-state message is TRUE and must still
                     * render — this `else` branch is exactly what does that.
                     */
                    <>
                        {cur.name === 'hub' && (
                            <LabourHub
                                data={data}
                                onOpenMukadam={(id) => push({ name: 'mukadam', id })}
                                onOpenPerson={(id) => push({ name: 'person', id })}
                                onAttendance={() => push({ name: 'attendance' })}
                                onNoWorkAttendance={farm && onDeclareNoWorkDay ? () => {
                                    onBeginNoWorkLane?.();
                                    push({ name: 'attendance', mode: 'no-work' });
                                } : undefined}
                                onDashboard={() => push({ name: 'dashboard' })}
                                onLedger={() => push({ name: 'ledger' })}
                                onReview={() => setReviewOpen(true)}
                                onGoToLog={goToLog}
                                onInviteWorker={farm ? () => setInviteOpen(true) : undefined}
                                anchor={anchor}
                                history={history}
                                ledgerDefaults={ledgerDefaults}
                                lastLabourLogIds={lastLabourLogIds}
                                rosterPeople={farmId ? readCachedRoster(farmId)?.filter((o) => o.isActive) ?? undefined : undefined}
                            />
                        )}
                        {cur.name === 'mukadam' && cur.id && (
                            <MukadamDetail
                                data={data}
                                personId={cur.id}
                                onOpenPerson={(id) => push({ name: 'person', id })}
                                onOpenMukadam={(id) => push({ name: 'mukadam', id })}
                                onAdvance={() => showToast('उचल — नमुना')}
                                onSettle={() => showToast('पैसे द्या — नमुना')}
                            />
                        )}
                        {cur.name === 'person' && cur.id && (
                            <PersonDetail
                                data={data}
                                personId={cur.id}
                                onAdvance={() => showToast('उचल — नमुना')}
                                onSettle={() => showToast('पैसे दिले ✓ — नमुना')}
                                onToast={showToast}
                            />
                        )}
                        {cur.name === 'attendance' && attendanceScreen}
                        {cur.name === 'dashboard' && (
                            <WeeklyDashboard
                                data={data}
                                onReview={() => setReviewOpen(true)}
                                onLedger={() => push({ name: 'ledger' })}
                                onToast={showToast}
                                timeWindow={timeWindow}
                                onTimeWindowChange={setTimeWindow}
                            />
                        )}
                        {cur.name === 'ledger' && (
                            <HajeriLedger
                                data={data}
                                onToast={showToast}
                                onOpenCell={(row, dayIndex) => setCellDetail({ row, dayIndex })}
                            />
                        )}
                    </>
                )}
            </div>

            {/* `farmId` + `history` (Labour V1 Task 13) are what let a review
                card offer the OPTIONAL Field Operator picker: the farm the
                roster belongs to, and the local log the engagement id was
                minted on. Both already exist here; neither is required, and
                without them the sheet renders exactly as it did before. */}
            <ReviewSheet open={reviewOpen} data={data} onClose={() => setReviewOpen(false)} onToast={showToast} onApproved={refresh} farmId={farm?.farmId} history={history} />

            {cellDetail && (
                <HajeriCellDetail
                    row={cellDetail.row}
                    dayIndex={cellDetail.dayIndex}
                    dayIso={data.ledger.days[cellDetail.dayIndex] ?? ''}
                    onClose={() => setCellDetail(null)}
                />
            )}

            {farm && (
                <FarmInviteQrSheet
                    isOpen={inviteOpen}
                    onClose={() => setInviteOpen(false)}
                    farmId={farm.farmId}
                    farmName={farm.name}
                />
            )}

            {toast && (
                <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">{toast}</div>
            )}
        </div>
    );
};

export default LabourFeature;
