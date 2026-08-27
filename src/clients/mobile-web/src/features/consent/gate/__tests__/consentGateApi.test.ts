// spec: dfes-companion-2026-07-11 (wave-4.2)
//
// The gate's only network call. What is pinned here is the FAILURE behaviour, because
// that is the half a well-meaning "be resilient offline" change would delete: a consent
// write that did not land must throw, so the screen keeps the farmer on the gate. Letting
// him through on a swallowed error means the app holds his data with no record of the
// basis for holding it.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { recordConsentGateAcceptance } from '../consentGateApi';
import { canonicalNoticeText, NOTICE_VERSION, PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../consentNotice';
import { CORE_DATA_CATEGORY_CODES, CORE_PURPOSE_CODES } from '../../../../domain/consent/CoreConsentScope';

const acceptance = {
    displayedLanguage: 'mr' as const,
    noticeVersion: NOTICE_VERSION,
    termsVersion: TERMS_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    purposeCodes: CORE_PURPOSE_CODES,
    dataCategoryCodes: CORE_DATA_CATEGORY_CODES,
    canonicalNotice: canonicalNoticeText('mr'),
    ageDeclaredAdult: true as const,
};

afterEach(() => vi.unstubAllGlobals());

describe('recordConsentGateAcceptance', () => {
    it('sends the exact displayed notice, the codes and the age declaration', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const ids = await recordConsentGateAcceptance(acceptance, 'preauth-xyz');

        expect(ids).toEqual({ termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        // The NOTICE TEXT, not a hash — the server hashes it, because a digest the client
        // both computes and asserts proves only that the client agrees with itself.
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(body.displayedLanguage).toBe('mr');
        expect(body.acceptedPurposeCodes).toEqual([...CORE_PURPOSE_CODES]);
        expect(body.dataCategoryCodes).toEqual([...CORE_DATA_CATEGORY_CODES]);
        expect(body.ageDeclaredAdult).toBe(true);
        expect(body.preRegistrationSessionId).toBe('preauth-xyz');
        expect(['app', 'web']).toContain(body.source);
    });

    it('throws when the server refuses — never a silent pass', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

        await expect(recordConsentGateAcceptance(acceptance, 'preauth-xyz')).rejects.toThrow();
    });

    it('throws when only one of the two records comes back', async () => {
        // A response naming one record is a half-written acceptance: the contract landed
        // and the consent did not, or the reverse. Neither is a pass.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ termsAcceptanceEventId: 't-1' }),
        }));

        await expect(recordConsentGateAcceptance(acceptance, 'preauth-xyz')).rejects.toThrow(/incomplete/);
    });
});
