/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "वही", the real Ledger in the founder-approved
 * look (PLR-D9 `FinancePages.tsx`). Everything it had stays: जमा / खर्च totals, the four filters (सर्व ·
 * जमा · खर्च · मजुरी दिली — the job-card payouts), थोडक्यात / सविस्तर, this month's cost report, the
 * entries grouped by day, the "not on a plot yet" and "corrected" marks, "काम पाहा" for a job-card payout,
 * an amount opening the money drawer, and "दुरुस्त करा" opening the correction sheet (unchanged writes).
 *
 * An entry the server holds with no direction (`'Unknown'`) is still listed with its amount but sits in
 * neither total (finance.types.ts); the page now SAYS so instead of letting the totals look complete.
 *
 * Removed: an attachment-count read that ran on every refresh and fed nothing — its list was dropped from
 * the screen in c2014824; the counts were never shown since.
 *
 * spec: pre-launch-repair L2a (D-19) — each entry says where it stands: on this phone, on the server, or
 * needs you (`MoneyStateChip`, from the sync evidence the app already keeps — never "on the server" before
 * the server acknowledged it).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CircleHelp, Pencil, TrendingDown, TrendingUp } from 'lucide-react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import CostCorrectionSheet from '../features/finance/components/CostCorrectionSheet';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { MonthlyCostPdfButton } from '../features/finance/components/MonthlyCostPdfButton';
import { MoneyStateChip } from '../features/finance/components/MoneyStateChip';
import { entryClaim, useMoneyEvidence } from '../features/finance/moneyEntryState';
import {
    BUCKET_LABEL, CATEGORY_LABEL, FINANCE_TITLE, SOURCE_LABEL, entriesCount, entryState, formatDayKey, rupees,
} from '../features/finance/moneyLabels';
import { Chip, ChoiceChips, GlassCard, IconDot, Tap, type Tone } from '../shared/components/ui/placeUi';
import { AudienceLockChip, AudienceRow } from '../features/recordAudience/AudienceRow';
import { RuleNotCountedNote } from '../features/recordAudience/RuleNotCountedNote';
import { useMoneyAudiences } from '../features/recordAudience/useMoneyAudiences';

interface LedgerPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
    /** lane PRV (D-26) — the farm's primary account holder: he alone sees and sets who may see each money record. */
    isPrimaryHolder?: boolean;
    /** His server id (never offered as a choice; his own entries keep their maker label). */
    selfUserId?: string | null;
}

type LedgerFilter = 'All' | 'Income' | 'Expense' | 'LabourPayouts';
const FILTERS: readonly (readonly [LedgerFilter, string])[] = [['All', 'सर्व'], ['Income', 'जमा'], ['Expense', 'खर्च'], ['LabourPayouts', 'मजुरी दिली']];

type ViewMode = 'short' | 'full';
const VIEWS: readonly (readonly [ViewMode, string])[] = [['short', 'थोडक्यात'], ['full', 'सविस्तर']];

const STATE_TONE: Record<ReturnType<typeof entryState>, Tone> = { Captured: 'blue', NeedsReview: 'amber', Approved: 'green', Adjusted: 'violet' };

