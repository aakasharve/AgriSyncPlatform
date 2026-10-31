/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * उत्पन्न आणि खर्च — the old "Yield & Cost Analysis" block (and its "In hand income" card) in plain words,
 * on the real records (figures: `moneyModel.ts`):
 *   - आतापर्यंत: total spent, total received, received − spent, and how far each crop's harvest is recorded;
 *   - the spend chart: by day (week view) or by week (month view) — the calendar's switch drives it, as it
 *     always did — then by crop and by plot, each bar with its share of the total (what the old 3D pie told);
 *   - खर्च कशावर झाला: मजुरी / खत-औषध / यंत्र / इतर;
 *   - "पैसे व हिशोब उघडा": the old "Open Finance Ledger".
 * Nothing recorded → "—" and a plain line saying so; never ₹ 0 (P4). Every Marathi string is PROPOSED.
 *
 * Lane RF: every figure comes from the server's cost ledger (`moneyModel.ts`). Money this person may not see is "—"
 * with one line saying why, and no door into the money pages (founder D-22); a total made from an incomplete set
 * says it is partial, and why, in his language (`reflectCopy`).
 */
import React, { useState } from 'react';
import { ChevronRight, TrendingUp, Wallet } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { reflectCopy } from '../reflectCopy';
import { topOf, type MoneyFigure, type PartialReason, type SeasonTotals, type Spend, type SpendBar, type SpendPoint, type SpendRange } from './moneyModel';
import { rupees } from './reflectDates';
import { Num, Tap } from './ui';
import { cropNameIn } from '../../../shared/names/namesIn';

const DASH = '—';
const money = (n: number | null) => (n === null ? DASH : rupees(n));
const compact = (n: number) => (n === 0 ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)}ह` : String(n));

/** "अपूर्ण" beside a figure built from an incomplete set. */
const PartialTag: React.FC<{ figure: MoneyFigure; testId: string }> = ({ figure, testId }) => {
    const copy = reflectCopy(useOptionalLanguage()?.language);
    return figure.partial.length > 0 && figure.amount !== null
        ? <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11.5px] font-extrabold text-amber-800" data-testid={testId}>{copy.partialTag}</span>
        : null;
};

/** Why the figures above are partial (each reason once), or why they are hidden. */
export const MoneyNotes: React.FC<{ figures: readonly MoneyFigure[]; testId: string }> = ({ figures, testId }) => {
    const copy = reflectCopy(useOptionalLanguage()?.language);
    // Spans, not paragraphs: these lines also sit inside the in-hand card, which is a button.
    if (figures.some(f => f.hidden)) return <span className="block text-[12.5px] font-bold text-stone-600" data-testid={`${testId}-hidden`}>{copy.moneyHidden}</span>;
    // Also when the total is still "—": money he told that has not reached the ledger is why, and he should know.
    const reasons = [...new Set(figures.flatMap(f => f.partial))];
    const line: Record<PartialReason, string> = { notOnServer: copy.partialNotOnServer, unknownDirection: copy.partialUnknownDirection, unchecked: copy.partialUnchecked };
    return reasons.length > 0
        ? <span className="block space-y-0.5" data-testid={`${testId}-partial`}>{reasons.map(r => <span key={r} className="block text-[12.5px] font-bold text-amber-800" data-testid={`${testId}-partial-${r}`}>{line[r]}</span>)}</span>
        : null;
};

/** The old "In hand income" card, in words. Opens उत्पन्न — never for money he may not see. */
export const InHandCard: React.FC<{ figure: MoneyFigure; onOpen?: () => void }> = ({ figure, onOpen }) => {
    const open = figure.hidden ? undefined : onOpen;
    const copy = reflectCopy(useOptionalLanguage()?.language);
    return (
        <Tap onClick={open} disabled={!open} data-testid="overview-money"
            className="flex w-full items-center gap-3 rounded-3xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-3.5 text-left shadow-[0_8px_22px_-14px_rgba(4,120,87,0.5)]">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow"><TrendingUp size={24} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
                {/* Review B008 — in his language (`reflectCopy.inHandLabel`): the ledger's income so far. */}
                <span className="block text-[13px] font-extrabold text-emerald-800" data-testid="in-hand-label">{copy.inHandLabel}</span>
                <span className="block"><Num className="text-[22px] font-extrabold leading-tight text-stone-900" testId="in-hand-amount">{money(figure.amount)}</Num><PartialTag figure={figure} testId="in-hand-partial" /></span>
                {figure.amount === null && !figure.hidden && <span className="block text-[12.5px] font-semibold text-stone-500">अजून विक्री किंवा उत्पन्न नोंदलेलं नाही</span>}
                <MoneyNotes figures={[figure]} testId="in-hand" />
            </span>
            {open && <ChevronRight size={22} className="shrink-0 text-emerald-700" aria-hidden="true" />}
        </Tap>
    );
};

const Figure: React.FC<{ label: string; figure: MoneyFigure; testId: string; className?: string; tone?: string; children?: React.ReactNode }> = ({ label, figure, testId, className = '', tone = 'text-stone-900', children }) => {
    const value = figure.amount;
    return (
        <div className={`rounded-2xl bg-white p-3 ring-1 ring-stone-200 ${className}`}>
            <p className="m-0 text-[12.5px] font-extrabold text-stone-500">{label}</p>
            <span className="block">
                <Num className={`text-[19px] font-extrabold ${tone}`} testId={testId}>{value === null ? DASH : (value < 0 ? `− ${rupees(-value)}` : rupees(value))}</Num>
                <PartialTag figure={figure} testId={`${testId}-partial`} />
            </span>
            {children}
        </div>
    );
};

type View = 'total' | 'crop' | 'plot';

const ShareBars: React.FC<{ bars: readonly SpendBar[]; total: number; testId: string }> = ({ bars, total, testId }) => {
    const max = Math.max(1, ...bars.map(b => b.value));
    return (
        <div className="mt-3 space-y-2" data-testid={testId}>
            {bars.map(b => (
                <div key={b.key}>
                    <div className="flex justify-between gap-2 text-[13.5px] font-extrabold text-stone-700">
                        <span className="min-w-0 truncate">{b.label}</span>
                        <Num>{b.value > 0 ? `${rupees(b.value)} · ${Math.round((b.value / total) * 100)}%` : DASH}</Num>
                    </div>
                    <div className="mt-0.5 h-3 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${b.color}`} style={{ width: `${(b.value / max) * 100}%` }} /></div>
                </div>
            ))}
        </div>
    );
};

