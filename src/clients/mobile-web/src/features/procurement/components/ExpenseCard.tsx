/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — one bill in "बिलं आणि खरेदी", in the approved look:
 * the shop, what was on the bill, the amount, where it goes (plot / shared by the crop / whole farm), the day,
 * and the two marks it always had — उधार (on credit) and नोंदीशी जोडलेलं (linked to a day's record).
 * The bill photo, when there is one, stays as the thumbnail. Tapping the bill opens THAT DAY's money — on the
 * bill's plot when it has one, else across the farm (`MoneyLensDrawer`, via `onMoneyClick`); the bill's own
 * lines are among them (once synced), and the label
 * says "day", not "this bill"; without that handler the card is plain, never a dead button (P5).
 *
 * spec: pre-launch-repair L2a (D-19) — the bill also says, honestly, where its money stands (on this phone /
 * on the server / needs you — `MoneyStateChip`, only on evidence) and where its photo stands (the upload
 * words the app already has, `AttachmentStatusBadge`). No "paid" is assumed: उधार shows only when stated.
 */
import React from 'react';
import { ChevronRight, Link as LinkIcon, ShoppingBag } from 'lucide-react';
import type { ProcurementExpense } from '../../../types';
import { Chip, IconDot, Tap, type Tone } from '../../../shared/components/ui/placeUi';
import { fromDateKey, relLabel, rupees } from '../../reflect/overview/reflectDates';
import { NUM, SCOPE_LABEL } from './billView';
import { MoneyStateChip } from '../../finance/components/MoneyStateChip';
import AttachmentStatusBadge from '../../attachments/components/AttachmentStatusBadge';
import type { SyncHonestyClaim } from '../../sync/status/syncHonestyState';

interface Props {
    expense: ProcurementExpense;
    /** The named place the bill goes to (its plot, or "सर्व <crop>"), or ''. */
    place: string;
    onMoneyClick?: (expense: ProcurementExpense) => void;
    /** Where the bill's money stands; `null`/absent = no evidence, nothing shown. */
    moneyClaim?: SyncHonestyClaim;
    /** The bill photo's upload state, when the photo was queued. */
    photoStatus?: string;
}

const SCOPE_TONE: Record<ProcurementExpense['scope'], Tone> = { PLOT: 'green', CROP: 'violet', FARM: 'blue', UNKNOWN: 'stone' };

const dayOf = (key: string): string => (/^\d{4}-\d{2}-\d{2}/.test(key) ? relLabel(fromDateKey(key)) : '');

export const ExpenseCard: React.FC<Props> = ({ expense, place, onMoneyClick, moneyClaim = null, photoStatus }) => {
    const items = expense.lineItems.map(i => i.name).filter(Boolean).join(', ');
    const where = [place, SCOPE_LABEL[expense.scope]].filter(Boolean).join(' · ');
    const day = dayOf(expense.date);
    const linked = (expense.linkedLogIds?.length ?? 0) > 0;
    const body = (
        <span className="flex items-start gap-3">
            {expense.receiptImageUrl
                ? <img src={expense.receiptImageUrl} alt="बिलाचा फोटो" className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-stone-200" />
                : <IconDot tone={SCOPE_TONE[expense.scope]}><ShoppingBag size={22} aria-hidden="true" /></IconDot>}
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[16px] font-extrabold text-stone-900">{expense.vendorName?.trim() || 'दुकानाचं नाव नाही'}</span>
                    <span className="shrink-0 text-[16px] font-extrabold text-stone-900" style={{ fontFamily: NUM }}>{rupees(expense.grandTotal)}</span>
                </span>
                {items && <span className="block truncate text-[13.5px] font-semibold text-stone-600">{items}</span>}
                <span className="block text-[13.5px] font-semibold text-stone-600" data-testid={`bill-where-${expense.id}`}>{where}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-stone-500">
                    {day && <span>{day}</span>}
                    {expense.paymentStatus === 'CREDIT' && <Chip tone="rose">उधार</Chip>}
                    {linked && <Chip tone="blue"><LinkIcon size={12} aria-hidden="true" />नोंदीशी जोडलेलं</Chip>}
                    <MoneyStateChip claim={moneyClaim} testId={`bill-state-${expense.id}`} />
                    {photoStatus && <span className="inline-flex items-center gap-1" data-testid={`bill-photo-${expense.id}`}>बिलाचा फोटो <AttachmentStatusBadge status={photoStatus} /></span>}
                    {onMoneyClick && <span className="ml-auto inline-flex items-center gap-0.5 text-emerald-800">त्या दिवसाचा हिशोब<ChevronRight size={16} aria-hidden="true" /></span>}
                </span>
            </span>
        </span>
    );
    const look = 'block w-full rounded-3xl border border-white/60 bg-white/80 p-3.5 text-left shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)] backdrop-blur-md';
    return onMoneyClick
        ? <Tap onClick={() => onMoneyClick(expense)} data-testid={`bill-${expense.id}`} className={look}>{body}</Tap>
        : <div data-testid={`bill-${expense.id}`} className={look}>{body}</div>;
};
