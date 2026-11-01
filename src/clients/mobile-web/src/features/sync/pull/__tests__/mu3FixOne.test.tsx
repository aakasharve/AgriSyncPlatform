// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix pass 1 — the phone's half of the review's findings:
 *   F9  the pull names the farms this phone holds (`farms=`);
 *   F11 the money doors read the SAME stored answer the purge applied (`/me/context` only before the first pull);
 *   F5  a command answer's money is never stored for a farm whose money is not this person's;
 *   F10 a withheld wage reads "नियमानुसार दिसत नाही" (W3), never "not stated";
 *   F3  a record that mentions money shows the rule card (W1) in place of its words, and its voice says the same;
 *   F7  a job card's held-back pay reads W3, never ₹0;
 *   item 16  every one of these lines is ShramSafal's rule — never "to you", never pointing at the owner.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/dtos';
import type { LabourEngagementDto } from '../../../../infrastructure/api/labourDtos';
import { ACCESS_SCOPES_META_KEY, readHeldFarmIds } from '../../../../infrastructure/storage/accessScopeStore';
import { pullSyncChanges } from '../../../../infrastructure/api/resources/SyncResource';
import type { HttpTransport } from '../../../../infrastructure/api/transport';
import { seeMoneyDoor } from '../../../../core/session/storedFarmScope';
import { takeMovedMoney } from '../../../finance/movedMoney';
import { mapLabourEngagements } from '../helpers/mapLabourEngagements';
import { partEntriesOf, recordingOf } from '../../../logs/components/voiceResult/resultModel';
import OriginalVoiceButton from '../../../logs/components/originalVoice/OriginalVoiceButton';
import { MoneyWordsWithheldCard } from '../../../logs/components/originalVoice/MoneyWordsWithheldCard';
import { ruleWithheldCopy } from '../../../../i18n/ruleWithheldTranslations';
import { jobCardAmountText } from '../../../work/jobCardAmount';
import type { DailyLog } from '../../../../types';

const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const AT = '2026-11-01T06:00:00.000Z';

const scope = (farmId: string, over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true, seeCompliance: true,
    seeFarmOverview: true, ...over,
});

const crew = (over: Partial<LabourEngagementDto> = {}): LabourEngagementDto => ({
    labourAssignmentId: 'la-1', dailyLogId: 'log-1', engagementType: 'Hired', workerCount: 8, maleCount: null, femaleCount: null,
    wagePerPerson: null, contractUnit: null, contractQuantity: null, totalCost: null, durationHours: 8, timeBasis: 'Assumed',
    shift: null, task: null, notes: null, workerNames: [], createdAtUtc: AT, linkedActivityId: null, attributedOperators: [], ...over,
});

const log = (over: Partial<DailyLog>): DailyLog => ({
    id: 'log-1', date: '2026-10-30', context: { selection: [] }, dayOutcome: null, cropActivities: [], irrigation: [], labour: [],
    inputs: [], machinery: [], activityExpenses: [], meta: { createdAtISO: AT, createdByOperatorId: 'someone', farmId: FARM_A },
    ...over,
} as unknown as DailyLog);

const DEPS = { youIds: new Set<string>(), nameOf: () => 'मालक', youLabel: 'तुम्ही', unknownLabel: '—' };

beforeEach(async () => {
    const db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
});
afterEach(cleanup);

