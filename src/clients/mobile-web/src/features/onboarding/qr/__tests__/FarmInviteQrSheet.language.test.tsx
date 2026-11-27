// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - the owner's farm-QR sheet speaks ONE language: Marathi mode has no
 * English word ("Share", "Copy link", "Generate new QR", "Invite to farm" were English only), English mode no Marathi word. The farm's own name and
 * code are data, not words.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }));
vi.mock('../inviteApi', () => ({
    issueFarmInvite: vi.fn(async () => ({ token: 'tok123', farmCode: 'K7M2QX', farmName: 'Pawar Farm', qrPayload: 'https://x/y' })),
    rotateFarmInvite: vi.fn(async () => { throw new Error('down'); }),
    isInviteApiError: () => false,
}));

import FarmInviteQrSheet from '../FarmInviteQrSheet';

afterEach(() => { cleanup(); lang.value = 'mr'; });

const visibleText = () => {
    const parts = [document.body.textContent ?? ''];
    document.querySelectorAll('[aria-label],[alt]').forEach(el => parts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('alt') ?? ''));
    return parts.join(' ').replace(/Pawar Farm|K7M2QX|QR|OTP/g, ' ');
};

describe('FarmInviteQrSheet — one language at a time', () => {
    it('Marathi mode: Marathi only (पाठवा, लिंक कॉपी करा, नवीन QR बनवा, then the confirm line)', async () => {
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="Pawar Farm" />);
        await screen.findByTestId('invite-qr-image');
        expect(screen.getByTestId('invite-share')).toHaveTextContent('पाठवा');
        expect(screen.getByTestId('invite-copy-link')).toHaveTextContent('लिंक कॉपी करा');
        expect(screen.getByTestId('invite-rotate')).toHaveTextContent('नवीन QR बनवा');
        expect(visibleText()).not.toMatch(/[A-Za-z]{3,}/);
        fireEvent.click(screen.getByTestId('invite-rotate'));
        expect(screen.getByTestId('invite-rotate')).toHaveTextContent('पुन्हा दाबा — जुना QR बंद होईल');
        fireEvent.click(screen.getByTestId('invite-rotate'));
        expect(await screen.findByTestId('invite-problem')).toHaveTextContent('नवीन QR बनवता आला नाही. पुन्हा प्रयत्न करा.');
        expect(visibleText()).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('English mode: English only, and the footer no longer promises "That\'s it" (a scan asks to join)', async () => {
        lang.value = 'en';
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="Pawar Farm" />);
        await screen.findByTestId('invite-qr-image');
        expect(screen.getByTestId('invite-share')).toHaveTextContent('Share');
        expect(visibleText()).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId('invite-footer').textContent).not.toContain("That's it");
    });
});
