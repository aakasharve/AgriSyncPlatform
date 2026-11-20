/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "अहवाल", the real Reports page in the
 * founder-approved look (PLR-D9 `FinanceTools.tsx`). Everything it had stays: the four periods (हा महिना ·
 * मागचा महिना · हे वर्ष · सगळं), नफा/तोटा with its share of जमा, जमा, खर्च, where the money went by kind,
 * "सेवेचा पुरावा" for the same three roles, and the warning when खर्च is more than जमा.
 *
 * Changed, each for a stated reason:
 *  - a period with no entry SAYS so; it does not show ₹ 0 figures and a 0% margin (P4);
 *  - the margin line appears only when there was income to take a share of;
 *  - lane HONESTY-2 (H2): harvest income is "coming soon", so a period with no income recorded is NOT a loss.
 *    It prints the खर्च and "उत्पन्न अजून नोंदवलेलं नाही" — no नफा / तोटा, no share, no ₹ 0 जमा, no loss warning.
 *    When there is income, the figure carries "अपूर्ण — फक्त नोंदवलेल्या रकमांवर आधारित" (recorded income minus
 *    recorded expense, never the farm's whole result). How the totals are worked out is unchanged;
 *  - the loss warning names the period's real biggest cost, not a fixed "Machinery & Labour";
 *  - "View Details" did nothing; it is now "वहीत सगळ्या नोंदी पाहा", which opens the वही (P5);
 *  - the period bounds are worked out on the farm's calendar day (`getDateKey`, IST). They were built
 *    from local midnight through `toISOString()`, which in India is the previous day in UTC — so "हा
 *    महिना" took in the last day of the month before, and "मागचा महिना" lost its own last day.
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, FileCheck2, Info } from 'lucide-react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { MoneyCategory } from '../features/finance/finance.types';
import { useFarmContext } from '../core/session/FarmContext';
import { useOptionalLanguage } from '../i18n/LanguageContext';
import { SERVICE_PROOF_WORDS, toServiceProofLang } from '../i18n/serviceProofTranslations';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import SeasonInputLedger from '../features/inputs/seasonLedger/SeasonInputLedger';
import { CATEGORY_LABEL, FINANCE_TITLE, PERIOD_LABEL, REPORT_WORDS, entriesCount, periodFilters, rupees, type ReportPeriod } from '../features/finance/moneyLabels';
import { ChoiceChips, GlassCard, RowLink, SectionHead, Tap } from '../shared/components/ui/placeUi';

interface ReportsPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const PERIODS = (Object.keys(PERIOD_LABEL) as ReportPeriod[]).map(p => [p, PERIOD_LABEL[p]] as const);

const CAT_BAR: Record<MoneyCategory, string> = {
    Labour: 'bg-orange-500', Input: 'bg-violet-500', Machinery: 'bg-indigo-500', Transport: 'bg-sky-500',
    Repair: 'bg-stone-500', Fuel: 'bg-amber-500', Electricity: 'bg-yellow-500', Other: 'bg-stone-400',
};

