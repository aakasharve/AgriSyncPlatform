/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
 * and when"). One bill's मंजूर line, wherever a bill appears (the तपासायचे list, the money drawer):
 *  - its stamp — "मंजूर · ‹नाव› · ‹दिवस›", or, when the bill was corrected after it, "आधीच्या रूपाला मंजूर · …";
 *  - for a reviewer (the server's rule, `mayApproveBills`) and a bill no stamp covers at its version: "मंजूर करा";
 *  - what this phone still holds: an approval waiting to go; one the server refused because the bill CHANGED (the new
 *    version is shown, and approved again only once it has reached this phone); one refused for another reason.
 * Everyone else sees the stamp where he sees the bill, and never the action. Words: one language at a time (PROPOSED).
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { EffectiveMoneyEvent } from '../finance.types';
import { approvalIsDue, approveBill, billStamp, readBillApprovalOutbox, EMPTY_OUTBOX, type BillApprovalOutbox } from '../billApproval';
import { billWord, refusalLine, stampLine, type BillLang } from '../billApprovalWords';
import { rupees } from '../moneyLabels';

/** ₹ when the amount is a real figure; "—" when it is withheld or unreadable (P4: never ₹0, never a guess). */
const amountText = (amount: number | undefined, language: BillLang): string =>
    typeof amount === 'number' && Number.isFinite(amount) ? rupees(amount) : billWord('withheld', language);

/**
 * This phone's approvals the server has not taken (all farms: a bill id is unique), read again whenever the money cache
 * changes and after each approval sent from here. `enabled` false (a closed drawer) reads nothing.
 */
export function useBillApprovalOutbox(enabled = true): [BillApprovalOutbox, () => void] {
    const [outbox, setOutbox] = useState<BillApprovalOutbox>(EMPTY_OUTBOX);
    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick(v => v + 1), []);

    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        void readBillApprovalOutbox(null).then(next => { if (live) setOutbox(next); });
        return () => { live = false; };
    }, [tick, enabled]);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        window.addEventListener('agrisync:finance-cache-updated', refresh);
        return () => window.removeEventListener('agrisync:finance-cache-updated', refresh);
    }, [refresh, enabled]);

    return [outbox, refresh];
}

interface BillApprovalLineProps {
    bill: EffectiveMoneyEvent;
    /** The server's rule for THIS bill's farm (`mayApproveBills`); false = the stamp only, never the action. */
    mayApprove: boolean;
    outbox: BillApprovalOutbox;
    language: BillLang;
    /** After an approval was queued here: read the outbox again. */
    onQueued: () => void;
}

export const BillApprovalLine: React.FC<BillApprovalLineProps> = ({ bill, mayApprove, outbox, language, onQueued }) => {
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);
    const stamp = billStamp(bill);
    const pending = outbox.pending.has(bill.id);
    // fix round 1 (review L5) — once someone stamped the version the bill stands at, a parked "it changed" refusal has
    // nothing left to ask: the stamp shows, and the box goes.
    const changed = stamp === 'approved' ? undefined : outbox.changed.get(bill.id);
    const refused = outbox.refused.get(bill.id);
    // A refusal because the bill changed: the NEW version must be on this phone before it can be approved.
    const newVersionHere = !!changed && bill.billVersion !== undefined && bill.billVersion > changed.seenVersion;
    const canApprove = mayApprove && approvalIsDue(bill) && !pending && (!changed || newVersionHere) && !sending;

    const send = async () => {
        setSending(true);
        setFailed(false);
        try {
            await approveBill(bill, changed?.rowId);
            onQueued();
        } catch {
            setFailed(true);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mt-1.5 flex flex-col gap-1.5" data-testid={`bill-approval-${bill.id}`}>
            {bill.approval && stamp !== 'none' && (
                <p
                    data-testid={`bill-stamp-${bill.id}`}
                    data-stamp={stamp}
                    className={`m-0 text-[13px] font-extrabold ${stamp === 'approved' ? 'text-emerald-800' : 'text-amber-900'}`}
                >
                    {stampLine(bill.approval, stamp === 'approvedOlder', language)}
                </p>
            )}
            {stamp === 'approvedOlder' && mayApprove && !pending && !changed && (
                <p className="m-0 text-[12.5px] font-semibold text-amber-800">{billWord('olderHint', language)}</p>
            )}
            {pending && (
                <p data-testid={`bill-pending-${bill.id}`} className="m-0 text-[13px] font-bold text-stone-600">
                    {billWord('pending', language)}
                </p>
            )}
            {changed && !pending && (
                <div data-testid={`bill-changed-${bill.id}`} className="rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200">
                    <p className="m-0 text-[13px] font-extrabold text-amber-900">
                        {newVersionHere ? billWord('changed', language) : billWord('changedNotHereYet', language)}
                    </p>
                    {newVersionHere && (
                        <p className="m-0 text-[13px] font-bold text-amber-900">
                            {billWord('newAmount', language)}: {amountText(bill.effectiveAmount, language)}
                        </p>
                    )}
                </div>
            )}
            {refused !== undefined && !changed && !pending && (
                <p data-testid={`bill-refused-${bill.id}`} className="m-0 text-[13px] font-bold text-rose-800">
                    {refusalLine(refused, language)}
                </p>
            )}
            {failed && (
                <p className="m-0 text-[13px] font-bold text-rose-800">{billWord('failed', language)}</p>
            )}
            {canApprove && (
                <button
                    type="button"
                    data-testid={`bill-approve-${bill.id}`}
                    onClick={() => { void send(); }}
                    className="self-start rounded-xl bg-emerald-700 px-4 py-2 text-[14px] font-extrabold text-white"
                >
                    {billWord('approve', language)}
                </button>
            )}
        </div>
    );
};
