// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — what leaves the phone, checked against the CANONICAL
 * sync-contract schemas (the same ones the queue enforces):
 *   - the voice auto-save names the recording's server id on the log that carries his words, and on no other;
 *   - the owner's confirmation says how he reviewed it (heard / read) and which version he saw;
 *   - every key is additive: absent when not known (P11), and a dispute carries none of it;
 *   - the labour read-out's confirm authority, record version and recording flag are read only when really sent.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...a: unknown[]) => mockGet(...a) } },
}));

import { withVoiceClipOnPrimary } from '../../../../app/helpers/autoSavedVoiceLog';
import { useVoiceAutoSave } from '../../../../app/hooks/useVoiceAutoSave';
import type { AutoSaveOptions } from '../../../../app/hooks/useLogCommands.types';
import { verifyLog } from '../../../../application/usecases/VerifyLog';
import { VerifyLogCommand } from '../../../../application/usecases/sync/VerifyLogCommand';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { fetchLabourData, type LabourDataDto } from '../../../labour/data/labourClient';
import { archiveIdForRecording } from '../../../../infrastructure/voice/clipLogLink';
import { setAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import type { AgriLogResponse, DailyLog, FarmerProfile } from '../../../../types';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const LOG = 'b0b0b0b0-0000-4000-8000-000000000001';
const LOCAL_CLIP = 'ab'.repeat(32); // the phone keys a clip by its 64-hex capture key

const v2Rows = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.VerifyLogV2);

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.voiceClips.clear()]);
    mockGet.mockReset();
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});

