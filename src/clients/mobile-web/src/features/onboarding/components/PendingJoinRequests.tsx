/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the seats a person holds that have not ended
 * but grant nothing yet, each said for what it is and with what the person can do about it:
 *   - a join REQUEST (he typed the farm's code; PendingApproval) — "waiting for the owner", and
 *     "विनंती मागे घ्या" to withdraw it. Before this, a request could not be withdrawn from the app
 *     at all (the farm lists drop every seat that is not Active), although the server always
 *     accepts it (self-exit uses the relationship scope);
 *   - a PAUSED seat (Suspended) — "your work on this farm is paused; talk to the owner". No
 *     button: it is not a request, and the words must never call it one.
 *
 * Shown on the 0-farm screen (MinimalOnboarding) and on the profile beside "your farms". Every
 * Marathi string is PROPOSED; the paused words are the ones JoinByCodeScreen already uses.
 */
import React, { useState } from 'react';
import { Clock3, PauseCircle } from 'lucide-react';
import { JOIN_BY_CODE_COPY } from './JoinByCodeScreen';

/** PROPOSED Marathi. */
export const PENDING_SEAT_COPY = {
    requestLine: 'विनंती पाठवली — मालकाच्या मंजुरीची वाट',
    withdraw: 'विनंती मागे घ्या',
    withdrawing: 'मागे घेत आहे…',
    withdrawFailed: 'आत्ता मागे घेता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
    pausedLine: `${JOIN_BY_CODE_COPY.pausedTitle}. ${JOIN_BY_CODE_COPY.pausedLine}`,
} as const;

/** What a seat that is not Active means to the person holding it. */
export type WaitingSeatKind = 'request' | 'paused';

/** A paused seat is never "a request"; every other not-Active status is one still waiting. */
export const waitingSeatKind = (status?: string | null): WaitingSeatKind =>
    status === 'Suspended' ? 'paused' : 'request';

export interface WaitingSeat {
    farmId: string;
    name: string;
    status?: string | null;
}

export interface PendingJoinRequestsProps {
    seats: WaitingSeat[];
    /**
     * Withdraws the request (server self-exit) and refreshes the lists. Rejects on failure.
     * Without it no withdraw button is drawn — a button that cannot act is never shown (P5).
     */
    onWithdraw?: (farmId: string) => Promise<void>;
    testId?: string;
}

const PendingJoinRequests: React.FC<PendingJoinRequestsProps> = ({ seats, onWithdraw, testId = 'pending-join-requests' }) => {
    const [busyFarmId, setBusyFarmId] = useState<string | null>(null);
    const [failedFarmId, setFailedFarmId] = useState<string | null>(null);

    if (seats.length === 0) return null;

    const withdraw = async (farmId: string) => {
        if (busyFarmId || !onWithdraw) return;
        setBusyFarmId(farmId);
        setFailedFarmId(null);
        try {
            await onWithdraw(farmId);
        } catch {
            setFailedFarmId(farmId);
        } finally {
            setBusyFarmId(null);
        }
    };

    return (
        <ul data-testid={testId} className="m-0 list-none space-y-2 p-0">
            {seats.map(seat => {
                const kind = waitingSeatKind(seat.status);
                return (
                    <li
                        key={seat.farmId}
                        data-testid={`pending-seat-${seat.farmId}`}
                        data-kind={kind}
                        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
                    >
                        <p className="m-0 flex items-start gap-2">
                            {kind === 'paused'
                                ? <PauseCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                : <Clock3 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
                            <span>
                                <span className="font-extrabold">{seat.name}</span>
                                {': '}
                                {kind === 'paused' ? PENDING_SEAT_COPY.pausedLine : PENDING_SEAT_COPY.requestLine}
                            </span>
                        </p>
                        {kind === 'request' && onWithdraw && (
                            <button
                                type="button"
                                data-testid={`withdraw-request-${seat.farmId}`}
                                onClick={() => void withdraw(seat.farmId)}
                                disabled={busyFarmId !== null}
                                className="mt-2 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:border-amber-400 disabled:opacity-50"
                            >
                                {busyFarmId === seat.farmId ? PENDING_SEAT_COPY.withdrawing : PENDING_SEAT_COPY.withdraw}
                            </button>
                        )}
                        {failedFarmId === seat.farmId && (
                            <p role="alert" className="m-0 mt-2 text-xs font-bold text-rose-700">
                                {PENDING_SEAT_COPY.withdrawFailed}
                            </p>
                        )}
                    </li>
                );
            })}
        </ul>
    );
};

export default PendingJoinRequests;
