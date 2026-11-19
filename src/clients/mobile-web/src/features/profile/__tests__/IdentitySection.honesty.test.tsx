// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane HONESTY-2 (H4), the identity page tells the truth.
 *
 * Nothing in the app reviews an identity, so the page may not say one is "being checked", "not started" or "rejected",
 * and it may not offer a button that does nothing (Start Verification / View Submitted Details / Fix & Resubmit /
 * पडताळलेली ओळख पहा) or promise a document it has no way to take (सातबारा, ओळखपत्र). The "सत्यापित" tick belongs
 * to the number this account signed in with and nothing else. What works (name, village, phone, role, weather,
 * boundary, log out) stays.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => (k === 'profile.verified' ? 'सत्यापित' : k) }),
}));
vi.mock('../../admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../people/components/MembershipsList', () => ({ default: () => null }));

import IdentitySection, { phoneIsVerifiedSignIn, type SignedInPhone } from '../sections/IdentitySection';
import { FarmerProfile, VerificationStatus } from '../../../types';

afterEach(cleanup);

const PHONE = '9876543210';

function mount(opts: { status?: VerificationStatus; phone?: string; signedInPhone?: SignedInPhone | null } = {}) {
    const profile = {
        name: 'रमेश पाटील', village: 'नाशिक', phone: opts.phone ?? PHONE,
        verificationStatus: opts.status ?? VerificationStatus.Unverified,
        operators: [],
    } as unknown as FarmerProfile;
    return render(
        <IdentitySection
            profile={profile}
            onUpdateProfile={vi.fn()}
            logout={vi.fn()}
            myFarm={{ farmId: 'f-1', name: 'Farm', role: 'PrimaryOwner', subscription: null }}
            myMemberships={[]}
            farmDetails={null}
            weatherConnected={false}
            connectingWeather={false}
            connectError={null}
            handleConnectWeather={vi.fn()}
            setShowFarmBoundary={vi.fn()}
            nonExitableFarmIds={new Set()}
            handleExitMembership={vi.fn(async () => undefined)}
            isWorkerOnAnyFarm={false}
            workerProfile={null}
            signedInPhone={opts.signedInPhone}
        />,
    );
}

const DEAD_WORDS = [
    'Verification Not Started', 'Start verification', 'Start Verification', 'Verification Rejected',
    'View Submitted Details', 'Fix & Resubmit', 'Please fix issues', 'Under review',
    'ओळख तपासली जात आहे', 'पडताळणी पूर्ण झाल्यावर', 'पडताळलेली ओळख पहा',
    'सातबारा', 'अजून जोडलेले नाही', 'ओळखपत्र', 'जोडायचे बाकी',
];

describe('H4 — the identity page states nothing it cannot back', () => {
    it.each([
        ['Unverified (every real user)', VerificationStatus.Unverified],
        ['PhoneVerified (the demo user)', VerificationStatus.PhoneVerified],
    ])('%s: no review banner, no dead button, no document tile', (_label, status) => {
        mount({ status });
        for (const word of DEAD_WORDS) expect(document.body.textContent, word).not.toContain(word);
        expect(screen.queryByTestId('identity-verified-banner')).toBeNull();
        expect(document.body.textContent).not.toContain('✓ ओळख पडताळलेली');
    });

    it('every button left on the page does something (log out, draw the boundary) — no verification button', () => {
        mount();
        const names = screen.getAllByRole('button').map(b => b.textContent?.trim());
        expect(names.some(n => /Log Out/.test(n ?? ''))).toBe(true);
        expect(names.some(n => /Draw Farm Boundary/.test(n ?? ''))).toBe(true);
        expect(names.some(n => /Verification|Resubmit|Submitted|पडताळलेली ओळख/.test(n ?? ''))).toBe(false);
    });

    it('a government-verified identity is still announced, with no "view" button under it', () => {
        mount({ status: VerificationStatus.GovernmentVerified });
        expect(screen.getByTestId('identity-verified-banner')).toHaveTextContent('✓ ओळख पडताळलेली');
        expect(document.body.textContent).not.toContain('पडताळलेली ओळख पहा');
    });

    it('what works stays: name, village, phone and the plain fields', () => {
        mount();
        expect(screen.getAllByText('रमेश पाटील').length).toBeGreaterThan(0);
        expect(screen.getAllByText('नाशिक').length).toBeGreaterThan(0);
        expect(screen.getAllByText(PHONE).length).toBeGreaterThan(0);
        expect(document.body.textContent).toContain('पूर्ण नाव');
        expect(document.body.textContent).toContain('मोबाईल नंबर');
        expect(document.body.textContent).toContain('गाव / तालुका / जिल्हा');
    });
});

describe('H4 — "सत्यापित" belongs to the number the account signed in with', () => {
    it('the signed-in number, proven by a code: the tick shows', () => {
        mount({ signedInPhone: { masked: '******3210', verified: true } });
        expect(screen.getByTestId('identity-phone-verified')).toHaveTextContent('सत्यापित');
    });

    it('another typed number: no tick', () => {
        mount({ phone: '9123456789', signedInPhone: { masked: '******3210', verified: true } });
        expect(screen.queryByTestId('identity-phone-verified')).toBeNull();
    });

    it('the account number was never proven by a code: no tick', () => {
        mount({ signedInPhone: { masked: '******3210', verified: false } });
        expect(screen.queryByTestId('identity-phone-verified')).toBeNull();
    });

    it('the page was not told the account number: no tick (it used to show for any non-empty phone)', () => {
        mount();
        expect(screen.queryByTestId('identity-phone-verified')).toBeNull();
    });

    it('no phone at all: a dash, no tick', () => {
        mount({ phone: '', signedInPhone: { masked: '******3210', verified: true } });
        expect(screen.queryByTestId('identity-phone-verified')).toBeNull();
    });
});

describe('H4 — phoneIsVerifiedSignIn', () => {
    const ok: SignedInPhone = { masked: '******3210', verified: true };

    it('matches every digit the mask shows, ignoring spaces, +91 and a leading 0', () => {
        expect(phoneIsVerifiedSignIn('9876543210', ok)).toBe(true);
        expect(phoneIsVerifiedSignIn('98765 43210', ok)).toBe(true);
        expect(phoneIsVerifiedSignIn('+91 98765 43210', ok)).toBe(true);
        expect(phoneIsVerifiedSignIn('09876543210', ok)).toBe(true);
    });

    it('a server mask that carries the country code still matches the national number', () => {
        expect(phoneIsVerifiedSignIn('9876543210', { masked: '+********3210', verified: true })).toBe(true);
    });

    it('a different number, a different length, or a different last four does not', () => {
        expect(phoneIsVerifiedSignIn('9876543211', ok)).toBe(false);
        expect(phoneIsVerifiedSignIn('987654321', ok)).toBe(false);
        expect(phoneIsVerifiedSignIn('3210', ok)).toBe(false);
    });

    it('needs both a typed number and a code-proven account number', () => {
        expect(phoneIsVerifiedSignIn('', ok)).toBe(false);
        expect(phoneIsVerifiedSignIn(undefined, ok)).toBe(false);
        expect(phoneIsVerifiedSignIn('9876543210', null)).toBe(false);
        expect(phoneIsVerifiedSignIn('9876543210', { masked: '******3210', verified: false })).toBe(false);
        expect(phoneIsVerifiedSignIn('9876543210', { masked: '', verified: true })).toBe(false);
    });
});
