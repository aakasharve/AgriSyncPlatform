/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "तपासायचे", the real Review Inbox in the
 * founder-approved look (PLR-D9 `FinancePages.tsx`). Everything it had stays: each entry the server set
 * aside, with its kind, date, note and why it was set aside, and its amount opening the money drawer, where
 * it can be corrected. The server's English reasons ("High amount: >= 25000 INR") are said in Marathi.
 *
 * NO approve and NO "बरोबर आहे" — the approved preview had both, but there is no server path for approving
 * a money entry (PENDING D-12), so the page keeps its one honest line instead (see below).
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

interface ReviewInboxPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const ReviewInboxPage: React.FC<ReviewInboxPageProps> = ({ currentRoute, onNavigate, onBack }) => {
    const [refresh, setRefresh] = useState(0);
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5). "Approve" used to mark
    // entries verified on this phone and send a LOG verification carrying a money entry's
    // id — the server found no such log, recorded nothing, and the mark vanished on the
    // next reload. There is no server path for approving a money entry yet (PENDING D-12),
    // so the buttons are gone and the page says so (doctrine P5), the same way the review
    // sheet already does. `refresh` stays for the money drawer's adjustments.
    // `currentRoute` and `refresh` are re-read triggers: the selector reads a mutable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const entries = useMemo(() => financeSelectors.getReviewInbox(), [currentRoute, refresh]);

    return (
        <MoneyPage title={FINANCE_TITLE['finance-review-inbox']} testId="fin-review" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            {/* Only when there is something to look at (I8 review B005): over an empty inbox it contradicted the line below. */}
            {entries.length > 0 && (
                <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">या नोंदी वेगळ्या दिसल्या — मोठी रक्कम किंवा दुहेरी नोंद. एकदा पाहा.</p>
            )}

            {entries.length > 0 && (
                <p data-testid="review-approve-unavailable" className="m-0 rounded-2xl bg-amber-50 p-3 text-[14px] font-extrabold leading-snug text-amber-900 ring-1 ring-amber-200">
                    मंजुरी अजून उपलब्ध नाही — खर्च दुरुस्त करायचा असेल तर रकमेवर दाबा.
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
                            </div>
                        </div>
                    </GlassCard>
                );
            })}

            {entries.length === 0 && (
                <GlassCard testId="review-empty">
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                        <IconDot tone="green" size={56}><Sparkles size={28} aria-hidden="true" /></IconDot>
                        {/* Not "everything has been checked": there is no checking step yet (PENDING D-12). */}
                        <p className="m-0 text-[17px] font-extrabold text-stone-900">पाहण्यासारखी कोणतीही नोंद नाही</p>
                        <p className="m-0 text-[13.5px] font-semibold text-stone-600">मोठी रक्कम किंवा दुहेरी नोंद दिसली, तर ती इथे येईल.</p>
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