const ReportsPage: React.FC<ReportsPageProps> = ({ currentRoute, onNavigate, onBack }) => {
    const [timeRange, setTimeRange] = useState<ReportPeriod>('THIS_MONTH');
    const { currentFarm } = useFarmContext();
    // lane MU-1 (F99 review) - the door to the service proof speaks his language, Marathi or English, never both.
    const proofWords = SERVICE_PROOF_WORDS[toServiceProofLang(useOptionalLanguage()?.language)];
    const canSeeServiceProof = currentFarm?.role === 'Agronomist' ||
        currentFarm?.role === 'Consultant' ||
        currentFarm?.role === 'PrimaryOwner';

    const filters = useMemo(() => periodFilters(timeRange), [timeRange]);

    const events = useMemo(() => {
        return financeSelectors.getEffectiveMoneyEvents(filters);
    }, [filters]);

    const income = events.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const expense = events.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const noDirection = events.filter(e => e.type === 'Unknown').length;
    const profit = income - expense;
    // Lane HONESTY-2 (H2): harvest income is not entered anywhere yet, so a period with no income recorded is not a loss.
    const hasIncome = income > 0;
    const margin = hasIncome ? Math.round((profit / income) * 1000) / 10 : null;

    const expenseByCategory = useMemo(() => {
        const map = new Map<MoneyCategory, number>();
        events.filter(e => e.type === 'Expense').forEach(e => {
            map.set(e.category, (map.get(e.category) || 0) + e.effectiveAmount);
        });
        // A category whose only entry was marked duplicate (corrected to ₹ 0) spent nothing: no row, and no
        // "₹ 0 (NaN%)" (I8 review B004).
        return [...map.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
    }, [events]);

    const period = PERIOD_LABEL[timeRange];

    return (
        <MoneyPage title={FINANCE_TITLE['finance-reports']} testId="fin-reports" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            <ChoiceChips items={PERIODS} value={timeRange} onPick={setTimeRange} testId="report-period" />

            {events.length === 0 ? (
                <GlassCard testId="report-empty">
                    <p className="m-0 py-2 text-center text-[15px] font-extrabold text-stone-700">{period} — एकही नोंद नाही.</p>
                </GlassCard>
            ) : (
                <>
                    <GlassCard testId="report-profit">
                        {hasIncome ? (
                            <>
                                <p className="m-0 text-[14px] font-bold text-stone-600">{profit >= 0 ? 'नफा' : 'तोटा'} · {period}</p>
                                <p className={`m-0 text-[32px] font-extrabold leading-tight ${profit >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                                    {profit >= 0 ? '+ ' : '− '}{rupees(Math.abs(profit))}
                                </p>
                                {margin !== null && (
                                    <p className="m-0 text-[13.5px] font-bold text-stone-600" data-testid="report-margin">
                                        {margin >= 0 ? `जमेच्या ${margin}% हातात राहिले` : `तोटा जमेच्या ${Math.abs(margin)}% इतका`}
                                    </p>
                                )}
                                {/* H2: the figure is recorded income minus recorded expense, not the farm's whole result. */}
                                <p className="m-0 mt-1 text-[12.5px] font-bold leading-snug text-stone-500" data-testid="report-partial-note">{REPORT_WORDS.recordedOnly}</p>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="rounded-2xl bg-emerald-50 p-2.5" data-testid="report-income"><p className="m-0 text-[13px] font-bold text-emerald-800">जमा</p><p className="m-0 text-[19px] font-extrabold text-stone-900">{rupees(income)}</p></div>
                                    <div className="rounded-2xl bg-stone-100 p-2.5" data-testid="report-spend"><p className="m-0 text-[13px] font-bold text-stone-600">खर्च</p><p className="m-0 text-[19px] font-extrabold text-stone-900">{rupees(expense)}</p></div>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* H2: no income was written down, so nothing is called नफा or तोटा and no share is worked out. */}
                                <p className="m-0 text-[14px] font-bold text-stone-600">{REPORT_WORDS.spentTitle} · {period}</p>
                                <p className="m-0 text-[32px] font-extrabold leading-tight text-stone-900" data-testid="report-spend">{expense > 0 ? rupees(expense) : '—'}</p>
                                <p className="m-0 mt-1 text-[13.5px] font-bold text-stone-600" data-testid="report-no-income">{REPORT_WORDS.noIncome}</p>
                            </>
                        )}
                        {noDirection > 0 && (
                            <p className="m-0 mt-2 text-[12.5px] font-bold leading-snug text-stone-500" data-testid="report-no-direction">
                                {entriesCount(noDirection)} — जमा की खर्च ते नोंदलेलं नाही, म्हणून यात धरलेलं नाही.
                            </p>
                        )}
                    </GlassCard>

                    {hasIncome && profit < 0 && (
                        <p className="m-0 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-[13.5px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid="report-loss-tip">
                            <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>
                                या काळात खर्च जमेपेक्षा जास्त झाला.
                                {expenseByCategory.length > 0 && ` सर्वात मोठा खर्च: ${CATEGORY_LABEL[expenseByCategory[0][0]]} — ${rupees(expenseByCategory[0][1])}.`}
                            </span>
                        </p>
                    )}

                    <SectionHead title="खर्चाची विभागणी" hint="पैसे कुठे गेले — मोठा खर्च वर" />
                    <GlassCard testId="report-split">
                        {expenseByCategory.length > 0 ? (
                            <div className="space-y-3">
                                {expenseByCategory.map(([cat, amount]) => (
                                    <div key={cat} data-testid={`report-cat-${cat}`}>
                                        <div className="flex items-baseline justify-between gap-2 text-[14.5px] font-extrabold text-stone-800">
                                            <span>{CATEGORY_LABEL[cat]}</span>
                                            <span>{rupees(amount)} {expense > 0 && <span className="text-[12.5px] font-bold text-stone-500">({Math.round((amount / expense) * 100)}%)</span>}</span>
                                        </div>
                                        <div className="mt-1 h-3 overflow-hidden rounded-full bg-stone-100">
                                            <div className={`h-full rounded-full ${CAT_BAR[cat]}`} style={{ width: `${expense > 0 ? (amount / expense) * 100 : 0}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="m-0 py-2 text-center text-[14px] font-bold text-stone-600" data-testid="report-no-spend">या काळात खर्चाची नोंद नाही.</p>
                        )}
                        <Tap onClick={() => onNavigate('finance-ledger')} data-testid="report-open-ledger"
                            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-white text-[14.5px] font-extrabold text-blue-800 ring-1 ring-blue-200">
                            <BookOpen size={17} aria-hidden="true" />वहीत सगळ्या नोंदी पाहा
                        </Tap>
                    </GlassCard>
                </>
            )}

            {/* spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C) - the season ledger of inputs, for the farm's owner (the server refuses any other seat). */}
            {currentFarm?.role === 'PrimaryOwner' && <SeasonInputLedger farmId={currentFarm.farmId} />}

            {/* Service Proof — CEI Phase 3 §23.2, for the same three roles as before. */}
            {canSeeServiceProof && (
                <RowLink icon={<FileCheck2 size={22} aria-hidden="true" />} tone="green" title={proofWords.title} line={proofWords.doorLine}
                    onClick={() => onNavigate('service-proof')} testId="report-service-proof" />
            )}
        </MoneyPage>
    );
};

export default ReportsPage;
