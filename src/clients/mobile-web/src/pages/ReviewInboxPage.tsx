/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "तपासायचे", the real Review Inbox in the
 * founder-approved look (PLR-D9 `FinancePages.tsx`). Everything it had stays: each entry the server set
 * aside, with its kind, date, note and why it was set aside, and its amount opening the money drawer, where
 * it can be corrected. The server's English reasons ("High amount: >= 25000 INR") are said in Marathi.
 *
 * Lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and when"): each entry now carries its मंजूर line
 * (`BillApprovalLine`) — "मंजूर करा" for a reviewer (the server's rule: the primary account holder or review money), the
 * stamp for everyone who sees the bill, and what this phone still holds for it. Approving clears तपासायचे for the version
 * he saw; the entry leaves this list when the server's answer reaches the phone.
 */
import React, { useMemo, useState } from 'react';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { CATEGORY_LABEL, FINANCE_TITLE, SOURCE_LABEL, formatMoneyDate, reviewReasonLabel } from '../features/finance/moneyLabels';
import { Chip, GlassCard, IconDot } from '../shared/components/ui/placeUi';
import { BillApprovalLine, useBillApprovalOutbox } from '../features/finance/components/BillApprovalLine';
import { mayApproveBills, mayApproveThisBill } from '../features/finance/billApproval';
import { useStoredAccessScopes } from '../core/session/storedFarmScope';
import { scopeForFarm } from '../infrastructure/storage/accessScopeStore';
import { billWord } from '../features/finance/billApprovalWords';
import { useOptionalFarmContext } from '../core/session/FarmContext';
import { useOptionalLanguage } from '../i18n/LanguageContext';

interface ReviewInboxPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const ReviewInboxPage: React.FC<ReviewInboxPageProps> = ({ currentRoute, onNavigate, onBack }) => {
    const [refresh, setRefresh] = useState(0);
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);
    // lane BILL-1 — who may approve (the current farm's seat, the server's rule), his language, and this phone's outbox.
    const farmContext = useOptionalFarmContext();
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const [outbox, refreshOutbox] = useBillApprovalOutbox();
    // fix round 1 (review L4) — and, for a chosen-plots seat, only bills on his plots (the server's write rule).
    const storedScopes = useStoredAccessScopes();
    const mayApproveOn = (bill: { farmId: string; plotId?: string }) =>
        !!farmContext && farmContext.currentFarmId === bill.farmId
        && mayApproveThisBill(farmContext.currentFarm, scopeForFarm(storedScopes, bill.farmId), bill);
    const seatMayApprove = !!farmContext && mayApproveBills(farmContext.currentFarm);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5). "Approve" used to mark
    // entries verified on this phone and send a LOG verification carrying a money entry's
    // id — the server found no such log, recorded nothing, and the mark vanished on the
    // next reload. Lane BILL-1 gave it a real server path (`approve_cost_entry`); the
    // action is queued, and the entry leaves this list only on the server's answer.
    // `currentRoute` and `refresh` are re-read triggers: the selector reads a mutable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const entries = useMemo(() => financeSelectors.getReviewInbox(), [currentRoute, refresh]);

    return (
        <MoneyPage title={FINANCE_TITLE['finance-review-inbox']} testId="fin-review" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            {/* Only when there is something to look at (I8 review B005): over an empty inbox it contradicted the line below. */}
            {entries.length > 0 && (
                // PROPOSED (Marathi)
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">या नोंदी एकदा पाहा.</p>
            )}

            {entries.length > 0 && (
                // PROPOSED (both languages) — a bill's मंजूर is money review, not a work record's (D-40), and not a payment.
                <p data-testid="review-approve-meaning" className="m-0 rounded-2xl bg-amber-50 p-3 text-[14px] font-extrabold leading-snug text-amber-900 ring-1 ring-amber-200">
                    {billWord(seatMayApprove ? 'meaning' : 'whoApproves', language)}
                </p>
            )}

            {entries.map(item => {
                const reasons = item.reviewReasons ?? [];
                const what = item.notes || item.vendorName || SOURCE_LABEL[item.sourceType] || 'नोंद';
                const when = formatMoneyDate(item.dateTime);
                return (
                    <GlassCard key={item.id} className="border-l-4 border-l-amber-500" testId={`review-${item.id}`}>
                        <div className="flex items-start gap-3">
                            <IconDot tone="amber"><TriangleAlert size={22} aria-hidden="true" /></IconDot>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="m-0 text-[15.5px] font-extrabold text-stone-900">{CATEGORY_LABEL[item.category]}</p>
                                    <MoneyChip
                                        amount={item.effectiveAmount}
                                        onClick={() => setDrawerFilter({ sourceType: item.sourceType, sourceId: item.sourceId })}
                                        className="shrink-0 border-amber-300 bg-amber-50 px-3 py-1.5 text-[15px] text-amber-900"
                                    />
                                </div>
                                <p className="m-0 text-[13px] font-semibold text-stone-600 [overflow-wrap:anywhere]">{when ? `${when} · ` : ''}{what}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {reasons.length > 0
                                        ? reasons.map(reason => <Chip key={reason} tone="rose">{reviewReasonLabel(reason)}</Chip>)
                                        : <Chip tone="amber">एकदा पाहायचं</Chip>}
                                </div>
                                <BillApprovalLine
                                    bill={item}
                                    mayApprove={mayApproveOn(item)}
                                    outbox={outbox}
                                    language={language}
                                    onQueued={refreshOutbox}
                                />
                            </div>
                        </div>
                    </GlassCard>
                );
            })}

            {entries.length === 0 && (
                <GlassCard testId="review-empty">
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                        <IconDot tone="green" size={56}><Sparkles size={28} aria-hidden="true" /></IconDot>
                        {/* Not "everything has been checked": nothing waits here, which is all this page knows. */}
                        <p className="m-0 text-[17px] font-extrabold text-stone-900">पाहण्यासारखी कोणतीही नोंद नाही</p>
                    </div>
                </GlassCard>
            )}

            <MoneyLensDrawer
                isOpen={!!drawerFilter}
                onClose={() => { setDrawerFilter(null); setRefresh(v => v + 1); }}
                filters={drawerFilter || {}}
                canAdjust={true}
            />
        </MoneyPage>
    );
};

export default ReviewInboxPage;
