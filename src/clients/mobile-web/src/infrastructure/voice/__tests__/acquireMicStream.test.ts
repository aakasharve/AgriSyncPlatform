// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves — microphone permission is requested at the
// first tap (getUserMedia), never at startup, and the grant->start sequence works
// inside that same tap.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireMicStream } from '../acquireMicStream';

const fakeStream = { id: 's' } as unknown as MediaStream;

const notAllowed = () => {
    const e = new Error('Permission denied');
    e.name = 'NotAllowedError';
    return e;
};

const installMedia = (getUserMedia: ReturnType<typeof vi.fn>, permissionState?: PermissionState | 'throws') => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });
    Object.defineProperty(globalThis.navigator, 'permissions', {
        configurable: true,
        value: permissionState === undefined
            ? undefined
            : {
                query: permissionState === 'throws'
                    ? vi.fn().mockRejectedValue(new TypeError('unsupported'))
                    : vi.fn().mockResolvedValue({ state: permissionState }),
            },
    });
};

afterEach(() => vi.restoreAllMocks());

describe('acquireMicStream', () => {
    it('first capture: not granted -> OS prompt (pending getUserMedia) -> granted -> same call yields the stream, no second tap', async () => {
        let grant!: (s: MediaStream) => void;
        const gum = vi.fn().mockImplementation(() => new Promise<MediaStream>(res => { grant = res; }));
        installMedia(gum, 'prompt');

        const pending = acquireMicStream({ audio: true });
        expect(gum).toHaveBeenCalledTimes(1); // the prompt is raised by THIS call, in the tap
        grant(fakeStream); // user taps Allow
        await expect(pending).resolves.toBe(fakeStream);
        expect(gum).toHaveBeenCalledTimes(1);
    });

    it('grant raced the rejection: first call NotAllowedError but permission now granted -> retries once and starts', async () => {
        const gum = vi.fn()
            .mockRejectedValueOnce(notAllowed())
            .mockResolvedValueOnce(fakeStream);
        installMedia(gum, 'granted');

        await expect(acquireMicStream({ audio: true })).resolves.toBe(fakeStream);
        expect(gum).toHaveBeenCalledTimes(2);
    });

    it('denial: rejects with NotAllowedError, does not loop, asks the OS once', async () => {
        const gum = vi.fn().mockRejectedValue(notAllowed());
        installMedia(gum, 'denied');

        await expect(acquireMicStream({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(gum).toHaveBeenCalledTimes(1);
    });

    it('denial where the permission state cannot be read still rejects after one call', async () => {
        const gum = vi.fn().mockRejectedValue(notAllowed());
        installMedia(gum, 'throws');
        await expect(acquireMicStream({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(gum).toHaveBeenCalledTimes(1);

        const gum2 = vi.fn().mockRejectedValue(notAllowed());
        installMedia(gum2); // no navigator.permissions at all
        await expect(acquireMicStream({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(gum2).toHaveBeenCalledTimes(1);
    });

    it('retry after denial: tapping again calls the OS again and can succeed', async () => {
        const gum = vi.fn()
            .mockRejectedValueOnce(notAllowed())
            .mockResolvedValueOnce(fakeStream);
        installMedia(gum, 'denied');

        await expect(acquireMicStream({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
        // farmer enables the mic, taps again
        installMedia(gum, 'granted');
        await expect(acquireMicStream({ audio: true })).resolves.toBe(fakeStream);
        expect(gum).toHaveBeenCalledTimes(2);
    });

    it('relaunch with the permission already granted: one silent getUserMedia, no permission query, no extra calls', async () => {
        const gum = vi.fn().mockResolvedValue(fakeStream);
        installMedia(gum, 'granted');
        const query = (navigator.permissions as unknown as { query: ReturnType<typeof vi.fn> }).query;

        await expect(acquireMicStream({ audio: true })).resolves.toBe(fakeStream);
        expect(gum).toHaveBeenCalledTimes(1);
        expect(query).not.toHaveBeenCalled();
    });

    it('does not retry non-permission failures (mic busy, no device)', async () => {
        const busy = new Error('busy');
        busy.name = 'NotReadableError';
        const gum = vi.fn().mockRejectedValue(busy);
        installMedia(gum, 'granted');
        await expect(acquireMicStream({ audio: true })).rejects.toMatchObject({ name: 'NotReadableError' });
        expect(gum).toHaveBeenCalledTimes(1);
    });
});