describe('MU-3 fix 1 — the phone', () => {
    it('F9: the pull names every farm this phone holds, once, as farms=', async () => {
        const db = getDatabase();
        await db.farms.put({ id: FARM_B, payload: {}, updatedAt: AT });
        await db.plots.put({ id: 'p1', farmId: FARM_A, payload: {}, updatedAt: AT });
        await db.cropCycles.put({ id: 'c1', farmId: FARM_A, plotId: 'p1', payload: {}, updatedAt: AT });
        const held = await readHeldFarmIds(db);
        expect(held).toEqual([FARM_A, FARM_B]);

        const get = vi.fn().mockResolvedValue({ data: {} });
        await pullSyncChanges({ http: { get } } as unknown as HttpTransport, '2026-11-01T06:00:00.123Z', held);
        expect(get).toHaveBeenCalledWith('/sync/pull', { params: { since: '2026-11-01T06:00:00Z', farms: `${FARM_A},${FARM_B}` } });
        get.mockClear();
        // Fix 2 (N5): a phone holding no farm still says so (`farms=`); only a caller that says nothing sends nothing.
        await pullSyncChanges({ http: { get } } as unknown as HttpTransport, undefined, []);
        expect(get).toHaveBeenCalledWith('/sync/pull', { params: { farms: '' } });
        get.mockClear();
        await pullSyncChanges({ http: { get } } as unknown as HttpTransport, undefined);
        expect(get).toHaveBeenCalledWith('/sync/pull', { params: undefined });
    });

    it('F11: the money doors read the stored answer; /me/context only before the first pull; a paused farm opens none', () => {
        const meSaysYes = { role: 'SecondaryOwner', authorities: [{ name: 'SeeMoney', expiresAtUtc: null }] };
        const stored = { receivedAtUtc: AT, scopes: [scope(FARM_A, { seeMoney: false }), scope(FARM_B, { status: 'Paused', seeMoney: false })] };
        expect(seeMoneyDoor(stored, FARM_A, meSaysYes)).toBe(false);
        expect(seeMoneyDoor(stored, FARM_B, meSaysYes)).toBe(false);
        expect(seeMoneyDoor(null, FARM_A, meSaysYes)).toBe(true);
        expect(seeMoneyDoor({ receivedAtUtc: AT, scopes: [scope(FARM_A)] }, FARM_A, { role: 'Mukadam', authorities: [] })).toBe(true);
        expect(seeMoneyDoor(stored, null, null)).toBe(false);
        expect(seeMoneyDoor(null, null, null)).toBeUndefined();
    });

    it('F5: a move answer\'s money is not stored for a farm whose money is not his', async () => {
        const db = getDatabase();
        await db.appMeta.put({
            key: ACCESS_SCOPES_META_KEY,
            value: { receivedAtUtc: AT, scopes: [scope(FARM_A, { seeMoney: false }), scope(FARM_B)] },
            updatedAt: AT,
        });
        const written = await takeMovedMoney({ moneyMoved: [{ id: 'm1', farmId: FARM_A, amount: 777 }, { id: 'm2', farmId: FARM_B, amount: 5 }] });
        expect(written).toBe(1);
        expect(await db.costEntries.get('m1')).toBeUndefined();
        expect(await db.costEntries.get('m2')).toBeDefined();
    });

    it('F10: a wage withheld by rule is said to be withheld — never "not stated", never ₹0', () => {
        const [withheld] = mapLabourEngagements([crew({ wageWithheld: true, totalCostWithheld: true })]);
        expect(withheld.wageWithheld).toBe(true);
        expect(withheld.totalCostWithheld).toBe(true);
        expect(withheld.wagePerPerson).toBeUndefined();
        const [silent] = mapLabourEngagements([crew()]);
        expect(silent.wageWithheld).toBeUndefined();

        const shown = partEntriesOf(log({ labour: [withheld] }), 'mr').map(e => e.value).join(' | ');
        expect(shown).toContain('नियमानुसार दिसत नाही');
        expect(shown).not.toMatch(/₹\s*0|तुम्हाला/);
        const en = partEntriesOf(log({ labour: [withheld] }), 'en').map(e => e.value).join(' | ');
        expect(en).toContain('Not shown by rule');
        expect(partEntriesOf(log({ labour: [silent] }), 'mr').map(e => e.value).join(' | ')).not.toContain('नियमानुसार');
    });

    it('F3: a record that mentions money shows the rule card in place of its words — never an empty transcript', () => {
        const rec = recordingOf([log({ wordsWithheldForMoney: true, cropActivities: [{ id: 'c1', title: 'छाटणी' }] as never })], DEPS);
        expect(rec.wordsWithheld).toBe(true);
        expect(rec.entries.length).toBeGreaterThan(0);
        expect(recordingOf([log({ fullTranscript: 'छाटणी केली' })], DEPS).wordsWithheld).toBe(false);

        render(<MoneyWordsWithheldCard />);
        const card = screen.getByTestId('money-words-withheld').textContent ?? '';
        expect(card).toBe('श्रमसफलच्या नियमानुसार पैशांचा उल्लेख असलेल्या नोंदीचे शब्द व आवाज इथे दिसत नाहीत. कामाची माहिती खाली आहे.');
        expect(card).not.toMatch(/तुम्हाला|मालक|AI/);
    });

    it('F3: the voice of such a record answers with the same rule card', async () => {
        render(<OriginalVoiceButton dailyLogId="log-1" farmId={FARM_A} fetchVoice={() => Promise.resolve({ kind: 'moneyWithheld' })} />);
        fireEvent.click(screen.getByTestId('ov-play-log-1'));
        await waitFor(() => expect(screen.getByTestId('ov-money-withheld-log-1')).toBeTruthy());
        expect(screen.getByTestId('ov-money-withheld-log-1').textContent).toContain('श्रमसफलच्या नियमानुसार');
    });

    it('F7: a job card\'s held-back pay reads the rule, never ₹0', () => {
        expect(jobCardAmountText('INR', null, 'mr')).toBe('नियमानुसार दिसत नाही');
        expect(jobCardAmountText('INR', null, 'en')).toBe('Not shown by rule');
        expect(jobCardAmountText('INR', 1200.4, 'mr')).toBe('INR 1,200');
        expect(jobCardAmountText('INR', 0, 'mr')).toBe('INR 0');
    });

    it('item 16: the three lines are the founder\'s, one language at a time, none "to you"', () => {
        const mr = ruleWithheldCopy('mr');
        const en = ruleWithheldCopy('en');
        expect([mr.recordWords, mr.moneyAccounts, mr.amount].join(' ')).not.toMatch(/[A-Za-z]|तुम्हाला|दाखवला जात नाही/);
        expect([en.recordWords, en.moneyAccounts, en.amount].join(' ')).not.toMatch(/[ऀ-ॿ]|to you|owner/i);
        expect(mr.amount).toBe('नियमानुसार दिसत नाही');
        expect(en.moneyAccounts).toBe("By ShramSafal's rules, the money accounts are not shown here.");
    });
});