describe('the recording on the create (D-31)', () => {
    it('stamps the recording only on the log that carries his words', () => {
        const logs = [{ id: 'other' }, { id: 'words', fullTranscript: 'पाणी दिलं' }] as unknown as DailyLog[];
        const out = withVoiceClipOnPrimary(logs, 'c1c1c1c1-0000-4000-8000-000000000001');
        expect(out.find(l => l.id === 'words')?.voiceClipId).toBe('c1c1c1c1-0000-4000-8000-000000000001');
        expect(out.find(l => l.id === 'other')?.voiceClipId).toBeUndefined();
        expect(withVoiceClipOnPrimary(logs, undefined)).toBe(logs);
    });

    it('the recording\'s server id is the archive id of the clip on this phone, and the canonical schema takes it', async () => {
        await getDatabase().voiceClips.put({ id: LOCAL_CLIP, recordedAtUtc: '2026-10-30T05:00:00.000Z' } as never);
        const archiveId = await archiveIdForRecording({ clipId: LOCAL_CLIP, recordedAtUtc: '2026-10-30T05:00:00.000Z' });
        expect(archiveId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(await archiveIdForRecording({ clipId: 'not-on-this-phone', recordedAtUtc: 'never' })).toBeUndefined();
        expect(validatePayload(SyncMutationName.CreateDailyLog, {
            dailyLogId: LOG, farmId: ME, logDate: '2026-10-30', voiceClipId: archiveId,
        })).toEqual({ ok: true });
    });

    it('the auto-save hands the save the recording\'s server id; a recording not on this phone sends none', async () => {
        const parse = { cropActivities: [], irrigation: [{ id: 'i' }], labour: [], inputs: [], machinery: [],
            activityExpenses: [], observations: [], plannedTasks: [], dayOutcome: 'WORK_RECORDED' } as unknown as AgriLogResponse;
        for (const [archive, expected] of [['c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001'], [undefined, undefined]] as const) {
            const save = vi.fn(async (_d: AgriLogResponse, _p: unknown, o?: AutoSaveOptions) => {
                await o?.onWritten?.([{ id: LOG } as DailyLog]);
                return [{ id: LOG } as DailyLog];
            });
            const { result } = renderHook(() => useVoiceAutoSave({
                handleAutoSave: save, logIntent: null, setStatus: vi.fn(),
                linkClip: vi.fn(async () => null), archiveIdOf: vi.fn(async () => archive),
            }));
            await act(async () => { await result.current.sink(parse, undefined, { clipId: `k-${archive}`, recordedAtUtc: `t-${archive}` }); });
            const options = save.mock.calls[0][2] as AutoSaveOptions;
            expect(options.autoSavedFromVoice).toBe(true);
            expect(options.voiceClipId).toBe(expected);
            expect('voiceClipId' in options).toBe(expected !== undefined);
        }
    });
});

describe('the owner\'s confirmation on the wire (D-44 / D-46)', () => {
    const audit = { append: vi.fn(async () => undefined) };
    const profile = {} as FarmerProfile;

    it('मंजूर / save-and-confirm carries how he reviewed it and the version, and the canonical schema takes it', async () => {
        await verifyLog({ logId: LOG, verifierId: ME, action: 'approve', reviewBasis: 'heard', logVersion: 2 }, {} as never, audit as never, profile);
        await VerifyLogCommand.enqueueOwnerConfirmation(LOG, { verifierUserId: ME, reviewBasis: 'read', logVersion: 4 });
        await VerifyLogCommand.enqueueOwnerConfirmation(LOG, { verifierUserId: ME, reviewBasis: 'read' });
        const rows = await v2Rows();
        expect(rows.map(r => r.payload)).toEqual([
            expect.objectContaining({ logId: LOG, decision: 'verify', reviewBasis: 'heard', logVersion: 2 }),
            expect.objectContaining({ logId: LOG, decision: 'verify', reviewBasis: 'read', logVersion: 4 }),
            expect.objectContaining({ logId: LOG, decision: 'verify', reviewBasis: 'read' }),
        ]);
        expect('logVersion' in (rows[2].payload as object)).toBe(false); // not known = not sent
        for (const r of rows) expect(validatePayload(SyncMutationName.VerifyLogV2, r.payload)).toEqual({ ok: true });
    });

    it('a dispute carries none of the confirmation evidence', async () => {
        await verifyLog({ logId: LOG, verifierId: ME, action: 'dispute', note: 'शंका', reviewBasis: 'heard', logVersion: 2 }, {} as never, audit as never, profile);
        const [row] = await v2Rows();
        expect(row.payload).toMatchObject({ decision: 'dispute' });
        expect('reviewBasis' in (row.payload as object) || 'logVersion' in (row.payload as object)).toBe(false);
    });

    it('the canonical schema refuses a basis that is neither word and a version below 1', () => {
        const base = { logId: LOG, verifierUserId: ME, decision: 'verify', decidedAt: '2026-10-30T05:00:00.000Z' };
        expect(validatePayload(SyncMutationName.VerifyLogV2, { ...base, reviewBasis: 'listened' }).ok).toBe(false);
        expect(validatePayload(SyncMutationName.VerifyLogV2, { ...base, logVersion: 0 }).ok).toBe(false);
    });
});

describe('the labour read-out (I27 fields are additive)', () => {
    const dto = (over: Partial<LabourDataDto> = {}, review: Record<string, unknown>[] = []): LabourDataDto => ({
        topLevelIds: [], people: [],
        dashboard: { weekLabel: '', insight: '', manDays: null, manDaysTrend: 0, wages: 0, advances: 0, owed: null, logs: 0, pending: 0, plots: [], money: { recorded: null, paid: 0, advance: 0, owed: null } },
        ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
        review: review as never, attendance: { plot: '', headcount: 0, rows: [] }, view: 'owner',
        home: { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
        ...over,
    } as LabourDataDto);
    const card = (over: Record<string, unknown>) => ({
        id: LOG, who: 'रमेश', initial: 'र', tone: 'or', detail: '2026-10-30', status: 'Draft',
        points: { count: null, shift: null, task: null, amount: null, names: [] }, plot: null, plotScope: 'Plot', ...over,
    });

    it('reads canConfirm, the version and the recording flag only when the server really sent them', async () => {
        mockGet.mockResolvedValueOnce({ data: dto({ canConfirm: true }, [card({ version: 3, hasRecording: true })]) });
        const fresh = await fetchLabourData('farm-1');
        expect(fresh.canConfirm).toBe(true);
        expect(fresh.review[0]).toMatchObject({ version: 3, hasRecording: true });

        mockGet.mockResolvedValueOnce({ data: dto({}, [card({})]) }); // an older server
        const old = await fetchLabourData('farm-1');
        expect(old.canConfirm).toBeUndefined();
        expect('version' in old.review[0] || 'hasRecording' in old.review[0]).toBe(false);
    });
});
