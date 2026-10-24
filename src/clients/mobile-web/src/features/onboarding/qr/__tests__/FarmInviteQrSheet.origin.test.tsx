// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 * Mount test: the QR / share link must use the public web origin on native.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const native = vi.hoisted(() => ({ value: false }));
const qrSpy = vi.hoisted(() => vi.fn(async (_text: string) => 'data:image/png;base64,AAAA'));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value, getPlatform: () => (native.value ? 'android' : 'web') },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: qrSpy } }));
vi.mock('../inviteApi', () => ({
    issueFarmInvite: vi.fn(async () => ({
        token: 'tok123', farmCode: 'FARM-1', farmName: 'Test Farm', qrPayload: 'https://x/y',
    })),
    rotateFarmInvite: vi.fn(),
    isInviteApiError: () => false,
}));

import FarmInviteQrSheet from '../FarmInviteQrSheet';

describe('FarmInviteQrSheet share origin', () => {
    beforeEach(() => { qrSpy.mockClear(); });

    it('native: QR encodes the public web origin, not localhost', async () => {
        native.value = true;
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="Test Farm" />);
        await waitFor(() => expect(qrSpy).toHaveBeenCalled());
        const url = qrSpy.mock.calls[0][0];
        expect(url.startsWith('https://app.shramsafal.in/?')).toBe(true);
        expect(url).toContain('join=tok123');
        expect(url).not.toContain('localhost');
    });

    it('web: QR keeps window.location.origin', async () => {
        native.value = false;
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="Test Farm" />);
        await waitFor(() => expect(qrSpy).toHaveBeenCalled());
        const url = qrSpy.mock.calls[0][0];
        expect(url.startsWith(`${window.location.origin}/?`)).toBe(true);
    });
});
