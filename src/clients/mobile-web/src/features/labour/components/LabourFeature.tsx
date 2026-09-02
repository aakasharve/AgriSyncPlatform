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
import React, { useCallback, useRef, useState } from 'react';
import { useLabourState } from '../useLabourState';
import { resolveLabourAnchor } from '../labourAnchor';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { t as translate } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import type { DailyLog, LedgerDefaults } from '../../../types';
import type { LedgerRow } from '../labour.types';
import { BackHeader, LoadErrorBanner, LoadingState } from './LabourUiKit';
import LabourHub from './LabourHub';
import MukadamDetail from './MukadamDetail';
import PersonDetail from './PersonDetail';
import Attendance from './Attendance';
import WeeklyDashboard from './WeeklyDashboard';
import HajeriLedger from './HajeriLedger';
import HajeriCellDetail from './HajeriCellDetail';
import ReviewSheet from './ReviewSheet';
import FarmInviteQrSheet from '../../onboarding/qr/FarmInviteQrSheet';

/**
 * Labour V2 R1 Task 3.5c — the honest offline vocabulary for a queued mark,
 * resolved from the ONE source at the pinned language (the ReviewSheet.tsx:226
 * idiom): लक्षात ठेवलं ✓ — never transcribed, so a founder copy edit reaches
 * this toast automatically.
 */
const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

type ScreenName = 'hub' | 'mukadam' | 'person' | 'attendance' | 'dashboard' | 'ledger';
interface ScreenState { name: ScreenName; id?: string }

const TITLES: Record<ScreenName, string> = {
    hub: 'कामगार व्यवस्थापन',
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
    onGoToLog?: () => void;
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
}> = ({ onExit, onGoToLog, history, ledgerDefaults, lastLabourLogIds }) => {
    const { data, loading, error, refresh, timeWindow, setTimeWindow, isPreview } = useLabourState();
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
    const goToLog = onGoToLog ?? (() => showToast('🎙 आवाज नोंद लॉग स्क्रीनवर होते'));

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
        () => (history ? resolveLabourAnchor(history, getDateKey()) : undefined),
        [history],
    );

    return (
        <div className="relative flex min-h-screen flex-col bg-[#f6f7f5]">
            <BackHeader title={title} onBack={handleBack} />
            {error && <LoadErrorBanner onRetry={refresh} />}
            <div className="flex-1">
                {loading ? (
                    <LoadingState />
                ) : error ? null : (
                    /*
                     * Task 6d (spec: 2026-08-28-labour-v2-release-1, P4/P5,
                     * Ruling R8) — an outage renders ONLY the banner above,
                     * nothing here. Before this, a failed fetch still fell
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
                                onDashboard={() => push({ name: 'dashboard' })}
                                onLedger={() => push({ name: 'ledger' })}
                                onReview={() => setReviewOpen(true)}
                                onGoToLog={goToLog}
                                onInviteWorker={farm ? () => setInviteOpen(true) : undefined}
                                anchor={anchor}
                                history={history}
                                ledgerDefaults={ledgerDefaults}
                                lastLabourLogIds={lastLabourLogIds}
                                isPreview={isPreview}
                            />
                        )}
                        {cur.name === 'mukadam' && cur.id && (
                            <MukadamDetail
                                data={data}
                                personId={cur.id}
                                onOpenPerson={(id) => push({ name: 'person', id })}
                                onOpenMukadam={(id) => push({ name: 'mukadam', id })}
                                onAdvance={() => showToast('उचल — नमुना')}
                                onSettle={() => showToast('सेटल — नमुना')}
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
                        {cur.name === 'attendance' && (
                            <Attendance
                                data={data}
                                saveDisabled={!farm}
                                onSave={(marks) => {
                                    // Labour V2 R1 Task 3.5c — the REAL save. The "saved" lie that
                                    // lived here (write nothing, claim saved) is dead; the toast is
                                    // now the app's honest offline vocabulary, driven by the queue
                                    // row actually written (P10: never rendered as saved before
                                    // acknowledgement). The status→mark mapping lives HERE and only
                                    // here: present+full → Full · present+half → Half ·
                                    // present+night → Worked · half → Half · absent → Absent.
                                    if (!farm) return; // button is disabled without a farm; no invented Marathi
                                    const workDate = getDateKey();
                                    void Promise.all(marks.map((m) => MarkAttendanceCommand.enqueue({
                                        attendanceMarkId: crypto.randomUUID(),
                                        farmId: farm.farmId,
                                        fieldOperatorId: m.fieldOperatorId,
                                        workDate,
                                        ...(m.status === 'absent' ? { dayMark: 'Absent' as const }
                                            : m.status === 'half' ? { dayMark: 'Half' as const }
                                            : m.shift === 'night' ? { nightMark: 'Worked' as const }
                                            : m.shift === 'half' ? { dayMark: 'Half' as const }
                                            : { dayMark: 'Full' as const }),
                                    }))).then(() => { back(); showToast(ON_PHONE_MR); })
                                        .catch((error: unknown) => {
                                            // Named landing place: nothing was queued for at least one
                                            // mark, so neither navigate away nor claim remembering.
                                            // 'पुन्हा प्रयत्न करा' is the feature's existing retry
                                            // vocabulary (LabourUiKit.tsx) — no new Marathi.
                                            console.error(JSON.stringify({
                                                component: 'LabourFeature',
                                                action: 'attendance_mark_enqueue_failed',
                                                reason: error instanceof Error ? error.message : String(error),
                                            }));
                                            showToast('पुन्हा प्रयत्न करा');
                                        });
                                }}
                                onToast={showToast}
                            />
                        )}
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
