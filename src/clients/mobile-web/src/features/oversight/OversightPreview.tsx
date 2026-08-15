/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * DEV-ONLY preview — Owner Oversight Loop, no backend / Postgres / OTP login
 * required. Renders the REAL `CanonicalStrip` + `WaitingDrawer` components,
 * driven by the REAL `buildOversightModel` selector run over a handful of
 * fabricated-for-preview `DailyLog` fixtures below — never a hand-written
 * `OversightModel` literal. Going through the real selector is the point: it
 * proves the derivation (unseen filtering, the अज्ञात bucket, delegated
 * decisions, the acknowledge-collapses-the-briefing behaviour) actually
 * works, not just that the two presentational components can render *some*
 * props.
 *
 * Access: http://localhost:3001/?preview=oversight
 * Reachability: gated by `IS_OVERSIGHT_PREVIEW_ENABLED` (`app/featureFlags.ts`,
 * wraps `import.meta.env.DEV`) + `React.lazy` in `App.tsx` — see that file's
 * comment beside `OversightPreviewLazy` for why this is stronger than a bare
 * query-param check.
 *
 * WHAT IS SEEDED vs REAL
 * -----------------------
 *  SEEDED (this file only): `SEED_LOGS`, `OPERATOR_NAME_BY_ID`, the farm
 *  name/plot count, `unverifiedCount` / `yesterdayNotClosed` /
 *  `failedSendCount` / `approvalHolderName`. In production these come from
 *  `app/helpers/appContentOversightInputs.ts` + `useSyncQueueStatus`
 *  (`features/context/components/AppHeader.tsx`).
 *  REAL, unmodified: `CanonicalStrip`, `WaitingDrawer`, `buildOversightModel`,
 *  every string resolved through `oversightTranslations.ts`.
 *
 * The farm name ("Arve Farm") and two of the four plot names ("Grapes A",
 * "Sugarcane B") are the same literals `AppHeader.oversight.test.tsx`
 * already uses for this app's one seeded demo farmer (Purvesh Arve, whose
 * real farm has 4 plots — 2 Grapes + 2 Sugarcane) — reused here, not
 * invented a second time. The other two plot names ("Grapes B",
 * "Sugarcane A") follow that same crop+letter convention. The three named
 * people (Rokade, Jadhav, Shinde) are plain Latin surnames per the task
 * brief; no Marathi is written anywhere in this file — every farmer-facing
 * string still comes from `oversightTranslations.ts` via
 * `resolveOversightString`, exactly like the two real components it drives.
 */
