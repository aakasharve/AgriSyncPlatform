/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReasonStep — the one confirm step before an owner decision that stops someone (decline a request,
 * pause, remove): what is about to happen, an optional written reason, confirm or cancel. The reason
 * is stored by the server (at most 500 characters) and shown to a paused person. A reason that is
 * too long is never cut behind the owner's back: the box keeps every letter, says so, and the
 * confirm waits until he shortens it (the server would refuse it anyway).
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2).
 */
import React, { useState } from 'react';
import { TextField, Tap } from '../../../shared/components/ui/placeUi';
import { TEAM_COPY } from './teamCopy';

/** The server column is varchar(500): a longer reason is refused, never silently cut. */
export const MAX_REASON = 500;

export const ReasonStep: React.FC<{
    question: string;
    confirmLabel: string;
    /** The person will read this reason (a pause): say so. */
    reasonIsShown?: boolean;
    busy: boolean;
    onConfirm: (reason: string) => void;
    onCancel: () => void;
    testId: string;
}> = ({ question, confirmLabel, reasonIsShown, busy, onConfirm, onCancel, testId }) => {
    const [reason, setReason] = useState('');
    const tooLong = reason.trim().length > MAX_REASON;
    return (
        <div className="mt-2 space-y-2 rounded-2xl bg-rose-50/60 p-3 ring-1 ring-rose-200" data-testid={testId} role="group">
            <p className="m-0 text-[15px] font-extrabold text-stone-900">{question}</p>
            <TextField label={TEAM_COPY.reasonLabel} value={reason} testId={`${testId}-reason`}
                onChange={setReason} error={tooLong ? TEAM_COPY.reasonTooLong(MAX_REASON) : undefined} />
            {reasonIsShown && <p className="m-0 text-[12.5px] font-bold text-stone-600">{TEAM_COPY.reasonSeen}</p>}
            <div className="flex gap-2">
                <Tap onClick={() => onConfirm(reason)} disabled={busy || tooLong} data-testid={`${testId}-confirm`} rippleColor="rgba(255,255,255,0.35)"
                    className="min-h-[50px] flex-1 rounded-full bg-rose-700 px-4 text-[15.5px] font-extrabold text-white disabled:opacity-60">
                    {confirmLabel}
                </Tap>
                <Tap onClick={onCancel} disabled={busy} data-testid={`${testId}-cancel`}
                    className="min-h-[50px] rounded-full bg-stone-100 px-5 text-[15px] font-extrabold text-stone-700 disabled:opacity-60">
                    {TEAM_COPY.cancel}
                </Tap>
            </div>
        </div>
    );
};

export default ReasonStep;