const DayBars: React.FC<{ points: readonly SpendPoint[] }> = ({ points }) => {
    const max = Math.max(1, ...points.map(p => p.value));
    return (
        <div className="mt-3 flex h-36 items-end gap-1.5" data-testid="cost-bars-day">
            {points.map(p => (
                <div key={p.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    <Num className="mb-0.5 text-[10.5px] font-extrabold text-stone-600">{compact(p.value)}</Num>
                    <span className={`w-full rounded-t-md ${p.value ? 'bg-gradient-to-t from-emerald-600 to-emerald-400' : 'bg-stone-100'}`} style={{ height: `${p.value ? Math.max(8, (p.value / max) * 100) : 4}%` }} />
                    <span className="mt-1 truncate text-[11.5px] font-extrabold text-stone-500">{p.label}</span>
                </div>
            ))}
        </div>
    );
};

export const CostSection: React.FC<{ totals: SeasonTotals; spend: Spend; range: SpendRange; onOpenFinance?: () => void }> = ({ totals, spend, range, onOpenFinance }) => {
    const [view, setView] = useState<View>('total');
    const weekly = range.bucket === 'weekly';
    const active: readonly SpendPoint[] = view === 'crop' ? spend.byCrop : view === 'plot' ? spend.byPlot : spend.points;
    const top = topOf(active);
    const language = useOptionalLanguage()?.language ?? 'mr'; // spec I18 — crop names in his language
    const mix = spend.mix;
    // Money he may not see: "—" and one line saying why; no chart, no mix, no door into the money pages (D-22).
    const hidden = totals.cost.hidden || spend.total.hidden;
    const spent = spend.total.amount;
    const net = totals.net.amount;

    return (
        <div className="space-y-3" data-testid="cost-section">
            <div className="grid grid-cols-2 gap-2">
                <Figure label="आतापर्यंत एकूण खर्च" figure={totals.cost} testId="season-cost" />
                <Figure label="आतापर्यंत एकूण उत्पन्न" figure={totals.income} testId="season-income" />
                <Figure label="उत्पन्न − खर्च (आतापर्यंत)" figure={totals.net} testId="season-net" className="col-span-2"
                    tone={net === null ? 'text-stone-400' : net >= 0 ? 'text-emerald-800' : 'text-amber-800'}>
                    {net === null && !hidden && (
                        <p className="m-0 text-[12.5px] font-semibold text-stone-600" data-testid="season-net-why">
                            {totals.income.amount === null ? 'उत्पन्न अजून नोंदलेलं नाही — म्हणून हा हिशोब अजून नाही.' : 'खर्च अजून नोंदलेला नाही — म्हणून हा हिशोब अजून नाही.'}
                        </p>
                    )}
                </Figure>
            </div>
            <MoneyNotes figures={[totals.cost, totals.income]} testId="season" />

            {totals.harvest.length > 0 && (
                <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid="yield-status">
                    <p className="m-0 mb-1.5 text-[13.5px] font-extrabold text-stone-800">काढणी कुठवर</p>
                    {totals.harvest.map(h => (
                        <p key={h.cropId} className="m-0 flex items-center gap-2 py-0.5 text-[14px] font-bold text-stone-700">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${h.color}`} />{cropNameIn(h.cropName, language)}: {h.entries > 0 ? <><Num>{h.entries}</Num> काढणी नोंदी</> : 'काढणी नोंद नाही'}
                        </p>
                    ))}
                </div>
            )}

            {!hidden && (
                <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                    <div className="flex items-baseline justify-between gap-2">
                        <p className="m-0 text-[14px] font-extrabold text-stone-800">{weekly ? 'महिन्याचा खर्च' : '7 दिवसांचा खर्च'}</p>
                        <span><Num className="text-[17px] font-extrabold text-stone-900" testId="week-total">{money(spent)}</Num><PartialTag figure={spend.total} testId="week-total-partial" /></span>
                    </div>
                    <p className="m-0 text-[12.5px] font-semibold text-stone-500" data-testid="spend-range">{range.label}</p>
                    <MoneyNotes figures={[spend.total]} testId="spend" />
                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
                        {([['total', weekly ? 'आठवड्यानुसार' : 'दिवसानुसार'], ['crop', 'पिकानुसार'], ['plot', 'प्लॉटनुसार']] as const).map(([k, l]) => (
                            <Tap key={k} onClick={() => setView(k)} aria-pressed={view === k} data-testid={`cost-view-${k}`}
                                className={`min-h-[42px] rounded-lg text-[13.5px] font-extrabold ${view === k ? 'bg-white text-emerald-800 shadow' : 'text-stone-500'}`}>{l}</Tap>
                        ))}
                    </div>
                    {spent === null ? (
                        <p className="m-0 mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-[14px] font-bold text-stone-600" data-testid="cost-empty">
                            या दिवसांत खर्च नोंदलेला नाही.
                        </p>
                    ) : view === 'total' ? <DayBars points={spend.points} />
                        : <ShareBars bars={view === 'crop' ? spend.byCrop : spend.byPlot} total={spent} testId={`cost-bars-${view}`} />}
                    {spent !== null && top && (
                        <p className="m-0 mt-2 rounded-xl bg-sky-50 px-3 py-2 text-[13.5px] font-bold text-stone-800" data-testid="cost-top">
                            सर्वात जास्त खर्च: {top.label} (<Num>{rupees(top.value)}</Num>)
                        </p>
                    )}
                    {view === 'total' && spent !== null && <p className="m-0 mt-1.5 text-[11.5px] font-semibold text-stone-500">ह = हजार रुपये</p>}
                </div>
            )}

            {!hidden && mix && spent !== null && (
                <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid="cost-mix">
                    <p className="m-0 text-[14px] font-extrabold text-stone-800">खर्च कशावर झाला</p>
                    <div className="mt-2 flex h-4 overflow-hidden rounded-full bg-stone-100">
                        <span className="bg-orange-400" style={{ width: `${(mix.labour / spent) * 100}%` }} />
                        <span className="bg-purple-400" style={{ width: `${(mix.inputs / spent) * 100}%` }} />
                        <span className="bg-indigo-400" style={{ width: `${(mix.machinery / spent) * 100}%` }} />
                        <span className="bg-stone-400" style={{ width: `${(mix.other / spent) * 100}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[12.5px] font-extrabold">
                        <span className="text-orange-700">● मजुरी <Num>{mix.labour ? rupees(mix.labour) : DASH}</Num></span>
                        <span className="text-purple-700">● खत-औषध <Num>{mix.inputs ? rupees(mix.inputs) : DASH}</Num></span>
                        <span className="text-indigo-700">● यंत्र <Num>{mix.machinery ? rupees(mix.machinery) : DASH}</Num></span>
                        <span className="text-stone-600">● इतर <Num>{mix.other ? rupees(mix.other) : DASH}</Num></span>
                    </div>
                </div>
            )}

            {onOpenFinance && !hidden && (
                <Tap onClick={onOpenFinance} data-testid="open-finance"
                    className="flex min-h-[56px] w-full items-center justify-between rounded-2xl border-2 border-[#1448E6] bg-white px-4 text-[16px] font-extrabold text-[#1448E6]">
                    <span className="flex items-center gap-2"><Wallet size={20} aria-hidden="true" />पैसे व हिशोब उघडा</span><ChevronRight size={22} aria-hidden="true" />
                </Tap>
            )}
        </div>
    );
};