import React, { useMemo, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';

import CanonicalStrip from './components/CanonicalStrip';
import WaitingDrawer from './components/WaitingDrawer';
import { buildOversightModel } from './oversightSelectors';
import type { OversightDecision, OversightPerson } from './oversightSelectors';
import { resolveOversightString } from '../../i18n/oversightTranslations';
import type { Language } from '../../i18n/language';
import type { DailyLog, FarmContext } from '../../domain/types/log.types';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

// ---------------------------------------------------------------------------
// SEED FIXTURES — fabricated for this preview only, never fetched from
// Dexie. Shape mirrors the hand-built `DailyLog` fixtures
// `oversightSelectors.test.ts` / `AppHeader.oversight.test.tsx` already use.
// ---------------------------------------------------------------------------

function plotContext(cropId: string, cropName: string, plotId: string, plotName: string): FarmContext {
    return {
        selection: [{ cropId, cropName, selectedPlotIds: [plotId], selectedPlotNames: [plotName] }],
    };
}

function zeroFinancials() {
    return { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 };
}

const FARM_NAME = 'Arve Farm'; // same literal AppHeader.oversight.test.tsx's farmContext fixture uses
const PLOT_COUNT = 4; // the seeded demo farmer's real farm: 2 Grapes plots + 2 Sugarcane plots

const OPERATOR_NAME_BY_ID: Record<string, string> = {
    'op-rokade': 'Rokade',
    'op-jadhav': 'Jadhav',
    'op-shinde': 'Shinde',
};

const NOW_ISO = '2026-08-15T18:00:00.000Z';
// -> `model.sinceDays` comes out to 4, computed by `buildOversightModel`
// itself from these two instants — never a literal written for it.
const INITIAL_CHECKPOINT_ISO = '2026-08-11T09:00:00.000Z';

const SEED_LOGS: DailyLog[] = [
    // Rokade — irrigation on Grapes A, then hired labour on Grapes B.
    {
        id: 'log-rokade-1',
        date: '2026-08-12',
        context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [{ id: 'irr-1', method: 'drip', source: 'well' }],
        labour: [],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-08-12T07:30:00.000Z', createdByOperatorId: 'op-rokade' },
        financialSummary: zeroFinancials(),
    },
    {
        id: 'log-rokade-2',
        date: '2026-08-13',
        context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-b', 'Grapes B'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [{ id: 'lab-1', type: 'HIRED', count: 3 }],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-08-13T17:00:00.000Z', createdByOperatorId: 'op-rokade' },
        financialSummary: zeroFinancials(),
    },
    // Jadhav — machinery then a spray, both on Sugarcane A. Also the one
    // DELEGATED decision holder below (the approval row renders view-only).
    {
        id: 'log-jadhav-1',
        date: '2026-08-13',
        context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-a', 'Sugarcane A'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [{ id: 'mach-1', type: 'tractor', ownership: 'owned' }],
        meta: { createdAtISO: '2026-08-13T08:00:00.000Z', createdByOperatorId: 'op-jadhav' },
        financialSummary: zeroFinancials(),
    },
    {
        id: 'log-jadhav-2',
        date: '2026-08-14',
        context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-a', 'Sugarcane A'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [{ id: 'inp-1', method: 'Spray', mix: [] }],
        machinery: [],
        meta: { createdAtISO: '2026-08-14T06:45:00.000Z', createdByOperatorId: 'op-jadhav' },
        financialSummary: zeroFinancials(),
    },
    // Shinde — a crop activity plus an observation note, on Sugarcane B.
    {
        id: 'log-shinde-1',
        date: '2026-08-14',
        context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-b', 'Sugarcane B'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [{ id: 'act-1', title: 'Weeding' }],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        observations: [{
            id: 'obs-1',
            plotId: 'plot-sugarcane-b',
            dateKey: '2026-08-14',
            timestamp: '2026-08-14T16:00:00.000Z',
            textRaw: 'Weeding done, minor pest seen near the border row.',
            noteType: 'observation',
            severity: 'normal',
            source: 'manual',
        }],
        meta: { createdAtISO: '2026-08-14T16:00:00.000Z', createdByOperatorId: 'op-shinde' },
        financialSummary: zeroFinancials(),
    },
    // No `meta.createdByOperatorId` — the अज्ञात (unattributed) row.
    {
        id: 'log-unattributed-1',
        date: '2026-08-15',
        context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [{ id: 'irr-2', method: 'drip', source: 'well' }],
        labour: [],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-08-15T05:00:00.000Z' }, // creator never captured
        financialSummary: zeroFinancials(),
    },
    // Control — arrived BEFORE `INITIAL_CHECKPOINT_ISO`, so it must already
    // read as seen even before anyone presses the Seen control. Proves the
    // page is deriving "unseen" from real arrival times, not just showing
    // every seed log unconditionally.
    {
        id: 'log-rokade-old',
        date: '2026-08-09',
        context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [{ id: 'lab-old', type: 'HIRED', count: 2 }],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-08-09T10:00:00.000Z', createdByOperatorId: 'op-rokade' },
        financialSummary: zeroFinancials(),
    },
];

type DrawerStatus = 'idle' | 'saving' | 'failed';

const PreviewBanner: React.FC = () => (
    <div
        data-testid="oversight-preview-banner"
        className="border-b border-amber-300 bg-amber-100 px-3 py-2 text-center text-[11px] font-bold text-amber-800"
        style={ENGLISH_FONT}
    >
        PREVIEW — seeded data, not a real farm
    </div>
);

