/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — "पूर्ण तपशील" for one plot: EVERY part
 * the old तुलना page had (founder rule: a redesign keeps every real feature), folded under the plot's card
 * and said in Marathi:
 *   आता कुठे आहोत (stage — in Marathi or not at all, `stageNameMr`, season day, phase day, gentle status, done / open / extra, water hours) ·
 *   खर्च (spent so far, with the MoneyLens money link) · कामाचे प्रकार (the four category cards) ·
 *   आतापर्यंतची यादी (the checklist) · शेड्यूलवर तुमचं काम (the schedule replica) · जास्तीचं काम.
 *
 * Two numbers the old page invented are now "—" (P4): the PLANNED cost (it was the spend so far divided by
 * the work done, times the work planned — an extrapolation, nobody planned it) and, when the plot has no
 * recorded watering time, the EXPECTED water hours (it silently assumed 60 minutes a watering).
 * One old figure is gone, not moved: the "Delta Rs" line (the spend minus that invented planned cost). A
 * difference from an invented number is itself invented, so it is not shown at all (P4); the spend so far
 * stays, with its money link.
 * Every Marathi string here is PROPOSED (Marathi).
 *
 * "आतापर्यंतची यादी" (was "This Phase Checklist") is the checklist of EVERY stage that has begun — what the
 * data always held — so an older open item the plot card counts can be found here.
 */
import React, { useMemo } from 'react';
import { CheckCircle2, Circle, Droplets, PlusCircle } from 'lucide-react';
import type { CropProfile, DailyLog, Plot, PlotComparisonSummary } from '../../types';
import { Chip, GlassCard } from '../../shared/components/ui/placeUi';
import { MoneyChip } from '../finance/components/MoneyChip';
import { financeSelectors } from '../finance/financeSelectors';
import type { FinanceFilters } from '../finance/finance.types';
import {
    buildCompareReport,
    CATEGORY_META,
    CATEGORY_ORDER,
    getCategoryCardStyles,
    getCategoryIcon,
    getHealthText,
    getStatusText,
    type FarmerStatus,
} from './comparePageHelpers';
import { CompareReplica } from './CompareReplica';
import { stageNameMr } from '../../shared/utils/stageNameMr';

const STATUS_TONE: Record<FarmerStatus, 'green' | 'amber' | 'rose' | 'blue'> = {
    ON_TRACK: 'green', SLIGHT_LAG: 'amber', BEHIND: 'rose', EXTRA: 'blue',
};

const Title: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <div className="mb-2">
        <h3 className="m-0 text-[16px] font-extrabold text-stone-900">{children}</h3>
        {hint && <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">{hint}</p>}
    </div>
);

const Tile: React.FC<{ label: string; value: React.ReactNode; tone: string; testId?: string; line?: string }> = ({ label, value, tone, testId, line }) => (
    <div className={`rounded-2xl border bg-white p-2.5 ${tone}`} data-testid={testId}>
        <p className="m-0 text-[12.5px] font-extrabold">{label}</p>
        <p className="m-0 mt-0.5 text-[18px] font-extrabold text-stone-900">{value}</p>
        {line && <p className="m-0 text-[12px] font-bold text-stone-600">{line}</p>}
    </div>
);

interface Props {
    crop: CropProfile;
    plot: Plot;
    summary: PlotComparisonSummary;
    plotLogs: DailyLog[];
    /** Re-reads the money figure when new logs land (the finance store is module-level). */
    logsCount: number;
    onOpenMoney: (filters: FinanceFilters) => void;
}

