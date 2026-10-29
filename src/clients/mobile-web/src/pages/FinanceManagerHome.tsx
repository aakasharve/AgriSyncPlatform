/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "पैसे व हिशोब", the real Finance Manager home
 * in the founder-approved look (PLR-D9 `FinancePages.tsx`). Everything it had stays: the four piles from
 * `financeSelectors.getPipelineBuckets` (count + total, the तपासायचे pile opening the review page, the
 * others the वही), the two quick figures and this month's cost report. The English six-tab row becomes five
 * plain rows, one per page.
 *
 * One figure changed meaning, on purpose: "Total Input" showed the APPROVED pile's total, and nothing can
 * approve a money entry yet (PENDING D-12), so it was ₹ 0 for every farmer. It is now the real total spent,
 * named as such. The मंजूर pile shows no figure at all, only why: nothing can produce a मंजूर entry, so its
 * "0 / ₹ 0" was a constant dressed as a measurement (I8 review B003, P4). A pile with no entry says नोंद नाही.
 */
import React, { useMemo } from 'react';
import { BarChart3, BookOpen, CheckCircle2, ClipboardCheck, RefreshCw, Tags, TriangleAlert, TrendingUp } from 'lucide-react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import type { FinancePipelineBucket } from '../features/finance/finance.types';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { MonthlyCostPdfButton } from '../features/finance/components/MonthlyCostPdfButton';
import { BUCKET_LABEL, FINANCE_TITLE, rupees } from '../features/finance/moneyLabels';
import { Chip, GlassCard, IconDot, RowLink, SectionHead, Tap, type Tone } from '../shared/components/ui/placeUi';

interface FinanceManagerHomeProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const BUCKET_LOOK: Record<FinancePipelineBucket['key'], { tone: Tone; icon: React.ReactNode }> = {
    Captured: { tone: 'blue', icon: <RefreshCw size={20} aria-hidden="true" /> },
    NeedsReview: { tone: 'amber', icon: <TriangleAlert size={20} aria-hidden="true" /> },
    Approved: { tone: 'green', icon: <CheckCircle2 size={20} aria-hidden="true" /> },
    Adjusted: { tone: 'violet', icon: <TrendingUp size={20} aria-hidden="true" /> },
};

const FinanceManagerHome: React.FC<FinanceManagerHomeProps> = ({ currentRoute, onNavigate, onBack }) => {
    // `currentRoute` is a re-read trigger: the selectors read a mutable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const buckets = useMemo(() => financeSelectors.getPipelineBuckets(), [currentRoute]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const totalSpent = useMemo(() => financeSelectors.getTotalCost(), [currentRoute]);
    // Same farm the English "Report" button used: the latest entry's. With no entry there is no report to make.
    const reportFarmId = useMemo(() => financeSelectors.getEffectiveMoneyEvents()[0]?.farmId, []);

    const bucket = (key: FinancePipelineBucket['key']) => buckets.find(b => b.key === key);
    const waiting = bucket('NeedsReview');
    const recorded = bucket('Captured')?.count ?? 0;

    return (
        <MoneyPage title={FINANCE_TITLE['finance-manager']} testId="finance-home" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack} withNav={false}>
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">रोजच्या पैशांचं नियंत्रण — काय नोंदलं आणि काय एकदा तपासायचं.</p>

            <div className="grid grid-cols-2 gap-2">
                {buckets.map(b => (
                    <Tap key={b.key} onClick={() => onNavigate(b.key === 'NeedsReview' ? 'finance-review-inbox' : 'finance-ledger')} data-testid={`fin-tile-${b.key}`}
                        className={`rounded-3xl border p-3 text-left shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)] ${b.key === 'NeedsReview' && b.count > 0 ? 'border-amber-300 bg-amber-50/90' : 'border-white/60 bg-white/80'}`}>
                        <IconDot tone={BUCKET_LOOK[b.key].tone} size={38}>{BUCKET_LOOK[b.key].icon}</IconDot>
                        <span className="mt-2 block text-[13.5px] font-extrabold text-stone-700">{BUCKET_LABEL[b.key]}</span>
                        {b.key === 'Approved' ? (
                            <span className="mt-1 block text-[13px] font-bold leading-snug text-stone-500" data-testid="fin-tile-Approved-unavailable">मंजुरी अजून उपलब्ध नाही</span>
                        ) : b.count === 0 ? (
                            <span className="mt-1 block text-[15px] font-extrabold text-stone-500">नोंद नाही</span>
                        ) : (
                            <>
                                <span className="block text-[26px] font-extrabold leading-tight text-stone-900">{b.count}</span>
                                <span className="block text-[13.5px] font-bold text-stone-600">{rupees(b.total)}</span>
                            </>
                        )}
                        {b.key === 'NeedsReview' && b.count > 0 && <span className="mt-1.5 block"><Chip tone="amber">पाहायचं बाकी</Chip></span>}
                    </Tap>
                ))}
            </div>

            {recorded > 0 ? (
                <GlassCard testId="fin-quick">
                    <div className="grid grid-cols-2 gap-3">
                        <div><p className="m-0 text-[13px] font-bold text-stone-600">एकूण खर्च</p><p className="m-0 text-[21px] font-extrabold text-stone-900" data-testid="fin-quick-spent">{rupees(totalSpent)}</p></div>
                        <div><p className="m-0 text-[13px] font-bold text-stone-600">तपासणी बाकी</p><p className="m-0 text-[21px] font-extrabold text-amber-700" data-testid="fin-quick-waiting">{rupees(waiting?.total ?? 0)}</p></div>
                    </div>
                    {reportFarmId && <div className="mt-3"><MonthlyCostPdfButton farmId={reportFarmId} testId="fin-home-report" /></div>}
                </GlassCard>
            ) : (
                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-600" data-testid="fin-home-empty">
                    अजून एकही नोंद नाही. खर्च किंवा जमा सांगितल्यावर इथे दिसेल.
                </p>
            )}

            <SectionHead title="हिशोबाचे भाग" />
            <div className="space-y-2">
                <RowLink icon={<BookOpen size={22} aria-hidden="true" />} tone="blue" title={FINANCE_TITLE['finance-ledger']} line="प्रत्येक रुपया — जमा आणि खर्च"
                    onClick={() => onNavigate('finance-ledger')} testId="fin-open-ledger" />
                <RowLink icon={<Tags size={22} aria-hidden="true" />} tone="violet" title={FINANCE_TITLE['finance-price-book']} line="मजुरी, खत-औषध, यंत्र, इंधन — ठरलेले दर"
                    onClick={() => onNavigate('finance-price-book')} testId="fin-open-prices" />
                <RowLink icon={<ClipboardCheck size={22} aria-hidden="true" />} tone="amber" title={FINANCE_TITLE['finance-review-inbox']} line="तपासायच्या नोंदी — एकदा पाहा" /* PROPOSED (Marathi): no promise of big-amount / duplicate detection (D-18) */
                    onClick={() => onNavigate('finance-review-inbox')} testId="fin-open-review"
                    badge={waiting && waiting.count > 0 ? <Chip tone="amber">{waiting.count}</Chip> : undefined} />
                <RowLink icon={<BarChart3 size={22} aria-hidden="true" />} tone="green" title={FINANCE_TITLE['finance-reports']} line="नफा-तोटा आणि खर्च कुठे गेला"
                    onClick={() => onNavigate('finance-reports')} testId="fin-open-reports" />
            </div>
        </MoneyPage>
    );
};

export default FinanceManagerHome;
