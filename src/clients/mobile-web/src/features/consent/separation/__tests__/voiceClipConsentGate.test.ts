// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// "NEVER STORE A VOICE CLIP BEFORE CORE CONSENT", proved at the STORE — the one place a
// clip becomes durable on the device — rather than at a screen. The callers that matter
// here run without a screen: the drain worker, the offline retry, the background
// re-interpretation.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiPrefs = { get: vi.fn() };
const pendingInterpretations = { put: vi.fn().mockResolvedValue(undefined) };

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ uiPrefs, pendingInterpretations }),
}));

import { PendingInterpretationStore } from '../../../voice/continuity/PendingInterpretationStore';
import { CoreConsentMissingError, hasCoreConsent, ACCEPTED_NOTICE_PREF_KEY } from '../coreConsentGate';
import { NOTICE_VERSION } from '../../gate/consentNotice';
import type { PendingInterpretationRecord } from '../../../voice/continuity/pendingInterpretation';

const audioCapture = (): PendingInterpretationRecord => ({
    captureId: 'cap-1',
    farmId: 'farm-1',
    createdAtUtc: 0,
    status: 'pending',
    ladderLevel: 'audio-only',
    transcript: null,
    audioBase64: 'BASE64AUDIO',
    audioMimeType: 'audio/webm',
    logScopeJson: '{}',
    recordedAtUtc: '2026-08-16T06:00:00.000Z',
    attempts: 0,
    lastAttemptAtUtc: null,
});

const transcriptCapture = (): PendingInterpretationRecord => ({
    ...audioCapture(),
    captureId: 'cap-2',
    ladderLevel: 'transcript-only',
    transcript: 'आज फवारणी केली',
    audioBase64: null,
    audioMimeType: null,
});

beforeEach(() => {
    uiPrefs.get.mockReset();
    pendingInterpretations.put.mockClear();
});

describe('hasCoreConsent', () => {
    it('is true only for an acceptance of the CURRENT notice', async () => {
        uiPrefs.get.mockResolvedValue({ key: ACCEPTED_NOTICE_PREF_KEY, value: NOTICE_VERSION });
        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('is false for an acceptance of an older notice', async () => {
        uiPrefs.get.mockResolvedValue({ value: 'notice-2020-01-01.1' });
        await expect(hasCoreConsent()).resolves.toBe(false);
    });

    it('fails CLOSED when there is no row, and when the read throws', async () => {
        uiPrefs.get.mockResolvedValue(undefined);
        await expect(hasCoreConsent()).resolves.toBe(false);

        uiPrefs.get.mockRejectedValue(new Error('IndexedDB is gone'));
        // "We could not tell" and "he has not consented" deliberately get the same answer:
        // a false negative costs a clip, a false positive costs a lawful basis.
        await expect(hasCoreConsent()).resolves.toBe(false);
    });
});

describe('PendingInterpretationStore.persist', () => {
    it('refuses to store audio before core consent, and writes NOTHING', async () => {
        uiPrefs.get.mockResolvedValue(undefined);

        await expect(PendingInterpretationStore.getInstance().persist(audioCapture()))
            .rejects.toBeInstanceOf(CoreConsentMissingError);

        expect(pendingInterpretations.put).not.toHaveBeenCalled();
    });

    it('stores audio once core consent is recorded', async () => {
        uiPrefs.get.mockResolvedValue({ value: NOTICE_VERSION });

        await PendingInterpretationStore.getInstance().persist(audioCapture());

        expect(pendingInterpretations.put).toHaveBeenCalledTimes(1);
    });

    it('never blocks a transcript-only capture — those are his words, not his voice', async () => {
        // Core consent covers the processing needed to create his work record. Gating the
        // transcript on the audio rule would silently lose an offline day's log.
        uiPrefs.get.mockResolvedValue(undefined);

        await PendingInterpretationStore.getInstance().persist(transcriptCapture());

        expect(pendingInterpretations.put).toHaveBeenCalledTimes(1);
    });
});
