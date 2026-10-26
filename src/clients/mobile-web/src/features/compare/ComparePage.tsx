/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, CMP-2)
 *
 * तुलना — "are we following the schedule?", per plot, said gently (PLR-D9 T7; founder-approved preview
 * `postVoiceResult/app/ComparePage.tsx`), on REAL data: `generatePlotComparison` over the Dexie logs and the
 * TemplateCatalog schedule, for every plot of every crop (`compareRows.ts`).
 *
 * तुलना is a HOME TAB (PLR-D9 N5): no back arrow of its own — the page switcher and the bottom bar are the
 * way out. The old English page ("Today's Report Card", "WHERE YOU ARE NOW", "YOU ARE BEHIND", "Do this
 * now", eleven "210 days late" rows, a dead "Go to Schedule Page") is gone; nothing it showed is dropped:
 * the plot picker became one card per plot, and every detail lives under that card's "पूर्ण तपशील".
 *
 * A worker does not reach this tab (founder 2026-10-25) — see `core/navigation/hiddenViews.ts`.
 * Strings marked PROPOSED (Marathi) are new; the rest are the approved preview's words.
 */
import React, { useMemo, useState } from 'react';
import { CalendarDays, Mic } from 'lucide-react';
import type { CropProfile, DailyLog, Plot } from '../../types';
import { BigButton, GlassCard, SANS, SectionHead } from '../../shared/components/ui/placeUi';
import { MoneyLensDrawer } from '../finance/components/MoneyLensDrawer';
import type { FinanceFilters } from '../finance/finance.types';
import { buildCompareRows } from './compareRows';
import { ComparePlotCard } from './ComparePlotCard';
import { CompareDetails } from './CompareDetails';

interface Props {
    /** Kept for callers; the page reads each crop's own plots. */
    plots?: Plot[];
    crops: CropProfile[];
    logs: DailyLog[];
    /** "झालं, सांगा": open the real log flow for this plot. */
    onTellPlot?: (cropId: string, plotId: string) => void;
    /** "काम सांगा" when nothing is recorded yet: open the log flow. */
    onTell?: () => void;
    /** "पूर्ण शेड्यूल पाहा" / "शेड्यूल लावा": the real शेड्यूल page. */
    onOpenSchedule?: () => void;
}

export const ComparePage: React.FC<Props> = ({ crops = [], logs = [], onTellPlot, onTell, onOpenSchedule }) => {
    const [openPlotId, setOpenPlotId] = useState<string | null>(null);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters | null>(null);
    const rows = useMemo(() => buildCompareRows(crops, logs), [crops, logs]);

    const scheduleButton = onOpenSchedule && (
        <BigButton onClick={onOpenSchedule} tone="white" testId="compare-schedule">
            <CalendarDays size={20} aria-hidden="true" />पूर्ण शेड्यूल पाहा
        </BigButton>
    );

    let body: React.ReactNode;
    if (rows.length === 0) {
        body = (
            // PROPOSED (Marathi) — was "No crop data available."
            <GlassCard testId="compare-no-plots">
                <p className="m-0 text-[15px] font-bold text-stone-700">अजून पीक किंवा प्लॉट नोंदलेला नाही. पीक आणि प्लॉट जोडले की इथे शेड्यूलशी तुलना दिसेल.</p>
            </GlassCard>
        );
    } else if (logs.length === 0) {
        body = (
            // PROPOSED (Marathi) — was "Nothing to Compare / Log some activities first."
            <GlassCard testId="compare-no-logs">
                <p className="m-0 text-[15px] font-bold text-stone-700">अजून एकही काम नोंदलेलं नाही. काम सांगितलं की इथे शेड्यूलशी तुलना दिसेल.</p>
                {onTell && (
                    <div className="mt-3">
                        <BigButton onClick={onTell} testId="compare-tell-first"><Mic size={20} aria-hidden="true" />काम सांगा</BigButton>
                    </div>
                )}
            </GlassCard>
        );
    } else {
        body = rows.map(row => (
            <ComparePlotCard
                key={`${row.crop.id}:${row.plot.id}`}
                row={row}
                onTell={onTellPlot}
                onOpenSchedule={onOpenSchedule}
                detailsOpen={openPlotId === row.plot.id}
                onToggleDetails={() => setOpenPlotId(id => (id === row.plot.id ? null : row.plot.id))}
            >
                {row.summary && (
                    <CompareDetails
                        crop={row.crop}
                        plot={row.plot}
                        summary={row.summary}
                        laidOut={row.laidOut}
                        plotLogs={row.plotLogs}
                        logsCount={logs.length}
                        onOpenMoney={setMoneyLensFilters}
                    />
                )}
            </ComparePlotCard>
        ));
    }

    return (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-6 pt-3 sm:px-6" style={{ fontFamily: SANS }} data-testid="compare-page">
            <SectionHead title="शेड्यूलप्रमाणे काम होतंय का?" hint="मागचे 7 दिवस · प्रत्येक प्लॉटचं" />
            {body}
            {scheduleButton}
            <MoneyLensDrawer
                isOpen={moneyLensFilters !== null}
                onClose={() => setMoneyLensFilters(null)}
                filters={moneyLensFilters ?? {}}
            />
        </div>
    );
};
