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
import type { DailyLog, LedgerDefaults } from '../../../types';
import { BackHeader, LoadErrorBanner } from './LabourUiKit';
import LabourHub from './LabourHub';
import MukadamDetail from './MukadamDetail';
import PersonDetail from './PersonDetail';
import Attendance from './Attendance';
import WeeklyDashboard from './WeeklyDashboard';
import HajeriLedger from './HajeriLedger';
import ReviewSheet from './ReviewSheet';

type ScreenName = 'hub' | 'mukadam' | 'person' | 'attendance' | 'dashboard' | 'ledger';
interface ScreenState { name: ScreenName; id?: string }

const TITLES: Record<ScreenName, string> = {
    hub: 'कामगार व्यवस्थापन',
    mukadam: 'मुकादम',
    person: 'कामगार',
    attendance: 'आजची हजेरी',
    dashboard: 'या आठवड्याचा आढावा',
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
    const { data, error, refresh } = useLabourState();
    const [stack, setStack] = useState<ScreenState[]>([{ name: 'hub' }]);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);

    const cur = stack[stack.length - 1];
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

    return (
        <div className="relative flex min-h-screen flex-col bg-[#f6f7f5]">
            <BackHeader title={title} onBack={handleBack} />
            {error && <LoadErrorBanner onRetry={refresh} />}
            <div className="flex-1">
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
                        history={history}
                        ledgerDefaults={ledgerDefaults}
                        lastLabourLogIds={lastLabourLogIds}
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
                    <Attendance data={data} onSave={() => { back(); showToast('जतन झाले → मंजुरीसाठी'); }} onToast={showToast} onGoToLog={goToLog} />
                )}
                {cur.name === 'dashboard' && (
                    <WeeklyDashboard data={data} onReview={() => setReviewOpen(true)} onLedger={() => push({ name: 'ledger' })} onToast={showToast} />
                )}
                {cur.name === 'ledger' && <HajeriLedger data={data} onToast={showToast} />}
            </div>

            <ReviewSheet open={reviewOpen} data={data} onClose={() => setReviewOpen(false)} onToast={showToast} />

            {toast && (
                <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">{toast}</div>
            )}
        </div>
    );
};

export default LabourFeature;
