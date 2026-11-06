/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-3, D-40 §2) — THE STRIP: the owner's
 * instant control centre for the selected farm. It replaces the single "तुमच्यासाठी बाकी" button, whose rest state
 * said "आज पर्यन्त सर्व कामे पूर्ण आहेत" while late work waited (D-3).
 *
 * Up to three separate signals, each a tap to its own place, only when non-zero:
 *  - "मंजुरीसाठी N"  — the server's list for this farm, for someone who may confirm → the ONE review sheet;
 *  - "पाठवणे बाकी N" — THIS phone's records still on their way (never farm-wide, never called "अडकलेल्या") → the
 *    sync sheet; rows that really need him get the failure words instead, as their own signal;
 *  - the लक्ष द्या preview ("२ कामे उशिराची · १ आठवण आज") → लक्ष द्या.
 * With none of them, it says "मंजुरीसाठी नोंदी बाकी नाहीत" ONLY when the server's list for this farm was read and he
 * may confirm; an unread list says "यादी आत्ता दिसत नाही". Never an all-clear. The approvals themselves happen in the
 * sheet (no approve button here, D-3). The waiting drawer (who recorded since you last looked) stays one tap away.
 */
import React from 'react';
import { ChevronDown, CircleAlert, CloudUpload, TriangleAlert } from 'lucide-react';
import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { formatOversightTemplate } from '../formatOversightTemplate';
import { approvalWords } from '../../approval/approvalWords';
import { ApprovalChip } from '../../approval/ApprovalChip';
import { useApprovalQueue } from '../../approval/useApprovalQueue';
import { useUnsentRecordCount } from '../../approval/unsentRecords';

export interface StripSignalsProps {
    language: Language;
    farmId: string | null;
    /** Rows that need him: refused or past the retry cap, failed photo uploads, records nothing will send. */
    needsYouCount: number;
    /** The लक्ष द्या preview, from the same list as its page and the bottom bar's count. */
    attention?: { total: number; summary: string };
    onOpenSync: () => void;
    onOpenAttention?: () => void;
    onOpenWaiting: () => void;
}

const chipBase = 'flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-extrabold';

const StripSignals: React.FC<StripSignalsProps> = ({ language, farmId, needsYouCount, attention, onOpenSync, onOpenAttention, onOpenWaiting }) => {
    const words = approvalWords(language);
    const approval = useApprovalQueue(farmId);
    const unsent = useUnsentRecordCount();
    const showApproval = (approval.count ?? 0) > 0;
    const showUnsent = unsent > 0;
    const showNeedsYou = needsYouCount > 0;
    const showAttention = !!attention && attention.total > 0 && !!onOpenAttention;
    const anySignal = showApproval || showUnsent || showNeedsYou || showAttention;

    let restLine: string | null = null;
    if (!anySignal) {
        if (approval.status === 'known' && approval.mayConfirm && approval.count === 0) restLine = words.empty;
        else if (approval.status !== 'known') restLine = words.listUnknown;
    }

    return (
        <div data-testid="strip-signals" className="flex w-full items-center gap-2 rounded-2xl border border-stone-200 bg-white px-2 py-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {showApproval && <ApprovalChip farmId={farmId} language={language} variant="chip" data-testid="strip-approval" />}
                {showUnsent && (
                    <button type="button" onClick={onOpenSync} data-testid="strip-unsent" className={`${chipBase} border-sky-200 bg-sky-50 text-sky-900`}>
                        <CloudUpload size={16} aria-hidden="true" className="shrink-0" />
                        <span className="whitespace-nowrap">{words.unsentChip(unsent)}</span>
                    </button>
                )}
                {showNeedsYou && (
                    <button type="button" onClick={onOpenSync} data-testid="strip-needs-you" className={`${chipBase} border-rose-200 bg-rose-50 text-rose-900`}>
                        <TriangleAlert size={16} aria-hidden="true" className="shrink-0" />
                        <span>{formatOversightTemplate(resolveOversightString(language, 'failedSends'), { count: needsYouCount })}</span>
                    </button>
                )}
                {showAttention && attention && (
                    <button type="button" onClick={onOpenAttention} data-testid="strip-attention" className={`${chipBase} border-amber-200 bg-amber-50 text-amber-900`}>
                        <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                        <span>{attention.summary}</span>
                    </button>
                )}
                {restLine && <span data-testid="strip-rest" className="px-1.5 text-[13px] font-bold text-stone-500">{restLine}</span>}
            </div>
            <button type="button" onClick={onOpenWaiting} data-testid="canonical-strip-waiting-button"
                aria-label={resolveOversightString(language, 'waitingLabel')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <ChevronDown size={18} aria-hidden="true" />
            </button>
        </div>
    );
};

export default StripSignals;
