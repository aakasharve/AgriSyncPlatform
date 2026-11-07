// @vitest-environment node
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2: N2)
//
// The server answers 403 ShramSafal.OriginalVoiceNotKept when the playback switch is OFF (founder D-2: OFF stops replay, never deletes).
// The API client turns exactly that into a recognisable error; a 404 is still "not found" (null); any other failure is rethrown unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../api/AgriSyncClient', () => ({ agriSyncClient: { http: { get: (...a: unknown[]) => get(...a) } } }));

import { getVoiceDiaryById } from '../voiceDiaryApiClient';
import { ORIGINAL_VOICE_NOT_KEPT_CODE, ORIGINAL_VOICE_NOT_KEPT_ERROR } from '../originalVoiceNotKept';

const GUID = '651c5b30-eb70-5078-91ed-9530793a0373';
const failure = (status: number, error?: string) => Object.assign(new Error('http'), { response: { status, data: { error } } });

describe('getVoiceDiaryById - the playback switch is OFF', () => {
    beforeEach(() => { get.mockReset(); });

    it('403 OriginalVoiceNotKept becomes the recognisable error', async () => {
        get.mockImplementation(async () => { throw failure(403, ORIGINAL_VOICE_NOT_KEPT_CODE); });
        await expect(getVoiceDiaryById(GUID)).rejects.toThrow(ORIGINAL_VOICE_NOT_KEPT_ERROR);
    });

    it('a 403 with another code is rethrown as it was', async () => {
        const other = failure(403, 'ShramSafal.Forbidden');
        get.mockImplementation(async () => { throw other; });
        await expect(getVoiceDiaryById(GUID)).rejects.toBe(other);
    });

    it('404 is still null', async () => {
        get.mockImplementation(async () => { throw failure(404); });
        await expect(getVoiceDiaryById(GUID)).resolves.toBeNull();
    });
});