const LedgerPage: React.FC<LedgerPageProps> = ({ currentRoute, onNavigate, onBack, isPrimaryHolder = false, selfUserId = null }) => {
    const audiences = useMoneyAudiences(isPrimaryHolder);
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [correctionTarget, setCorrectionTarget] = useState<{ id: string; amount: number; category: string } | null>(null);
    const [filterType, setFilterType] = useState<LedgerFilter>('All');
    const [view, setView] = useState<ViewMode>('short');
    const isDetailView = view === 'full';

    // `currentRoute`, `drawerFilter` and `refreshKey` are re-read triggers: the selector reads a mutable store
    // (closing the drawer may have added a correction; the cache event bumps `refreshKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const events = useMemo(() => financeSelectors.getEffectiveMoneyEvents(), [currentRoute, drawerFilter, refreshKey]);

    const totalIncome = events.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const totalExpense = events.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const noDirection = events.filter(e => e.type === 'Unknown').length;
    const evidence = useMoneyEvidence();

    const filteredEvents = useMemo(() => {
        if (filterType === 'All') return events;
        if (filterType === 'LabourPayouts') return events.filter(e => Boolean(e.jobCardId));
        return events.filter(e => e.type === filterType);
    }, [events, filterType]);

    const groupedEvents = useMemo(() => {
        const groups: Record<string, typeof events> = {};
        filteredEvents.forEach(e => {
            const date = e.dateTime.split('T')[0];
            if (!groups[date]) groups[date] = [];
            groups[date].push(e);
        });
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [filteredEvents]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleFinanceCacheUpdated = () => {
            setRefreshKey(previous => previous + 1);
        };

        window.addEventListener('agrisync:finance-cache-updated', handleFinanceCacheUpdated);
        return () => {
            window.removeEventListener('agrisync:finance-cache-updated', handleFinanceCacheUpdated);
        };
    }, []);

    const reportFarmId = events[0]?.farmId;
    // Fix pass 1 (L5) — W4 speaks for the farm(s) whose money this book shows (an empty book: every farm it could show),
    // and not under the labour-payout filter: a job-card payout's audience is never narrowed.
    const shownFarmIds = useMemo(() => [...new Set(events.map(e => e.farmId).filter((id): id is string => !!id))], [events]);

    return (
        <MoneyPage title={FINANCE_TITLE['finance-ledger']} testId="fin-ledger" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">शेताचा प्रत्येक रुपया इथे — बाकी सगळे आकडे इथूनच येतात.</p>

            <div className="grid grid-cols-2 gap-2">
                <GlassCard testId="ledger-in"><p className="m-0 text-[13px] font-bold text-stone-600">जमा</p><p className="m-0 text-[22px] font-extrabold text-emerald-800">{rupees(totalIncome)}</p></GlassCard>
                <GlassCard testId="ledger-out"><p className="m-0 text-[13px] font-bold text-stone-600">खर्च</p><p className="m-0 text-[22px] font-extrabold text-stone-900">{rupees(totalExpense)}</p></GlassCard>
            </div>
            {/* lane PRV (W4) — the totals above count only the money records he may see; say so when one is left out. */}
            {filterType !== 'LabourPayouts' && (
                <RuleNotCountedNote kind="money" farmIds={shownFarmIds.length > 0 ? shownFarmIds : undefined} testId="ledger-not-counted" />
            )}
            {noDirection > 0 && (
                <p className="m-0 rounded-2xl bg-stone-100 p-3 text-[13.5px] font-bold leading-snug text-stone-700" data-testid="ledger-no-direction">
                    {entriesCount(noDirection)} — जमा की खर्च ते नोंदलेलं नाही, म्हणून दोन्ही बेरजेत धरलेलं नाही.
                </p>
            )}

            <ChoiceChips items={FILTERS} value={filterType} onPick={setFilterType} testId="ledger-filter" />
            <ChoiceChips items={VIEWS} value={view} onPick={setView} testId="ledger-view" />
            {reportFarmId && <MonthlyCostPdfButton farmId={reportFarmId} testId="ledger-report" />}

            <div className="space-y-5">
                {groupedEvents.map(([date, dayEvents]) => (
                    <div key={date} className="space-y-2" data-testid={`ledger-day-${date}`}>
                        <div className="flex items-center gap-3 px-1">
                            <h3 className="m-0 text-[15px] font-extrabold text-stone-800">{formatDayKey(date)}</h3>
                            <div className="h-px flex-1 bg-stone-200" />
                            <span className="text-[12.5px] font-bold text-stone-500">{entriesCount(dayEvents.length)}</span>
                        </div>

                        {dayEvents.map(item => {
                            const state = entryState(item);
                            const source = SOURCE_LABEL[item.sourceType];
                            const tone: Tone = item.type === 'Income' ? 'green' : item.type === 'Expense' ? 'rose' : 'stone';
                            return (
                                <GlassCard key={item.id} testId={`ledger-row-${item.id}`} className={state === 'NeedsReview' ? 'border-l-4 border-l-amber-500' : ''}>
                                    <div className="flex items-center gap-3">
                                        <IconDot tone={tone} size={isDetailView ? 44 : 36}>
                                            {item.type === 'Income' ? <TrendingUp size={18} aria-hidden="true" />
                                                : item.type === 'Expense' ? <TrendingDown size={18} aria-hidden="true" />
                                                    : <CircleHelp size={18} aria-hidden="true" />}
                                        </IconDot>
                                        <div className="min-w-0 flex-1">
                                            <p className="m-0 truncate text-[15.5px] font-extrabold text-stone-900">{CATEGORY_LABEL[item.category]}</p>
                                            {isDetailView && (
                                                <p className="m-0 text-[13px] font-semibold text-stone-600" data-testid={`ledger-detail-${item.id}`}>
                                                    {source ? `${source} · ` : ''}{item.notes || 'तपशील नाही'}
                                                </p>
                                            )}
                                        </div>
                                        <MoneyChip
                                            amount={item.effectiveAmount}
                                            onClick={() => setDrawerFilter({ sourceType: item.sourceType, sourceId: item.sourceId })}
                                            className={`shrink-0 ${isDetailView ? 'px-3 py-1.5 text-[15px]' : 'px-2.5 py-1 text-[14px]'} ${item.type === 'Income' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : item.type === 'Expense' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-stone-300 bg-stone-50 text-stone-800'}`}
                                        />
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                        <Chip tone={STATE_TONE[state]}>{BUCKET_LABEL[state]}</Chip>
                                        <MoneyStateChip claim={evidence ? entryClaim(evidence, item.id) : null} testId={`ledger-state-${item.id}`} />
                                        <AudienceLockChip audience={audiences.get(item.id)?.audience} madeBySomeoneElse={item.createdByUserId !== selfUserId} testId={`ledger-audience-${item.id}`} />
                                        {item.type === 'Unknown' && <Chip tone="stone">जमा की खर्च — नोंद नाही</Chip>}
                                        {!item.plotId && item.type === 'Expense' && <Chip tone="blue">प्लॉटवर वाटलेला नाही</Chip>}
                                        {item.jobCardId && (
                                            <Tap onClick={() => onNavigate('jobs')} data-testid={`ledger-job-${item.id}`}
                                                className="min-h-[36px] rounded-full bg-white px-3 text-[13px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                                                काम पाहा
                                            </Tap>
                                        )}
                                        {item.type === 'Expense' && isDetailView && (
                                            <Tap onClick={() => setCorrectionTarget({ id: item.id, amount: item.effectiveAmount, category: item.category })} data-testid={`ledger-fix-${item.id}`}
                                                className="ml-auto flex min-h-[36px] items-center gap-1 rounded-full bg-white px-3 text-[13px] font-extrabold text-amber-800 ring-1 ring-amber-400">
                                                <Pencil size={14} aria-hidden="true" />दुरुस्त करा
                                            </Tap>
                                        )}
                                    </div>
                                    {isPrimaryHolder && isDetailView && !item.jobCardId && (
                                        <div className="mt-2">
                                            <AudienceRow kind="CostEntry" recordIds={[item.id]} farmId={item.farmId} selfUserId={selfUserId}
                                                audience={audiences.get(item.id)?.audience} chosen={audiences.get(item.id)?.people}
                                                madeBySomeoneElse={item.createdByUserId !== selfUserId} testId={`ledger-audience-row-${item.id}`} />
                                        </div>
                                    )}
                                </GlassCard>
                            );
                        })}
                    </div>
                ))}

                {filteredEvents.length === 0 && (
                    <GlassCard testId="ledger-empty">
                        <div className="py-3 text-center">
                            {events.length === 0 ? (
                                <>
                                    <p className="m-0 text-[17px] font-extrabold text-stone-800">वही रिकामी आहे</p>
                                    <p className="m-0 mt-1 text-[13.5px] font-semibold text-stone-600">खर्च किंवा जमा नोंदल्यावर इथे दिसेल.</p>
                                </>
                            ) : (
                                <p className="m-0 text-[15px] font-extrabold text-stone-700">या प्रकारची नोंद नाही.</p>
                            )}
                        </div>
                    </GlassCard>
                )}
            </div>

            <MoneyLensDrawer
                isOpen={!!drawerFilter}
                onClose={() => setDrawerFilter(null)}
                filters={drawerFilter || {}}
                canAdjust={true}
            />

            {correctionTarget && (
                <CostCorrectionSheet
                    costEntryId={correctionTarget.id}
                    originalAmount={correctionTarget.amount}
                    category={correctionTarget.category}
                    onClose={() => setCorrectionTarget(null)}
                    onCorrected={() => setRefreshKey(k => k + 1)}
                />
            )}
        </MoneyPage>
    );
};

export default LedgerPage;
