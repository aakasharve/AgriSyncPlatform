/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DWC v2 §2.9 — Daily Work Closure smart reminder chip.
 *
 * Reads from local Dexie state (passed in via `history`) — no new server
 * call. Renders one of three states based on today's logs and last-7-day
 * verification counts:
 *
 *   TODAY_PENDING                 → no log for today        (warn / amber)
 *   TODAY_LOGGED_PENDING_VERIFY   → today logged, not yet verified (neutral)
 *   WEEK_VERIFIED                 → today verified — show running count (accent)
 *
 * Marathi text uses Noto Sans Devanagari per the global font rules; the
 * count number is wrapped in a span with DM Sans so the digit glyphs match
 * the rest of the brand UI. The chip is gated behind FEATURE_FLAGS.DwcChip
 * (default ON in dev, OFF in prod) so it can ramp independently.
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { LogVerificationStatus, type DailyLog } from '../../../domain/types/log.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';

export type DwcChipState = 'TODAY_PENDING' | 'TODAY_LOGGED_PENDING_VERIFY' | 'WEEK_VERIFIED';

interface DwcReminderChipProps {
    farmId: string;
    history: DailyLog[];
    /** Days in the rolling window for the WEEK_VERIFIED denominator. Defaults to 7. */
    windowDays?: number;
}

function isVerified(log: DailyLog): boolean {
    const s = log.verification?.status;
    return s === LogVerificationStatus.VERIFIED || s === LogVerificationStatus.APPROVED;
}

function isLoggedOnly(log: DailyLog): boolean {
    const s = log.verification?.status;
    if (!s) return true; // No status set = logged but not yet routed through verify FSM
    return (
        s === LogVerificationStatus.DRAFT ||
        s === LogVerificationStatus.CONFIRMED ||
        s === LogVerificationStatus.PENDING ||
        s === LogVerificationStatus.AUTO_APPROVED ||
        s === LogVerificationStatus.CORRECTION_PENDING
    );
}

function deriveState(history: DailyLog[], today: string): DwcChipState {
    const todays = history.filter(l => l.date === today);
    if (todays.length === 0) return 'TODAY_PENDING';
    if (todays.some(isVerified)) return 'WEEK_VERIFIED';
    if (todays.some(isLoggedOnly)) return 'TODAY_LOGGED_PENDING_VERIFY';
    return 'TODAY_LOGGED_PENDING_VERIFY';
}

function countVerifiedDaysInWindow(history: DailyLog[], windowDays: number, today: Date): number {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (windowDays - 1));
    const cutoffKey = getDateKey(cutoff);
    const seenDates = new Set<string>();
    for (const log of history) {
        if (log.date < cutoffKey) continue;
        if (log.date > getDateKey(today)) continue;
        if (isVerified(log)) seenDates.add(log.date);
    }
    return seenDates.size;
}

const MARATHI_FONT = "'Noto Sans Devanagari', sans-serif";
const DM_SANS_FONT = "'DM Sans', sans-serif";

const TONE_CLASSES: Record<DwcChipState, string> = {
    TODAY_PENDING: 'bg-amber-50 text-amber-900 border border-amber-200',
    TODAY_LOGGED_PENDING_VERIFY: 'bg-slate-50 text-slate-700 border border-slate-200',
    WEEK_VERIFIED: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
};

const DwcReminderChip: React.FC<DwcReminderChipProps> = ({ history, windowDays = 7 }) => {
    if (!FEATURE_FLAGS.DwcChip) return null;

    const today = new Date();
    const todayKey = getDateKey(today);
    const state = deriveState(history, todayKey);

    let body: React.ReactNode;
    if (state === 'TODAY_PENDING') {
        body = <span style={{ fontFamily: MARATHI_FONT }}>आजची नोंद बाकी</span>;
    } else if (state === 'TODAY_LOGGED_PENDING_VERIFY') {
        body = (
            <span style={{ fontFamily: MARATHI_FONT }}>आज नोंद झाली ✓ — verification बाकी</span>
        );
    } else {
        const verifiedCount = countVerifiedDaysInWindow(history, windowDays, today);
        body = (
            <span style={{ fontFamily: MARATHI_FONT }}>
                ✓{' '}
                <span data-testid="dwc-reminder-chip-count" style={{ fontFamily: DM_SANS_FONT }}>
                    {verifiedCount}/{windowDays}
                </span>{' '}
                दिवस verified
            </span>
        );
    }

    return (
        <div
            data-testid="dwc-reminder-chip"
            data-state={state}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${TONE_CLASSES[state]}`}
            role="status"
            aria-live="polite"
        >
            {body}
        </div>
    );
};

export default DwcReminderChip;