export const CompareDetails: React.FC<Props> = ({ crop, plot, summary, plotLogs, logsCount, onOpenMoney }) => {
    const report = useMemo(() => buildCompareReport(summary, plot, plotLogs), [summary, plot, plotLogs]);
    const spent = useMemo(
        () => financeSelectors.getTotalCost({ cropId: crop.id, plotId: plot.id }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `logsCount` is the recompute trigger (the finance store is module-level), as on the old page.
        [crop.id, plot.id, logsCount],
    );
    if (!report) return null;

    const waterTimeKnown = Boolean(plot.irrigationPlan?.durationMinutes);
    const id = plot.id;
    // The template's stage names are English ("Vegetative Growth"): said in Marathi, or not shown.
    const stage = stageNameMr(report.stageName, report.stageCode);

    return (
        <div className="mt-3 space-y-3" data-testid={`compare-details-${id}`}>
            <GlassCard testId={`compare-now-${id}`}>
                <Title>आता कुठे आहोत</Title>
                {stage && <p className="m-0 text-[16px] font-extrabold text-stone-900" data-testid={`compare-stage-${id}`}>{stage}</p>}
                <p className="m-0 text-[13.5px] font-semibold text-stone-600">हंगामाचा दिवस {report.seasonDay} · टप्प्याचा दिवस {report.stageDay}</p>
                <div className="mt-2"><Chip tone={STATUS_TONE[report.status]}>{getStatusText(report.status)}</Chip></div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <Tile label="झालं" value={report.doneCount} tone="border-emerald-200 text-emerald-800" testId={`compare-done-${id}`} />
                    <Tile label="अजून नोंद नाही" value={report.missedCount} tone="border-amber-200 text-amber-800" testId={`compare-open-${id}`} />
                    <Tile label="जास्तीचं" value={report.extraCount} tone="border-blue-200 text-blue-800" testId={`compare-extra-count-${id}`} />
                    <Tile
                        label="पाणी (तास)"
                        tone="border-cyan-200 text-cyan-800"
                        testId={`compare-water-${id}`}
                        value={<span className="inline-flex items-center gap-1"><Droplets size={15} aria-hidden="true" />{report.actualWaterHours} / {waterTimeKnown ? report.expectedWaterHours : '—'}</span>}
                        line={waterTimeKnown ? `राहिलेले ${report.waterGapHours} तास` : 'पाण्याची वेळ नोंदलेली नाही'}
                    />
                </div>
            </GlassCard>

            <GlassCard testId={`compare-money-${id}`}>
                <Title hint="या प्लॉटवर आतापर्यंत झालेला खर्च">खर्च</Title>
                <div className="flex items-center justify-between gap-2">
                    <p className="m-0 text-[14px] font-bold text-stone-700">ठरलेला खर्च</p>
                    <p className="m-0 text-[16px] font-extrabold text-stone-900" data-testid={`compare-planned-cost-${id}`}>—</p>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="m-0 text-[14px] font-bold text-stone-700">झालेला खर्च</p>
                    <MoneyChip amount={spent} onClick={() => onOpenMoney({ cropId: crop.id, plotId: plot.id })} />
                </div>
            </GlassCard>

            <GlassCard testId={`compare-categories-${id}`}>
                <Title hint="पाणी, खत, फवारणी आणि कामं — कुठे काम बाकी आहे">कामाचे प्रकार</Title>
                <div className="grid gap-2 sm:grid-cols-2">
                    {report.categoryCards.map(card => (
                        <div key={card.category} className={`rounded-2xl border p-3 ${getCategoryCardStyles(card.health)}`} data-testid={`compare-category-${id}-${card.category}`}>
                            <div className="flex items-center justify-between gap-2">
                                <p className="m-0 flex items-center gap-2 text-[15px] font-extrabold text-stone-900">{getCategoryIcon(card.category, 16, 'text-stone-700')}{card.label}</p>
                                <Chip tone={card.health === 'BEHIND' ? 'amber' : card.health === 'EXTRA' ? 'blue' : 'green'}>{getHealthText(card.health)}</Chip>
                            </div>
                            <p className="m-0 mt-1.5 text-[13px] font-bold text-stone-700">झालं {card.doneCount} · बाकी {card.missedCount} · जास्तीचं {card.extraCount}</p>
                            {card.biggestMisses.length > 0 && <p className="m-0 mt-1 text-[13px] font-bold text-amber-800">बाकी: {card.biggestMisses.join(', ')}</p>}
                        </div>
                    ))}
                </div>
            </GlassCard>

            <GlassCard testId={`compare-checklist-${id}`}>
                {/* PROPOSED (Marathi) — every stage that has begun, not this one alone (`buildCompareReport` →
                    `stagesForAnalysis`), so the card's "त्याआधीची N कामं … पूर्ण तपशीलात पाहा" points at a list
                    that really shows them. */}
                <Title hint="सुरू झालेल्या सगळ्या टप्प्यांची कामं · हिरवी खूण = झालं · रिकामं वर्तुळ = अजून नोंद नाही">आतापर्यंतची यादी</Title>
                <div className="space-y-3">
                    {CATEGORY_ORDER.map(category => {
                        const items = report.mustDoItems.filter(item => item.category === category);
                        if (items.length === 0) return null;
                        const done = items.filter(item => item.isDone).length;
                        return (
                            <div key={category} className="overflow-hidden rounded-2xl border border-stone-200">
                                <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-2">
                                    <p className="m-0 flex items-center gap-2 text-[14px] font-extrabold text-stone-900">{getCategoryIcon(category, 15, 'text-stone-700')}{CATEGORY_META[category].label}</p>
                                    <p className="m-0 text-[12.5px] font-bold text-stone-700">झालं {done} · बाकी {items.length - done}</p>
                                </div>
                                <div className="space-y-1.5 p-2">
                                    {items.map(item => (
                                        <div key={item.id} className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${item.isDone ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`}>
                                            {item.isDone
                                                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                                                : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />}
                                            <div className="min-w-0 flex-1">
                                                <p className="m-0 text-[14px] font-extrabold text-stone-900">{item.name}</p>
                                                <p className="m-0 text-[12.5px] font-semibold text-stone-600">{item.plannedText} · {item.actualText}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </GlassCard>

            <CompareReplica report={report} plotId={id} />

            <GlassCard testId={`compare-extra-${id}`}>
                <Title hint="शेड्यूलमध्ये नसलेलं, पण केलेलं काम — कारणासह">जास्तीचं केलेलं काम</Title>
                {report.extraItems.length === 0 ? (
                    // PROPOSED (Marathi) — the list covers every stage that has begun, not this one alone.
                    <p className="m-0 rounded-xl bg-stone-50 p-3 text-[14px] font-bold text-stone-600" data-testid={`compare-extra-none-${id}`}>आतापर्यंत जास्तीचं काम नाही.</p>
                ) : (
                    <div className="space-y-2">
                        {report.extraItems.map(item => (
                            <div key={item.id} className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                                <PlusCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <p className="m-0 text-[14px] font-extrabold text-blue-900">{item.name}</p>
                                    <p className="m-0 text-[12.5px] font-semibold text-blue-800">{item.doneText}</p>
                                    <p className="m-0 text-[12.5px] font-bold text-blue-700">{item.reasonText}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </GlassCard>
        </div>
    );
};
