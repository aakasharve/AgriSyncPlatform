// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// The separation rules, pinned. Each of these is a rule that reads as obvious and is
// broken by an ordinary, well-meant change:
//   • "just ask for all three at onboarding, it's fewer screens"
//   • "keep the clip so we can retry the parse later"
//   • "default the new purpose on, nobody will mind"
//   • "the confirm dialog is enough, we don't need to spell out consequences"

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CORE_PURPOSE_CODES,
    OPTIONAL_PURPOSE_CODES,
    isCoveredByCoreConsent,
} from '../../../../domain/consent/CoreConsentScope';
import { ConsentState } from '../../../../domain/consent/ConsentState';
import {
    ALL_OPTIONAL_PURPOSE_CODES,
    isOptionalPurposeGranted,
    servicesThatStopWithout,
} from '../optionalPurposes';
import { MANUAL_ENTRY_ALWAYS_AVAILABLE, requestDevicePermission } from '../devicePermissions';

describe('core consent is a CLOSED list', () => {
    it('covers exactly the six purposes the notice names, and nothing else', () => {
        expect([...CORE_PURPOSE_CODES]).toEqual([
            'ACCOUNT_AUTHENTICATION',
            'FARM_OPERATIONS',
            'VOICE_PROCESSING_FOR_WORK_RECORD',
            'OFFLINE_SYNC',
            'SECURITY',
            'PLOT_SPECIFIC_WEATHER',
        ]);
    });

    it('covers no optional purpose — the whole point of the boundary', () => {
        for (const optional of OPTIONAL_PURPOSE_CODES) {
            expect(isCoveredByCoreConsent(optional)).toBe(false);
        }
    });

    it('treats a purpose nobody has classified as OUTSIDE core', () => {
        // A materially new purpose is not core until someone decides it is. Defaulting
        // the other way is how scope creeps without a single line of consent copy changing.
        expect(isCoveredByCoreConsent('SELL_TO_A_LENDER')).toBe(false);
    });
});

describe('optional purposes are OFF until he turns them on', () => {
    it('every optional purpose is denied against a default consent state', () => {
        const fresh = ConsentState.default();
        for (const purpose of ALL_OPTIONAL_PURPOSE_CODES) {
            expect(isOptionalPurposeGranted(purpose, fresh)).toBe(false);
        }
    });

    it('is denied when there is no consent state at all', () => {
        for (const purpose of ALL_OPTIONAL_PURPOSE_CODES) {
            expect(isOptionalPurposeGranted(purpose, null)).toBe(false);
        }
    });

    it('an unrecognised purpose is denied — new purposes are off without anyone acting', () => {
        expect(isOptionalPurposeGranted('SOME_FUTURE_IDEA', {
            ...ConsentState.default(), fullHistoryJournal: true,
        })).toBe(false);
    });

    it('a purpose with no control he can see is denied even so', () => {
        // PROMOTIONAL_MESSAGES has no server field yet. Building the feature before the
        // control is exactly how default-off silently becomes default-on.
        const everythingOn: ConsentState = {
            ...ConsentState.default(),
            fullHistoryJournal: true, crossFarmAggregation: true, researchCorpusExport: true,
        };
        expect(isOptionalPurposeGranted('PROMOTIONAL_MESSAGES', everythingOn)).toBe(false);
    });

    it('grants only the purpose whose own toggle is on', () => {
        const audioOnly: ConsentState = { ...ConsentState.default(), fullHistoryJournal: true };
        expect(isOptionalPurposeGranted('VOICE_DIARY_ORIGINAL_AUDIO_RETENTION', audioOnly)).toBe(true);
        expect(isOptionalPurposeGranted('AI_MODEL_IMPROVEMENT', audioOnly)).toBe(false);
        expect(isOptionalPurposeGranted('PARTNER_SHARING_LENDING_INSURANCE_MARKETPLACE', audioOnly)).toBe(false);
    });

    it('a core purpose asked of this function is refused, not helpfully allowed', () => {
        // Core purposes are authorised by the gate. A caller reaching here for one has
        // asked the wrong question, and answering "true" would hide that.
        expect(isOptionalPurposeGranted('FARM_OPERATIONS', ConsentState.default())).toBe(false);
    });

    it('names what stops on withdrawal, and claims nothing for a purpose it does not know', () => {
        expect(servicesThatStopWithout('VOICE_DIARY_ORIGINAL_AUDIO_RETENTION'))
            .toContain('voiceDiaryPlayback');
        // Nothing he uses stops when model-improvement is off — saying so honestly is
        // what makes the toggle a real choice rather than a hostage.
        expect(servicesThatStopWithout('AI_MODEL_IMPROVEMENT')).toEqual([]);
        expect(servicesThatStopWithout('SOME_FUTURE_IDEA')).toEqual([]);
    });
});

describe('an OS permission is asked for one at a time, when the feature is used', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('asks for the microphone alone — not the camera, not location', async () => {
        const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
        const getCurrentPosition = vi.fn();
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia },
            geolocation: { getCurrentPosition },
        });

        await requestDevicePermission('microphone');

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(getCurrentPosition).not.toHaveBeenCalled();
    });

    it('releases the device immediately — it wanted the permission, not the microphone', async () => {
        const stop = vi.fn();
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
        });

        await requestDevicePermission('microphone');

        // Leaving the track open is what previously made a later getUserMedia report a
        // false "not granted".
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('reports a refusal without throwing — a refusal is an answer, not a fault', async () => {
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
        });

        await expect(requestDevicePermission('microphone')).resolves.toBe('denied');
    });

    it('reports an absent capability as unavailable, never as denied', async () => {
        // Denied and unavailable are different facts. Reporting an insecure context as a
        // refusal blames the farmer for the browser.
        vi.stubGlobal('navigator', {});
        await expect(requestDevicePermission('camera')).resolves.toBe('unavailable');
        await expect(requestDevicePermission('location')).resolves.toBe('unavailable');
    });

    it('holds the rule that refusing the microphone never closes manual entry', () => {
        expect(MANUAL_ENTRY_ALWAYS_AVAILABLE).toBe(true);
    });
});
