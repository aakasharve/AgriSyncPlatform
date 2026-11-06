/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-40 §2-3) — "मंजुरीसाठी N": the records awaiting THIS person's मंजूर on the
 * selected farm, from the server (`approvalQueue`). One tap opens the one review sheet. Drawn only when there is a
 * number to act on: never for someone who may not confirm, never for an unread list, never as an all-clear.
 */
import React from 'react';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import type { Language } from '../../i18n/language';
import { approvalWords } from './approvalWords';
import { openApprovalReview } from './openApprovalReview';
import { useApprovalQueue } from './useApprovalQueue';

export interface ApprovalChipProps {
    farmId: string | null | undefined;
    language: Language;
    /** `chip` sits in the strip's row; `block` is a full-width row on a page (आढावा). Never on लक्ष द्या (D-1). */
    variant?: 'chip' | 'block';
    'data-testid'?: string;
}

export const ApprovalChip: React.FC<ApprovalChipProps> = ({ farmId, language, variant = 'block', 'data-testid': testId = 'approval-chip' }) => {
    const { count } = useApprovalQueue(farmId);
    if (count === null || count === 0) return null;
    const label = approvalWords(language).approvalChip(count);
    if (variant === 'chip') {
        return (
            <button type="button" onClick={() => openApprovalReview()} data-testid={testId}
                className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 text-[13px] font-extrabold text-amber-900">
                <ClipboardCheck size={16} aria-hidden="true" className="shrink-0 text-amber-700" />
                <span className="whitespace-nowrap">{label}</span>
            </button>
        );
    }
    return (
        <button type="button" onClick={() => openApprovalReview()} data-testid={testId}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-[22px] bg-amber-50 px-3.5 py-2.5 text-left ring-1 ring-amber-200">
            <ClipboardCheck size={22} aria-hidden="true" className="shrink-0 text-amber-700" />
            <span className="min-w-0 flex-1 text-[15.5px] font-extrabold leading-snug text-stone-900">{label}</span>
            <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-stone-400" />
        </button>
    );
};
