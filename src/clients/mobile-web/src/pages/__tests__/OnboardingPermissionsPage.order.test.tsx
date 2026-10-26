// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-6, FR-8, LANG-2). फोनच्या परवानग्या:
 *   - the microphone FIRST ("सगळ्यात महत्त्वाचं"), then location (weather), then camera (bills / QR);
 *   - Marathi only — no "(Location)" beside "स्थान";
 *   - it NEVER fires an OS prompt: not on render, not on a tap on a row, not on "continue" — the real
 *     rule is ask-at-the-moment-of-use (features/consent/separation/devicePermissions.ts);
 *   - a row says only what the OS reports (read, never requested); no fake "Storage ✓" row; a
 *     permission the phone REFUSED says to turn it on in the phone's settings (round-1 F5);
 *   - NO "← मागे" on this step: a deviation from FR-8 reported to the founder (round-1 F1) — the step
 *     before it already happened on the server (see the page's header).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
    setPref: vi.fn(),
    read: vi.fn(),
    request: vi.fn(),
}));
vi.mock('../../shared/hooks/useUiPref', () => ({ useUiPref: () => [false, h.setPref, true] as const }));
vi.mock('../onboarding/DawnScene', () => ({ default: () => null }));
vi.mock('../../features/consent/separation/devicePermissions', () => ({
    readDevicePermission: (k: string) => h.read(k),
    requestDevicePermission: (k: string) => h.request(k),
}));

import OnboardingPermissionsPage from '../OnboardingPermissionsPage';

const getUserMedia = vi.fn();
const getCurrentPosition = vi.fn();
const watchPosition = vi.fn();

beforeEach(() => {
    h.setPref.mockReset();
    h.request.mockReset();
    h.read.mockReset().mockImplementation(async (k: string) => (k === 'microphone' ? 'granted' : 'prompt'));
    getUserMedia.mockReset();
    getCurrentPosition.mockReset();
    watchPosition.mockReset();
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition, watchPosition } });
});
afterEach(cleanup);

const noPromptFired = () => {
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
};

describe('फोनच्या परवानग्या', () => {
    it('microphone first, then location for the weather, then camera for bills / QR — Marathi only', () => {
        render(<OnboardingPermissionsPage onComplete={vi.fn()} />);
        const page = screen.getByTestId('first-run-permissions');
        expect(within(page).getByRole('heading')).toHaveTextContent('फोनच्या परवानग्या');
        const rows = within(page).getAllByRole('listitem');
        expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['permission-row-microphone', 'permission-row-location', 'permission-row-camera']);
        expect(rows[0]).toHaveTextContent('मायक्रोफोन');
        expect(rows[0]).toHaveTextContent('सगळ्यात महत्त्वाचं');
        expect(rows[1]).toHaveTextContent('स्थान');
        expect(rows[1]).toHaveTextContent('हवामान');
        expect(rows[2]).toHaveTextContent('कॅमेरा');
        expect(rows[2]).toHaveTextContent('बिल');
        expect(page.textContent).not.toMatch(/\(Location\)|\(Microphone\)|\(Camera\)|Storage|साठवण/);
        const visible = (page.cloneNode(true) as HTMLElement);
        visible.querySelectorAll('style').forEach(s => s.remove());
        expect((visible.textContent ?? '').replace(/QR/g, '')).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('a row says what the OS reports — read only — and is not a button', async () => {
        render(<OnboardingPermissionsPage onComplete={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('permission-state-microphone')).toHaveTextContent('दिली'));
        expect(screen.getByTestId('permission-state-location')).toHaveTextContent('वापरताना विचारू');
        expect(h.read).toHaveBeenCalledWith('microphone');
        for (const id of ['microphone', 'location', 'camera']) {
            expect(within(screen.getByTestId(`permission-row-${id}`)).queryByRole('button')).toBeNull();
        }
    });

    it('fires NO OS prompt: not on render, not on a tap on a row, not on continue', async () => {
        const onComplete = vi.fn();
        render(<OnboardingPermissionsPage onComplete={onComplete} />);
        await waitFor(() => expect(h.read).toHaveBeenCalledTimes(3));
        noPromptFired();
        for (const id of ['microphone', 'location', 'camera']) fireEvent.click(screen.getByTestId(`permission-row-${id}`));
        noPromptFired();
        fireEvent.click(screen.getByTestId('permissions-continue'));
        noPromptFired();
        expect(h.setPref).toHaveBeenCalledWith(true);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('a permission the phone has REFUSED says to turn it on in settings — never "we will ask when used"', async () => {
        h.read.mockImplementation(async (k: string) => (k === 'microphone' ? 'denied' : k === 'camera' ? 'unavailable' : 'prompt'));
        render(<OnboardingPermissionsPage onComplete={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('permission-state-microphone')).toHaveAttribute('data-state', 'denied'));
        expect(screen.getByTestId('permission-state-microphone')).toHaveTextContent('फोनच्या सेटिंगमधून चालू करा');
        expect(screen.getByTestId('permission-state-microphone')).not.toHaveTextContent('वापरताना विचारू');
        // Not yet asked (prompt) and "the OS would not say" (unavailable) are both asked at first use.
        expect(screen.getByTestId('permission-state-location')).toHaveTextContent('वापरताना विचारू');
        expect(screen.getByTestId('permission-state-camera')).toHaveTextContent('वापरताना विचारू');
        // Typing stays open without the microphone (MANUAL_ENTRY_ALWAYS_AVAILABLE).
        expect(screen.getByTestId('permissions-type-instead')).toHaveTextContent('हाताने लिहून');
        noPromptFired();
    });

    it('has NO "← मागे" (the farm is already made or joined on the server) — only the one way on', () => {
        render(<OnboardingPermissionsPage onComplete={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'मागे' })).toBeNull();
        expect(screen.getAllByRole('button')).toEqual([screen.getByTestId('permissions-continue')]);
    });
});
