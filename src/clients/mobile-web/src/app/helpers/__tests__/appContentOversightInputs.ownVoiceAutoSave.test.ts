/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — fidelity MAJOR.
 *
 * His own voice recording is saved at once as an unconfirmed draft (founder decision 2026-09-02: "the record
 * counts even if he never confirms"). Before this fix every recording he did not confirm added to the strip's
 * '{count} कामे तपासायची आहेत' row and left its day open, so the next day also said 'कालचा दिवस बंद झाला
 * नाही'. Neither could ever be cleared: 'पक्कं आहे' exists only on the result screen right after speaking, and
 * the review inbox keeps only OTHER people's logs (P5: no nag he cannot act on).
 *
 * Driven through the REAL `buildOversightHeaderInputs` and the REAL strip model (`buildOversightModel`), whose
 * 'approval' row renders '{count} कामे तपासायची आहेत' and whose 'dayNotClosed' row renders 'कालचा दिवस बंद झाला
 * नाही'. The same frozen clock as `appContentOversightInputs.test.ts`.
 *
 * Lane L4b fix round 1: the 'approval' row is now the farm's ONE server count (`approvalQueue`, founder D-40 §1),
 * so the phone's own approval tally this file once pinned was deleted; the 'dayNotClosed' half is unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildOversightHeaderInputs } from '../appContentOversightInputs';
import { markAutoSavedFromVoice } from '../autoSavedVoiceLog';
import { buildOversightModel } from '../../../features/oversight/oversightSelectors';
import { computeDayState } from '../../../shared/utils/dayState';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { LogVerificationStatus } from '../../../types';
import type { DailyLog } from '../../../types';

const FROZEN_NOW = new Date('2026-08-20T06:00:00.000Z');
const TODAY = getDateKey(FROZEN_NOW);
const YESTERDAY = getDateKey(new Date(FROZEN_NOW.getTime() - 86_400_000));

const ME = 'op-purvesh';
const MY_SESSION = '7d3f9a52-1c4b-4e8f-9a6d-2b5c8e1f0a37';
const RAMESH = 'op-ramesh';
const YOU = new Set([ME, MY_SESSION]);

const DRAFT: DailyLog['verification'] = { status: LogVerificationStatus.DRAFT, required: true };
const VERIFIED: DailyLog['verification'] = {
    status: LogVerificationStatus.VERIFIED,
    required: true,
    verifiedByOperatorId: ME,
    verifiedAtISO: `${YESTERDAY}T10:00:00.000Z`,
};

/** One crop-activity record on no scheduled plot, shaped like a `LogFactory` row. */
function log(id: string, date: string, createdBy: string, verification: DailyLog['verification']): DailyLog {
    return {
        id,
        date,
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [{ id: `${id}-act`, title: 'छाटणी' }],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: `${date}T09:15:00.000Z`, createdByOperatorId: createdBy },
        verification,
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    } as unknown as DailyLog;
}

/** His recording exactly as the auto-save writes it: the real `markAutoSavedFromVoice`. */
function myAutoSave(id: string, date: string, createdBy = ME): DailyLog {
    return markAutoSavedFromVoice(log(id, date, createdBy, VERIFIED));
}

/** The strip's rows for this history, as `AppHeader` builds them. */
function stripRows(history: DailyLog[], youIds: ReadonlySet<string> = YOU) {
    const inputs = buildOversightHeaderInputs(history, [], [], [], youIds);
    const model = buildOversightModel({
        logs: history,
        checkpointISO: null,
        nowISO: FROZEN_NOW.toISOString(),
        operatorNameById: inputs.operatorNameById,
        // lane L4b — the approval row is the farm's server count now; this file pins the phone-local half only.
        unverifiedCount: 0,
        yesterdayNotClosed: inputs.yesterdayNotClosed,
        failedSendCount: 0,
        unqueueableCount: 0,
        approvalHolderName: null,
    });
    return { inputs, kinds: model.decisions.map(d => d.kind) };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('his own voice auto-save is not "waiting on him"', () => {
    it('an unconfirmed recording of his from yesterday raises no "day not closed" row', () => {
        const { inputs, kinds } = stripRows([myAutoSave('mine-y', YESTERDAY), myAutoSave('mine-t', TODAY)]);

        expect(inputs.yesterdayNotClosed).toBe(false);
        expect(kinds).not.toContain('dayNotClosed');
    });

    it('is recognised by his signed-in id too (a pulled copy carries the server id, the phone may still say "owner")', () => {
        const { inputs } = stripRows([myAutoSave('mine-pulled', YESTERDAY, MY_SESSION)], new Set(['owner', MY_SESSION]));

        expect(inputs.yesterdayNotClosed).toBe(false);
    });

    it('stays honest: still a draft, still unverified for the day, and earns no confirmation credit', () => {
        const mine = myAutoSave('mine-y', YESTERDAY);
        stripRows([mine]);

        expect(mine.verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(mine.verification?.verifiedAtISO).toBeUndefined();
        const day = computeDayState({ logs: [mine], crops: [], date: YESTERDAY, reviewNotAwaited: l => l.id === mine.id });
        expect(day.unverifiedCount).toBe(1);
        expect(day.verifiedCount).toBe(0);
        // 70 = the recorded-work half only; the 30-point confirmation half stays unearned.
        expect(day.closurePercent).toBe(70);
        expect(day.isClosed).toBe(true);
    });
});

describe('everything else counts exactly as before', () => {
    it('another person\'s draft still holds yesterday open', () => {
        const { inputs, kinds } = stripRows([myAutoSave('mine-y', YESTERDAY), log('ramesh-y', YESTERDAY, RAMESH, DRAFT)]);

        expect(inputs.yesterdayNotClosed).toBe(true);
        expect(kinds).toEqual(['dayNotClosed']);
    });

    it('a log carrying the auto-save marker but made by someone else still counts', () => {
        const { inputs } = stripRows([myAutoSave('ramesh-auto', YESTERDAY, RAMESH)]);

        expect(inputs.yesterdayNotClosed).toBe(true);
    });

    it('his own typed (not auto-saved) draft still counts, as it did before', () => {
        const { inputs } = stripRows([log('mine-typed', YESTERDAY, ME, DRAFT)]);

        expect(inputs.yesterdayNotClosed).toBe(true);
    });

    it('his own reviewed (verified) log neither counts nor holds the day open, as before', () => {
        const { inputs, kinds } = stripRows([log('mine-reviewed', YESTERDAY, ME, VERIFIED)]);

        expect(inputs.yesterdayNotClosed).toBe(false);
        expect(kinds).toEqual([]);
    });

    it('with no identity known (the preview path), his auto-save counts as it always did', () => {
        const history = [myAutoSave('mine-y', YESTERDAY)];
        const inputs = buildOversightHeaderInputs(history, [], [], []);

        expect(inputs.yesterdayNotClosed).toBe(true);
    });
});
