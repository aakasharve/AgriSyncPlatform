// spec: dfes-companion-2026-07-11 (farm-memory)
// SUPERSEDED BY FOUNDER RULING D9 (2026-08-14) — REWRITTEN IN THE
// main -> feat/dfes-companion MERGE. The intent is not weakened; it is
// generalised, because the rule it was arguing for was granted in full.
//
// WHAT THIS FILE USED TO SAY, AND WHY IT NO LONGER SAYS IT.
// -----------------------------------------------------------------------
// It argued a narrow exemption from the 30-day sweep. A farmer with Farm
// Memory on records a note; the single upload attempt from `AiJobWorker`
// fails because he is standing in a field with no signal; nothing retries;
// thirty days later `purgeExpiredProcessingVoiceClips` deletes the row and
// the only copy that ever existed is gone — no server copy, no warning, no
// trace. The exemption asked for was: keep the clips the server has never
// acknowledged (`s3RetainedKey` absent), let the acknowledged ones expire,
// and leave the plain 30-day promise intact for a farmer who never asked
// for Farm Memory.
//
// D9 answered the larger question underneath it and answered it wider:
//
//   "He can actually listen to everything that was spoken on that day, by
//    whoever spoke."
//   — `docs/superpowers/specs/2026-08-14-FOUNDER-DECISIONS-launch-cohort-
//      and-scope.md`, D9 · Voice recordings are kept **forever**
//
// D9 is explicit that this is "not a retention window, a product privilege",
// that it REVERSES the earlier 30-day ruling (made believing the clips were
// encrypted; they are not), and that the working sweeper "must be switched
// off before anything else in this area". `VoiceClipRetention.ts` carries
// that out: `purgeExpiredProcessingVoiceClips` is a hard `return 0`, kept as
// an empty seam rather than deleted so its three call sites stay under
// review.
//
// WHAT THIS FILE NOW PINS.
// -----------------------------------------------------------------------
// The guarantee is stronger and simpler than the exemption that was asked
// for, so the tests are stated at full strength rather than as the special
// case that survived: NOTHING IS DELETED. Not the expired clip, not the
// acknowledged one, not the clip belonging to a farmer who never turned Farm
// Memory on. No consent is consulted, because no input can produce a
// deletion and there is therefore no question to ask the server.
//
// These are the assertions that fail if the sweeper is ever switched back on
// by accident — which is the failure mode D9 exists to prevent, and the one
// that was live and quietly destroying the feature when D9 was written.
//
// `countPendingRetainedArchives` is unaffected by D9 and its test is
// unchanged: it counts what has not yet reached the farmer's cloud, so he
// can be told, and it deletes nothing either way.
//
// 🔴 STATED HERE BECAUSE D9 STATES IT: keeping every clip forever makes the
// clips' PLAINTEXT storage worse, not neutral. `sealVoiceClip` exists with
// zero callers on the live write path. That is a real open item, not
// something these tests cover or close.

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

describe('purgeExpiredProcessingVoiceClips — voice recordings are kept forever (D9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appMeta = new Map();
        clips = [];
    });

    it('keeps an expired clip the server has never acknowledged when Farm Memory is on', async () => {
        // The original scenario this file was written for: the one upload
        // attempt failed in a field with no signal, so this row is the only
        // copy of that recording anywhere. It survives.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [clip('unsynced', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['unsynced']);
    });

    it('keeps an expired clip even once the server HAS acknowledged it', async () => {
        // SUPERSEDED: asserted `deleted === 1` before D9. A server copy is
        // no longer a licence to delete the farmer's own. D9 grants him
        // "everything that was spoken on that day" on the device he spoke
        // it into, not a round-trip away — and the S3 copy is reachable
        // only online, which is the condition he is least often in.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [clip('synced', LONG_EXPIRED, 'synced')];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['synced']);
    });

    it('keeps BOTH kinds when acknowledged and unacknowledged clips expire together', async () => {
        // SUPERSEDED: asserted that the sweep discriminates (`deleted === 1`,
        // only the acknowledged one). Under D9 there is nothing to
        // discriminate between — both are kept. Stated as a pair anyway,
        // because a half-restored sweeper that deletes only the acknowledged
        // rows would still destroy the feature and must still fail here.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [
            clip('synced', LONG_EXPIRED, 'synced'),
            clip('unsynced', LONG_EXPIRED),
        ];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['synced', 'unsynced']);
    });

    it('keeps everything for a farmer who never turned Farm Memory on either', async () => {
        // SUPERSEDED, AND THIS IS THE REVERSAL ITSELF: this asserted
        // `deleted === 2` — the plain 30-day promise for a farmer who never
        // asked for Farm Memory. D9 makes keeping the audio a product
        // privilege rather than a consented extra, so the 30-day expiry no
        // longer fires for anyone. (What consent still governs is the S3
        // retained tier, which is a different store and a different code
        // path; nothing here touches it.)
        getConsent.mockResolvedValue({ fullHistoryJournal: false });
        clips = [clip('a', LONG_EXPIRED), clip('b', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['a', 'b']);
    });

    it('leaves clips that have not expired alone regardless of consent', async () => {
        getConsent.mockResolvedValue({ fullHistoryJournal: false });
        clips = [clip('fresh', NOT_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['fresh']);
    });

    it('keeps unacknowledged clips when it cannot reach the server and has never cached an answer', async () => {
        // Offline and no cache was the ambiguous case, and ambiguity must
        // not resolve towards deletion. It is no longer ambiguous — nothing
        // resolves towards deletion — but the case is kept because the
        // offline path is where the old sweeper's worst outcome lived.
        getConsent.mockRejectedValue(new Error('offline'));
        clips = [clip('unsynced', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['unsynced']);
    });

    it('a cached "Farm Memory off" answer does NOT reinstate the 30 days', async () => {
        // SUPERSEDED: asserted `deleted === 1` — the cached answer was the
        // offline route back to the 30-day sweep. Under D9 no route to
        // deletion exists, cached or live. This is the specific case a
        // partial revert would most plausibly restore, so it is pinned.
        appMeta.set('voice_diary_farm_memory_enabled', {
            key: 'voice_diary_farm_memory_enabled',
            value: false,
            updatedAt: NOW,
        });
        getConsent.mockRejectedValue(new Error('offline'));
        clips = [clip('a', LONG_EXPIRED)];

        const deleted = await purgeExpiredProcessingVoiceClips(NOW);

        expect(deleted).toBe(0);
        expect(clips.map(c => c.id)).toEqual(['a']);
    });

    it('never asks the server about consent — no input can produce a deletion', async () => {
        // Was: "does not call the server at all when nothing expiring is
        // unacknowledged". WIDENED, not weakened. The sweep runs on app
        // boot; a consent round-trip on every cold start is a real cost on
        // a weak connection, and now it can never change the outcome for
        // ANY input, not just this one. Both an unacknowledged clip and an
        // acknowledged one are put in front of it here — the first is the
        // case that used to force the round-trip.
        getConsent.mockResolvedValue({ fullHistoryJournal: true });
        clips = [
            clip('synced', LONG_EXPIRED, 'synced'),
            clip('unsynced', LONG_EXPIRED),
        ];

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
