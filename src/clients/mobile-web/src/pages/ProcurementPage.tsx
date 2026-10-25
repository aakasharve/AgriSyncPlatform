/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — खरेदी, route 'procurement', in the founder-approved
 * look (PLR-D9 preview `PlacePages.ProcurementPage`) over the REAL bills (`procurementRepository`). It was
 * English ("Procurement", "Scan Receipt", "No Receipts Found"). Every real part is kept:
 *   - pick a crop, then a plot (the farm's own crops and plots; "सर्व" = everything);
 *   - the list for what is picked — a plot shows its own bills + its crop's shared bills + the farm-wide
 *     bills (`billView.billsInView`, the rule this page always had), with search by shop or item;
 *   - the three totals, now of what is picked (they were the whole farm's whatever was picked);
 *   - "बिलाचा फोटो काढा" → the same `ReceiptCaptureSheet` (its save is unchanged);
 *   - tapping a bill → that day's money: on the bill's plot when it has one, else across the farm (`MoneyLensDrawer`).
 *     NOT "this bill's": a money
 *     entry read back from the server comes back as `Manual` (financeService `mapCostEntryToMoneyEvent`), so a
 *     `Procurement` filter matched nothing and the drawer said there was no entry (I8 review B002);
 *   - "बोलून सांगा" / "हाताने लिहा" → the log flow, and the row to पैसे व हिशोब.
 * A button whose handler the route did not give is not drawn (P5). Nothing recorded → said in words, never ₹ 0.
 */
import React, { useState } from 'react';
import { BookOpen, Camera, Keyboard, Mic, Search } from 'lucide-react';
import { CropProfile, ProcurementExpense } from '../types';
import { procurementRepository } from '../services/procurementRepository';
import { ExpenseSummaryCards } from '../features/procurement/components/ExpenseSummaryCards';
import { ExpenseCard } from '../features/procurement/components/ExpenseCard';
import { ReceiptCaptureSheet } from '../features/procurement/components/ReceiptCaptureSheet';
import { ALL, billsInView, matchesSearch, pickLabel, placeOf, totalsOf } from '../features/procurement/components/billView';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import { BigButton, Chip, ChoiceChips, GlassCard, PageBar, RowLink, SANS, SectionHead } from '../shared/components/ui/placeUi';

interface Props {
    crops: CropProfile[];
    onBack?: () => void;
    /** Opens the voice / typed log flow. */
    onTell?: () => void;
    onGo?: (route: 'finance-manager') => void;
}

const ProcurementPage: React.FC<Props> = ({ crops = [], onBack, onTell, onGo }) => {
    const [cropPick, setCropPick] = useState<string>(ALL);
    const [plotPick, setPlotPick] = useState<string>(ALL);
    const [showCaptureSheet, setShowCaptureSheet] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [lensOpen, setLensOpen] = useState(false);
    const [lensFilters, setLensFilters] = useState<FinanceFilters>({});

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I4). This used to create a money
    // entry for EVERY stored receipt line on every visit. The receipt is already turned
    // into money entries once, when it is saved (ReceiptCaptureSheet), and the "already
    // created" check cannot see entries after the money cache reloads from the server — so
    // each visit to this tab sent another copy of every bill. Reading is all this does now.
    const [expenses, setExpenses] = useState<ProcurementExpense[]>(() => procurementRepository.getExpenses());
    const refreshData = () => setExpenses(procurementRepository.getExpenses());

    // A crop or plot that has since gone falls back to "सर्व".
    const activeCrop = crops.find(c => c.id === cropPick);
    const activePlot = activeCrop?.plots.find(p => p.id === plotPick);
    const pick = { cropId: activeCrop?.id ?? ALL, plotId: activePlot?.id ?? ALL };
    const pickCrop = (id: string) => { setCropPick(id); setPlotPick(ALL); };

    const inView = billsInView(expenses, crops, pick);
    const totals = totalsOf(inView);
    const shown = inView.filter(e => matchesSearch(e, searchQuery));
    const searching = searchQuery.trim().length > 0;

    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6" style={{ fontFamily: SANS }} data-testid="procurement-page">
            <PageBar title="खरेदी" onBack={onBack} />
            <div className="space-y-3">
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">
                    खत, औषध, अवजारं, दुरुस्ती — जे विकत घेतलं ते इथे.{crops.length > 0 && ' आधी पीक निवडा, मग प्लॉट.'}
                </p>

                {crops.length > 0 && (
                    <GlassCard testId="buy-pick">
                        <p className="m-0 mb-2 text-[13.5px] font-extrabold text-stone-700">पीक</p>
                        <ChoiceChips items={[[ALL, 'सर्व'] as const, ...crops.map(c => [c.id, c.name] as const)]} value={pick.cropId} onPick={pickCrop} testId="buy-crop" />
                        {activeCrop && activeCrop.plots.length > 0 && (
                            <>
                                <p className="m-0 mb-2 mt-3 text-[13.5px] font-extrabold text-stone-700">प्लॉट</p>
                                <ChoiceChips items={[[ALL, `सर्व ${activeCrop.name}`] as const, ...activeCrop.plots.map(p => [p.id, p.name] as const)]}
                                    value={pick.plotId} onPick={setPlotPick} testId="buy-plot" />
                            </>
                        )}
                    </GlassCard>
                )}

                {/* The totals say what they cover: the picked place, and only the bills added here. */}
                <p className="m-0 px-1 text-[13px] font-bold text-stone-600" data-testid="buy-totals-cover">
                    {pickLabel(crops, pick)} — इथे जोडलेल्या बिलांची बेरीज
                </p>
                <ExpenseSummaryCards totals={totals} plotName={activePlot?.name} />

                <BigButton onClick={() => setShowCaptureSheet(true)} testId="scan-receipt-btn"><Camera size={20} aria-hidden="true" />बिलाचा फोटो काढा</BigButton>
                {onTell && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <BigButton onClick={onTell} tone="white" testId="buy-tell"><Mic size={20} aria-hidden="true" />बोलून सांगा</BigButton>
                            <BigButton onClick={onTell} tone="white" testId="buy-write"><Keyboard size={20} aria-hidden="true" />हाताने लिहा</BigButton>
                        </div>
                        {/* A told purchase becomes part of that day's record (and its money), not a bill in this list. */}
                        <p className="m-0 px-1 text-[12.5px] font-semibold leading-snug text-stone-500" data-testid="buy-tell-note">
                            बोलून किंवा लिहून सांगितलेली खरेदी त्या दिवसाच्या नोंदीत जाते — खालच्या बिलांत दिसत नाही.
                        </p>
                    </>
                )}

                <div className="flex items-end justify-between gap-2">
                    <SectionHead title="बिलं आणि खरेदी" hint="कोणतं दुकान, काय घेतलं, कुठे लावलं" />
                    {inView.length > 0 && <span data-testid="buy-count"><Chip tone="stone">{shown.length}</Chip></span>}
                </div>

                {expenses.length > 0 && (
                    <label className="flex min-h-[52px] items-center gap-2 rounded-2xl bg-white px-3 ring-1 ring-stone-300 focus-within:ring-2 focus-within:ring-emerald-500">
                        <Search size={20} className="shrink-0 text-stone-400" aria-hidden="true" />
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="बिल शोधा — दुकान किंवा वस्तू"
                            aria-label="बिल शोधा"
                            data-testid="buy-search"
                            className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-stone-900 outline-none placeholder:text-stone-400"
                        />
                    </label>
                )}

                {shown.length > 0 ? (
                    <div className="space-y-2" data-testid="buy-list">
                        {shown.map(expense => (
                            <ExpenseCard
                                key={expense.id}
                                expense={expense}
                                place={placeOf(expense, crops)}
                                onMoneyClick={(e) => {
                                    setLensFilters({
                                        fromDate: e.date,
                                        toDate: e.date,
                                        // No crop filter either: an entry read back carries the crop CYCLE id
                                        // (`cropId: entry.cropCycleId`), a bill the crop's own id — they never match.
                                        plotId: e.plotId,
                                    });
                                    setLensOpen(true);
                                }}
                            />
                        ))}
                    </div>
                ) : searching && inView.length > 0 ? (
                    <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-500" data-testid="buy-no-match">
                        “{searchQuery.trim()}” — असं बिल सापडलं नाही.
                    </p>
                ) : (
                    <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-500" data-testid="buy-empty">
                        इथे अजून काही खरेदी नाही. बिलाचा फोटो काढा{onTell ? ' किंवा बोलून सांगा' : ''}.
                    </p>
                )}

                {onGo && (
                    <RowLink icon={<BookOpen size={22} aria-hidden="true" />} tone="blue" title="पैसे व हिशोब" line="सगळा जमा-खर्च, दर, तपासणी आणि अहवाल"
                        onClick={() => onGo('finance-manager')} testId="buy-finance" />
                )}
            </div>

            {showCaptureSheet && (
                <ReceiptCaptureSheet
                    onClose={() => setShowCaptureSheet(false)}
                    onSave={refreshData}
                    crops={crops}
                    activePlotId={activePlot?.id}
                />
            )}

            <MoneyLensDrawer
                isOpen={lensOpen}
                onClose={() => setLensOpen(false)}
                filters={lensFilters}
            />
        </div>
    );
};

export default ProcurementPage;
