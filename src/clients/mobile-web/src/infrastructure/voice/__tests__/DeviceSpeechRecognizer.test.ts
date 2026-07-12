// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const isNativePlatform = vi.fn();
const available = vi.fn();
const requestPermissions = vi.fn();
const start = vi.fn();

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));
vi.mock('@capacitor-community/speech-recognition', () => ({
    SpeechRecognition: { available: () => available(), requestPermissions: () => requestPermissions(), start: (o: unknown) => start(o) },
}));

import { DeviceSpeechRecognizer } from '../DeviceSpeechRecognizer';

describe('DeviceSpeechRecognizer', () => {
    beforeEach(() => {
        isNativePlatform.mockReset(); available.mockReset();
        requestPermissions.mockReset(); start.mockReset();
    });

    it('returns unavailable error on web (no native platform)', async () => {
        isNativePlatform.mockReturnValue(false);
        const r = await new DeviceSpeechRecognizer().transcribe({ language: 'mr-IN' });
        expect('error' in r && r.error).toBe('unavailable');
        expect(start).not.toHaveBeenCalled();
    });

    it('returns the first match transcript on native success', async () => {
        isNativePlatform.mockReturnValue(true);
        available.mockResolvedValue({ available: true });
        requestPermissions.mockResolvedValue({ speechRecognition: 'granted' });
        start.mockResolvedValue({ matches: ['काल पाणी दिले', 'kaal pani dile'] });
        const r = await new DeviceSpeechRecognizer().transcribe({ language: 'mr-IN' });
        expect('transcript' in r && r.transcript).toBe('काल पाणी दिले');
        expect(start).toHaveBeenCalledWith(
            expect.objectContaining({ language: 'mr-IN', partialResults: false, popup: false }),
        );
    });

    it('returns unavailable when the engine reports not-available', async () => {
        isNativePlatform.mockReturnValue(true);
        available.mockResolvedValue({ available: false });
        const r = await new DeviceSpeechRecognizer().transcribe({ language: 'mr-IN' });
        expect('error' in r && r.error).toBe('unavailable');
    });

    it('maps permission denial to a distinct error', async () => {
        isNativePlatform.mockReturnValue(true);
        available.mockResolvedValue({ available: true });
        requestPermissions.mockResolvedValue({ speechRecognition: 'denied' });
        const r = await new DeviceSpeechRecognizer().transcribe({ language: 'mr-IN' });
        expect('error' in r && r.error).toBe('permission-denied');
    });
});
