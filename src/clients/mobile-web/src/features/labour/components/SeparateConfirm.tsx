/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SeparateConfirm — DESIGN PREVIEW ONLY (PLR-D9, founder 2026-10-25): "attendance and their wage are DIFFERENT re-confirmations,
 * by the mukadam or the owner." On a review card the one मंजूर becomes two separate confirmations — हजेरी बरोबर (the count) and
 * मजुरी बरोबर (the money) — each saying who confirmed it, with शंका kept for either.
 *
 * It SENDS NOTHING. The server knows one verification per log (`verify_log`, which can also advance job-card payout), not one for
 * attendance and another for wages; until it does, this component may only be switched on by the design preview
 * (`LabourFeature confirmMode="separate"`). The real app keeps `together` — the existing मंजूर / शंका, unchanged.
 *
 * Money rule (D-H8): the मजुरी row appears only where the review item carries an amount (the owner's view; the server strips money
 * for everyone else). A blank amount is "—", never ₹0.
 */
import React, { useState } from 'react';
import { Check, MessageSquare, Users, Wallet } from 'lucide-react';
import type { ReviewItem } from '../labour.types';
import { inr } from '../labourMock';
import { toMr } from './LabourDataPoints';

type Part = 'attendance' | 'wage';

const Row: React.FC<{ part: Part; icon: React.ReactNode; title: string; value: string; doneBy?: string; confirmerLabel: string; onConfirm: () => void; testId: string }> = ({ part, icon, title, value, doneBy, confirmerLabel, onConfirm, testId }) => (
    <div className={`flex items-center gap-3 rounded-xl border p-2.5 ${doneBy ? 'border-emerald-200 bg-emerald-50' : 'border-stone-200 bg-white'}`} data-testid={testId} data-part={part}>
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${part === 'wage' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold text-stone-500">{title}</span>
            <span className="block text-[19px] font-extrabold text-stone-800 [font-variant-numeric:tabular-nums]">{value}</span>
        </span>
        {doneBy ? (
            <span className="flex-shrink-0 text-right text-[16px] font-extrabold leading-tight text-emerald-700">✓ पक्कं<span className="block text-[16px] font-bold text-emerald-600">{doneBy}</span></span>
        ) : (
            <button type="button" onClick={onConfirm} data-testid={`${testId}-confirm`}
                className="flex min-h-[56px] flex-shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-[17px] font-extrabold text-white active:scale-[0.97]">
                <Check size={20} strokeWidth={2.6} /> बरोबर
            </button>
        )}
        <span className="sr-only">{confirmerLabel}</span>
    </div>
);

export const SeparateConfirm: React.FC<{ item: ReviewItem; confirmerLabel: string; onQuery: () => void }> = ({ item, confirmerLabel, onQuery }) => {
    const [done, setDone] = useState<Partial<Record<Part, string>>>({});
    const { count, amount } = item.points;
    const showWage = amount !== undefined;
    return (
        <div className="mt-3 space-y-2" data-testid={`separate-confirm-${item.id}`}>
            <Row part="attendance" icon={<Users size={20} />} title="हजेरी" value={count != null ? `${toMr(count)} जण` : '—'}
                doneBy={done.attendance} confirmerLabel={confirmerLabel} onConfirm={() => setDone(d => ({ ...d, attendance: confirmerLabel }))} testId={`confirm-attendance-${item.id}`} />
            {showWage && (
                <Row part="wage" icon={<Wallet size={20} />} title="मजुरी" value={amount == null ? '—' : inr(amount)}
                    doneBy={done.wage} confirmerLabel={confirmerLabel} onConfirm={() => setDone(d => ({ ...d, wage: confirmerLabel }))} testId={`confirm-wage-${item.id}`} />
            )}
            <button type="button" onClick={onQuery} data-testid={`separate-query-${item.id}`}
                className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-200 bg-white text-[18px] font-bold text-stone-600 active:scale-[0.98]">
                <MessageSquare size={20} /> शंका
            </button>
            <p className="text-[16px] leading-snug text-stone-500">हजेरी आणि मजुरी वेगवेगळी पक्की होते — मुकादम किंवा मालक.</p>
        </div>
    );
};
