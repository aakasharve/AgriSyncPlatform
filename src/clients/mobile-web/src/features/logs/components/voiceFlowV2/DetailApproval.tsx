/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (founder 2026-11-26: "exact replication") — the detail page's "मंजुरीसाठी N", drawn as the approved
 * design draws it (`.aadbtn.sm`: deep green, ✔, the count, one small line, ›). It is the ONE approval path (plr-d10 I28, D-3): the
 * count is the server's list for THIS person on THIS farm (`useApprovalQueue`), and the tap opens the one review sheet
 * (`openApprovalReview`). Drawn only when there is a number to act on — never for someone the list says may not confirm, never for
 * a list not read yet, never as an all-clear ("मंजुरीसाठी ०"). No number is made up (P4).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { approvalWords } from '../../../approval/approvalWords';
import { openApprovalReview } from '../../../approval/openApprovalReview';
import { useApprovalQueue } from '../../../approval/useApprovalQueue';
import { SANS } from './savedBits';
import { savedWords } from './savedWords';

export const DetailApproval: React.FC<{ farmId: string | null }> = ({ farmId }) => {
    const { count } = useApprovalQueue(farmId);
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    if (count === null || count === 0) return null;
    return (
        <button type="button" onClick={() => openApprovalReview()} data-testid="vr2d-approvals" style={{ fontFamily: SANS }}
            className="flex min-h-[60px] w-full items-center gap-3 rounded-[20px] bg-[#0F6B3A] px-3.5 py-3 text-left text-white active:scale-[0.99]">
            <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full bg-white/[0.18] text-[20px]" aria-hidden="true">✔</span>
            <span className="min-w-0">
                <b className="block text-[17px] font-bold leading-[1.25]" data-testid="vr2d-approvals-count">{approvalWords(language).approvalChip(count)}</b>
                <small className="block text-[12.5px] font-semibold opacity-90">{savedWords(language).approvalSub}</small>
            </span>
            <span className="ml-auto text-[30px] leading-none" aria-hidden="true">›</span>
        </button>
    );
};

export default DetailApproval;