const OversightPreview: React.FC = () => {
    const [language, setLanguage] = useState<Language>('mr');
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [checkpointISO, setCheckpointISO] = useState<string | null>(INITIAL_CHECKPOINT_ISO);
    const [status, setStatus] = useState<DrawerStatus>('idle');
    const [lastAction, setLastAction] = useState<string>('—');

    // The one call that matters for this whole file: everything below is
    // rendered off the REAL selector's output, not a hand-written model.
    const model = useMemo(() => buildOversightModel({
        logs: SEED_LOGS,
        checkpointISO,
        nowISO: NOW_ISO,
        operatorNameById: OPERATOR_NAME_BY_ID,
        unverifiedCount: 3,
        yesterdayNotClosed: true,
        failedSendCount: 1,
        approvalHolderName: 'Jadhav', // the one DELEGATED decision (view-only row)
    }), [checkpointISO]);

    // Mirrors `useOversightAcknowledgement`'s own contract (spec §P-D): flips
    // to 'saving' immediately, then only a "confirmed" write advances
    // `checkpointISO` — never optimistic. This is the single most important
    // control on this page: watch Band 1 (decisions, from the fixed inputs
    // above) hold still while Band 2 (the briefing, derived from
    // `checkpointISO`) collapses to empty.
    const handleAcknowledge = () => {
        setStatus('saving');
        window.setTimeout(() => {
            setCheckpointISO(NOW_ISO);
            setStatus('idle');
            setLastAction('Acknowledged — checkpoint advanced to now');
        }, 300);
    };

    const handleReset = () => {
        setCheckpointISO(INITIAL_CHECKPOINT_ISO);
        setStatus('idle');
        setLastAction('Reset to the unseen state');
    };

    const handleOpenDecision = (decision: OversightDecision) => {
        setLastAction(`Would open decision detail: ${decision.kind}`);
    };

    const handleOpenPerson = (person: OversightPerson) => {
        setLastAction(`Would open person detail: ${person.name || 'अज्ञात'}`);
    };

    const waitingLabelText = resolveOversightString(language, 'waitingLabel');

    return (
        <div className="mx-auto min-h-screen max-w-md bg-stone-50 pb-16">
            <PreviewBanner />

            <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-white px-3 py-2">
                <span className="text-[12px] font-bold text-stone-500" style={ENGLISH_FONT}>
                    Owner Oversight Loop — dev preview
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        data-testid="oversight-preview-lang-mr"
                        onClick={() => setLanguage('mr')}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${language === 'mr' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}
                        style={ENGLISH_FONT}
                    >
                        Marathi
                    </button>
                    <button
                        type="button"
                        data-testid="oversight-preview-lang-en"
                        onClick={() => setLanguage('en')}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${language === 'en' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}
                        style={ENGLISH_FONT}
                    >
                        English
                    </button>
                </div>
            </div>

            <div className="border-b border-stone-100 bg-stone-50/60 px-3 py-2">
                <CanonicalStrip
                    language={language}
                    farmName={FARM_NAME}
                    plotCount={PLOT_COUNT}
                    waitingCount={model.waitingCount}
                    onOpenFarmSwitcher={() => setLastAction('Would open the farm switcher (not wired in this preview)')}
                    onToggleWaiting={() => setIsDrawerOpen(true)}
                />
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-[11px] text-stone-400" style={ENGLISH_FONT}>
                    Last action: {lastAction}
                </p>
                <button
                    type="button"
                    data-testid="oversight-preview-reset"
                    onClick={handleReset}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-bold text-stone-600"
                    style={ENGLISH_FONT}
                >
                    <RotateCcw size={12} strokeWidth={2.5} />
                    Reset
                </button>
            </div>

            {isDrawerOpen && (
                <div
                    className="fixed inset-0 z-[150] flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
                    onClick={() => setIsDrawerOpen(false)}
                >
                    <div
                        data-testid="waiting-drawer-sheet"
                        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-stone-50 shadow-2xl sm:rounded-3xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3.5 py-3">
                            <span className="text-[15px] font-extrabold text-stone-800" style={fontStyleFor(waitingLabelText)}>
                                {waitingLabelText}
                            </span>
                            <button
                                type="button"
                                onClick={() => setIsDrawerOpen(false)}
                                data-testid="waiting-drawer-close"
                                aria-label="Close"
                                className="rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <WaitingDrawer
                            language={language}
                            model={model}
                            status={status}
                            onAcknowledge={handleAcknowledge}
                            onOpenDecision={handleOpenDecision}
                            onOpenPerson={handleOpenPerson}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default OversightPreview;
