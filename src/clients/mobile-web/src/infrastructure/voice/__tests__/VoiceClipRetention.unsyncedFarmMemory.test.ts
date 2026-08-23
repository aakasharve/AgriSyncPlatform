// spec: dfes-companion-2026-07-11 (farm-memory) — founder ruling 2026-08-23
//
// The local 30-day sweep must not be the thing that destroys a farmer's
// Farm Memory.
//
// The failure it is guarding against is quiet and total. A farmer with
// retention switched on records a note. The upload runs once, from
// AiJobWorker, and fails because he is in a field with no signal. Nothing
// retries. Thirty days later `purgeExpiredProcessingVoiceClips` deletes
// the row, and the only copy of that recording that ever existed is gone
// — no server copy, no warning, no trace. Doctrine P10 says work the
// system has acknowledged must be reconstructable without the originating
// device; nothing here was ever acknowledged, so the phone was never
// entitled to let go of it.
//
// `s3RetainedKey` is the acknowledgement. These tests pin the rule that
// follows from it: acknowledged clips expire, unacknowledged Farm Memory
// does not, and a farmer who never asked for Farm Memory keeps the plain
// 30-day behaviour he was promised.

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeClip {
    id: string;
    expiresAtUtc: string;
    recordedAtUtc: string;
    status: string;
    s3RetainedKey?: string;
}

let clips: FakeClip[] = [];
let appMeta = new Map<string, { key: string; value: unknown; updatedAt: string }>();

const getConsent = vi.fn();

vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: {
        get getConsent() { return getConsent; },
    },
}));

vi.mock('../../voiceDiary/voiceDiaryApiClient', () => ({
    persistRetainedVoiceClip: vi.fn(),
}));

vi.mock('../../security/voiceEnvelope', () => ({
    sealVoiceClip: vi.fn(),
    openVoiceClip: vi.fn(),
}));

vi.mock('../../security/tenantDekClient', () => ({
    getCurrentTenantDek: vi.fn(),
    resolveDek: vi.fn(),
}));

// A small Dexie stand-in covering exactly the surface the sweep touches.
vi.mock('../../storage/DexieDatabase', () => ({
    getDatabase: () => ({
        voiceClips: {
            where: (field: string) => ({
                belowOrEqual: (value: string) => ({
                    toArray: async () =>
                        clips.filter(c => (c as unknown as Record<string, string>)[field] <= value),
                }),
            }),
            bulkDelete: async (ids: string[]) => {
                clips = clips.filter(c => !ids.includes(c.id));
            },
            filter: (predicate: (c: FakeClip) => boolean) => ({
                count: async () => clips.filter(predicate).length,
                sortBy: async (key: string) =>
                    clips
                        .filter(predicate)
                        .slice()
                        .sort((a, b) =>
                            String((a as unknown as Record<string, string>)[key])
                                .localeCompare(String((b as unknown as Record<string, string>)[key]))),
            }),
        },
        appMeta: {
            get: async (key: string) => appMeta.get(key),
            put: async (entry: { key: string; value: unknown; updatedAt: string }) => {
                appMeta.set(entry.key, entry);
            },
        },
    }),
}));

import {
    purgeExpiredProcessingVoiceClips,
    countPendingRetainedArchives,
} from '../VoiceClipRetention';

const NOW = '2026-08-23T00:00:00.000Z';
const LONG_EXPIRED = '2026-07-01T00:00:00.000Z';
const NOT_EXPIRED = '2026-09-30T00:00:00.000Z';

function clip(id: string, expiresAtUtc: string, s3RetainedKey?: string): FakeClip {
    return {
        id,
        expiresAtUtc,
        recordedAtUtc: '2026-06-01T00:00:00.000Z',
        status: 'parsed',
        s3RetainedKey,
    };
}

describe('purgeExpiredProcessingVoiceClips — unsynchronised Farm Memory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appMeta = new Map();
        clips = [];
    });

    it('keeps an expired clip the server has never acknowledged when Farm Memory is on', async () => {
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [clip('unsynced', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['unsynced']);
    });

    it('deletes an expired clip once the server has acknowledged it', async () => {
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [clip('synced', LONG_EXPIRED, 'synced')];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(1);
        expect(clips).toHaveLength(0);
    });

    it('deletes only the acknowledged one when both kinds have expired together', async () => {
        // The whole point of the rule is that it discriminates. A sweep
        // that kept everything would pass the first test and be just as
        // wrong as one that deleted everything.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [
            clip('synced', LONG_EXPIRED, 'synced'),
            clip('unsynced', LONG_EXPIRED),
        ];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(1);
        expect(clips.map(c => c.id)).toEqual(['unsynced']);
    });

    it('still expires everything at 30 days for a farmer who has not turned Farm Memory on', async () => {
        // "30 days only" is exactly what this farmer was told, and the
        // fix must not quietly turn his phone into an archive.
        getConsent.mockResolvedValue({ fullHistoryJournal: false });
        clips = [clip('a', LONG_EXPIRED), clip('b', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(2);
        expect(clips).toHaveLength(0);
    });

    it('leaves clips that have not expired alone regardless of consent', async () => {
        getConsent.mockResolvedValue({ fullHistoryJournal: false });
        clips = [clip('fresh', NOT_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['fresh']);
    });

    it('keeps unacknowledged clips when it cannot reach the server and has never cached an answer', async () => {
        // Offline and no cache is the ambiguous case, and ambiguity must
        // not resolve towards deletion.
        getConsent.mockRejectedValue(new Error('offline'));
        clips = [clip('unsynced', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['unsynced']);
    });

    it('uses the cached answer when offline, so a non-retaining farmer still gets his 30 days', async () => {
        appMeta.set('voice_diary_farm_memory_enabled', {
            key: 'voice_diary_farm_memory_enabled',
            value: false,
            updatedAt: NOW,
        });
        getConsent.mockRejectedValue(new Error('offline'));
        clips = [clip('a', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(1);
    });

    it('does not call the server at all when nothing expiring is unacknowledged', async () => {
        // The sweep runs on app boot. Paying for a consent round-trip on
        // every cold start, to answer a question that cannot change the
        // outcome, would be a real cost on a weak connection.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [clip('synced', LONG_EXPIRED, 'synced')];

        await purgeExpiredProcessingVoiceClips(NOW);

        expect(getConsent).not.toHaveBeenCalled();
    });

    it('counts what is still waiting so the farmer can be told', async () => {
        clips = [
            clip('synced', NOT_EXPIRED, 'synced'),
            clip('waiting-1', NOT_EXPIRED),
            clip('waiting-2', LONG_EXPIRED),
        ];

        await expect(countPendingRetainedArchives()).resolves.toBe(2);
    });
});
