/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2b; founder D-95; preview DFES-owner-check-scenario, phone 2) -
 * "औषधं तपासा (N)" on a recording inside an आढावा plot card. It shows ONLY to a person who holds the confirm-records authority on
 * this farm (the server's list of what this seat may do - never the सहमालक label, never a guess), so the owner and a trusted person
 * he gave that authority to see exactly the same thing. It opens the one review sheet on THAT record (`openApprovalReview`); it is
 * not a second place to approve and it blocks nothing (P9).
 *
 * Only a record someone ELSE made can be checked (the check is by a holder who is not the record's own speaker), and only while the
 * record still waits in the review list (draft or confirmed, not yet approved or doubted). When every product of such a record has
 * been checked, the recording says "औषधं तपासली" instead. A record that names no product shows nothing at all.
 */
import React, { createContext, useContext } from 'react';
import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { LogVerificationStatus, type DailyLog } from '../../../types';
import { approvalWords } from '../../approval/approvalWords';
import { openApprovalReview } from '../../approval/openApprovalReview';
import { productBoxesOf } from '../../logs/components/voiceResult/productModel';
import { answersOf } from '../../logs/components/voiceResult/inputIdentityModel';

/**
 * Does this seat hold the confirm-records authority on the open farm? The page answers it ONCE from the server's list
 * (`holdsAuthority(currentFarm, 'ConfirmRecords')`) and every recording under it reads the answer here. Outside the page (a recording
 * shown on its own) nobody is offered the button.
 */
export const ProductCheckAuthority = createContext<boolean>(false);

export interface ProductsToCheck {
    /** Products of these records no checker has checked yet. */
    unchecked: number;
    /** The products these records name that can be answered about. */
    total: number;
    /** The record the review sheet should open on: the first with something left to check. */
    focusLogId: string | null;
}

/** A record the review list still holds: draft or confirmed. An approved, doubted or corrected one is not in it. */
const awaitsReview = (log: DailyLog): boolean =>
    log.verification?.status === LogVerificationStatus.DRAFT || log.verification?.status === LogVerificationStatus.CONFIRMED;

/** Someone other than the signed-in person made it (a record of unknown maker is not offered: the check is by someone else). */
const madeBySomeoneElse = (log: DailyLog, viewerUserId: string | null): boolean => {
    const maker = log.meta?.createdByOperatorId;
    return !!maker && !!viewerUserId && maker !== viewerUserId;
};

/** What there is to check across the logs of one recording, for this viewer. Pure; reads, never writes. */
export function productsToCheckOf(logs: readonly DailyLog[], viewerUserId: string | null): ProductsToCheck {
    let unchecked = 0;
    let total = 0;
    let focusLogId: string | null = null;
    for (const log of logs) {
        if (!awaitsReview(log) || !madeBySomeoneElse(log, viewerUserId)) continue;
        const items = productBoxesOf(log).flatMap(b => b.items).filter(i => i.ref);
        const left = items.filter(i => !answersOf(log, i.ref).check).length;
        total += items.length;
        unchecked += left;
        if (left > 0 && focusLogId === null) focusLogId = log.id;
    }
    return { unchecked, total, focusLogId };
}

export const CheckProductsButton: React.FC<{ logs: readonly DailyLog[]; testId: string }> = ({ logs, testId }) => {
    const language = useOptionalLanguage()?.language;
    const words = approvalWords(language);
    // The server's word on what this seat may do; with no farm context nobody is offered it on a guess.
    if (!useContext(ProductCheckAuthority)) return null;
    const { unchecked, total, focusLogId } = productsToCheckOf(logs, getSessionUserId());
    if (total === 0) return null;
    if (unchecked === 0 || !focusLogId) {
        return (
            <div className="mt-2 flex items-center gap-1.5 text-[14.5px] font-extrabold text-emerald-800" data-testid={`${testId}-checked`}>
                <ShieldCheck size={20} aria-hidden="true" />{words.productsChecked}
            </div>
        );
    }
    return (
        <button type="button" onClick={() => openApprovalReview(focusLogId)} data-testid={`${testId}-check`}
            className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-emerald-600 bg-white text-[15.5px] font-extrabold text-emerald-800">
            <ClipboardCheck size={20} aria-hidden="true" />{words.checkProducts(unchecked)}
        </button>
    );
};
