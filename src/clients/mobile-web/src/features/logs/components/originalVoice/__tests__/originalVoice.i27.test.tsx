// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — "मूळ आवाज ऐका" (founder D-31 / D-40 / D-44).
 *
 * The control only asks the server and tells the truth:
 *   - a sealed recording comes back -> it is OPENED on this phone with the farm's key, bound to the clip and the
 *     farm's owner account (the same seal the speaker's phone made) and played; played to the END = heard;
 *   - nothing he may play -> "मूळ आवाज उपलब्ध नाही." (D-31), the control goes away;
 *   - not on the server yet (review S5) -> a temporary line and the button stays for a retry;
 *   - could not reach / open it -> a retry line, never "there is no recording" (D-40);
 *   - one language at a time.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { httpGet, resolveDek, lang } = vi.hoisted(() => ({
    httpGet: vi.fn(), resolveDek: vi.fn(), lang: { value: 'mr' as 'mr' | 'en' },
}));
vi.mock('../../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...a: unknown[]) => httpGet(...a) }, getMeContext: vi.fn(async () => ({ farms: [] })) },
}));
vi.mock('../../../../../infrastructure/security/tenantDekClient', () => ({
    resolveDek: (...a: unknown[]) => resolveDek(...a),
}));
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
}));

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { sealVoiceClip } from '../../../../../infrastructure/security/voiceEnvelope';
import { fetchLogOriginalVoice, originalVoicePath } from '../../../../../infrastructure/voice/logOriginalVoice';
import { OriginalVoiceButton } from '../OriginalVoiceButton';

const FARM = 'f0f0f0f0-0000-4000-8000-000000000001';
const OWNER_ACCOUNT = 'acac0000-0000-4000-8000-000000000001';
const LOG = 'b0b0b0b0-0000-4000-8000-000000000001';
const CLIP = 'c1c1c1c1-0000-4000-8000-000000000001';
const DEK = new Uint8Array(32).fill(7);
const AUDIO = new Uint8Array([10, 20, 30, 40, 50]);

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** What the server sends for a recording the speaker's phone sealed under this farm's owner account. */
async function sealedResponse(binding = { clipId: CLIP, ownerAccountId: OWNER_ACCOUNT }) {
    const sealed = await sealVoiceClip(AUDIO, DEK, 'dek-1', binding);
    const body = sealed.ciphertext.slice(0, sealed.ciphertext.byteLength - 16);
    const tag = sealed.ciphertext.slice(sealed.ciphertext.byteLength - 16);
    return {
        data: {
            available: true, reason: null, clipId: CLIP.toUpperCase(), dekId: 'dek-1',
            ivBase64: toB64(sealed.iv), authTagBase64: toB64(tag), cipherBase64: toB64(body),
        },
    };
}

beforeEach(async () => {
    httpGet.mockReset();
    resolveDek.mockReset().mockResolvedValue(DEK);
    lang.value = 'mr';
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerAccountId: OWNER_ACCOUNT }, updatedAt: 'T' } as never);
});
afterEach(() => cleanup());

describe('fetchLogOriginalVoice — the server decides, this phone opens', () => {
    it('opens the sealed recording with the farm\'s key, bound to the clip and the farm\'s owner account', async () => {
        httpGet.mockResolvedValue(await sealedResponse());
        const outcome = await fetchLogOriginalVoice(LOG, FARM);
        expect(httpGet).toHaveBeenCalledWith(originalVoicePath(LOG));
        expect(resolveDek).toHaveBeenCalledWith('dek-1', FARM);
        expect(outcome.kind).toBe('audio');
        const bytes = new Uint8Array(await (outcome as { blob: Blob }).blob.arrayBuffer());
        expect([...bytes]).toEqual([...AUDIO]);
    });

    it('a recording sealed for ANOTHER owner account does not open here (failed, never played)', async () => {
        httpGet.mockResolvedValue(await sealedResponse({ clipId: CLIP, ownerAccountId: 'acac0000-0000-4000-8000-000000000999' }));
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('failed');
    });

    it('the server says nothing he may play -> unavailable; it refuses him (403/404) -> unavailable too', async () => {
        httpGet.mockResolvedValueOnce({ data: { available: false, reason: 'not_kept' } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('unavailable');
        httpGet.mockRejectedValueOnce({ response: { status: 403 } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('unavailable');
    });

    it('review S5: "not on the server" is PENDING (may still arrive), never "unavailable"; "not kept" stays unavailable', async () => {
        httpGet.mockResolvedValueOnce({ data: { available: false, reason: 'not_on_server' } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('pending');
        httpGet.mockResolvedValueOnce({ data: { available: false, reason: 'not_kept' } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('unavailable');
        httpGet.mockResolvedValueOnce({ data: { available: false, reason: 'no_recording' } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('unavailable');
        httpGet.mockRejectedValueOnce({ response: { status: 404 } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('unavailable');
    });

    it('no answer, an unreadable answer or no key -> failed (retry), never "no recording"', async () => {
        httpGet.mockRejectedValueOnce(new Error('offline'));
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('failed');
        httpGet.mockResolvedValueOnce({ data: { nope: true } });
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('failed');
        httpGet.mockResolvedValueOnce(await sealedResponse());
        resolveDek.mockResolvedValueOnce(null);
        expect((await fetchLogOriginalVoice(LOG, FARM)).kind).toBe('failed');
    });
});

interface FakeAudio { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null }

describe('OriginalVoiceButton — what the reviewer sees', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:voice'), revokeObjectURL: vi.fn() }));
    });

    it('plays the recording; played to the END tells the review he heard it', async () => {
        let audio: FakeAudio | null = null;
        const onHeard = vi.fn();
        render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} onHeard={onHeard}
            fetchVoice={async () => ({ kind: 'audio', blob: new Blob([AUDIO]) })}
            createAudio={() => { audio = { play: vi.fn(async () => undefined), pause: vi.fn(), onended: null }; return audio as unknown as HTMLAudioElement; }} />);
        expect(screen.getByTestId(`ov-play-${LOG}`).textContent).toContain('मूळ आवाज ऐका');

        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        await waitFor(() => expect(screen.getByTestId(`ov-play-${LOG}`).getAttribute('data-state')).toBe('playing'));
        expect(screen.getByTestId(`ov-play-${LOG}`).textContent).toContain('थांबवा');
        expect(onHeard).not.toHaveBeenCalled(); // playing is not yet hearing

        act(() => { audio!.onended?.(); });
        expect(onHeard).toHaveBeenCalledWith(LOG);
        expect(screen.getByTestId(`ov-play-${LOG}`).getAttribute('data-state')).toBe('idle');
    });

    it('nothing he may play: "मूळ आवाज उपलब्ध नाही." and no control left behind (P5)', async () => {
        render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} fetchVoice={async () => ({ kind: 'unavailable' })} />);
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        expect(screen.getByTestId(`ov-unavailable-${LOG}`).textContent).toBe('मूळ आवाज उपलब्ध नाही.');
        expect(screen.queryByTestId(`ov-play-${LOG}`)).toBeNull();
    });

    it('could not fetch it this time: says so, keeps the button for a retry, and the retry can play', async () => {
        const fetchVoice = vi.fn()
            .mockResolvedValueOnce({ kind: 'failed' })
            .mockResolvedValueOnce({ kind: 'audio', blob: new Blob([AUDIO]) });
        render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} fetchVoice={fetchVoice}
            createAudio={() => ({ play: vi.fn(async () => undefined), pause: vi.fn(), onended: null }) as unknown as HTMLAudioElement} />);
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        expect(screen.getByTestId(`ov-failed-${LOG}`).textContent).toBe('आत्ता ऐकता आलं नाही — पुन्हा दाबा');
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        await waitFor(() => expect(screen.getByTestId(`ov-play-${LOG}`).getAttribute('data-state')).toBe('playing'));
        expect(fetchVoice).toHaveBeenCalledTimes(2);
    });

    it('review S5: not on the server yet -> a temporary line (not "उपलब्ध नाही"), the button stays, the retry can play', async () => {
        const fetchVoice = vi.fn()
            .mockResolvedValueOnce({ kind: 'pending' })
            .mockResolvedValueOnce({ kind: 'audio', blob: new Blob([AUDIO]) });
        render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} fetchVoice={fetchVoice}
            createAudio={() => ({ play: vi.fn(async () => undefined), pause: vi.fn(), onended: null }) as unknown as HTMLAudioElement} />);
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        expect(screen.getByTestId(`ov-pending-${LOG}`).textContent).toBe('मूळ आवाज अजून सर्व्हरवर आलेला नाही — थोड्या वेळाने पुन्हा दाबा');
        expect(screen.queryByTestId(`ov-unavailable-${LOG}`)).toBeNull();
        expect(screen.getByTestId(`ov-play-${LOG}`).textContent).toContain('मूळ आवाज ऐका');
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        await waitFor(() => expect(screen.getByTestId(`ov-play-${LOG}`).getAttribute('data-state')).toBe('playing'));
        expect(fetchVoice).toHaveBeenCalledTimes(2);
    });

    it('review S5: the "not on the server yet" line reads English only in English mode', async () => {
        lang.value = 'en';
        const { container } = render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} fetchVoice={async () => ({ kind: 'pending' })} />);
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        expect(screen.getByTestId(`ov-pending-${LOG}`).textContent).toBe('The original voice has not reached the server yet — tap again in a while');
        expect(container.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('English mode reads English only, Marathi mode Marathi only', async () => {
        lang.value = 'en';
        const { container } = render(<OriginalVoiceButton dailyLogId={LOG} farmId={FARM} fetchVoice={async () => ({ kind: 'unavailable' })} />);
        expect(container.textContent).toBe(' Play original voice');
        await act(async () => { fireEvent.click(screen.getByTestId(`ov-play-${LOG}`)); });
        expect(screen.getByTestId(`ov-unavailable-${LOG}`).textContent).toBe('Original recording unavailable.');
        expect(container.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
