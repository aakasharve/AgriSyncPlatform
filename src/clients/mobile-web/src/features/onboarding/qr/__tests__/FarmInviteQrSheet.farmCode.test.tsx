// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the owner's QR sheet never shows a blank farm
 * code, and its "type this code" line is true: it names the door the joiner taps, in Marathi.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const invite = vi.hoisted(() => ({ farmCode: 'K7M2QX' as string }));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }));
vi.mock('../inviteApi', () => ({
    issueFarmInvite: vi.fn(async () => ({
        token: 'tok123', farmCode: invite.farmCode, farmName: 'पवार शेती', qrPayload: 'https://x/y',
    })),
    rotateFarmInvite: vi.fn(),
    isInviteApiError: () => false,
}));

import FarmInviteQrSheet from '../FarmInviteQrSheet';
import { JOIN_DOOR_LABEL } from '../farmCodeEntry';

afterEach(cleanup);

describe('FarmInviteQrSheet farm code', () => {
    it('shows the code and says, in Marathi, where the joiner types it', async () => {
        invite.farmCode = 'K7M2QX';
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="पवार शेती" />);

        const card = await screen.findByTestId('invite-farm-code-card');
        expect(card).toHaveTextContent('K7M2QX');
        const line = screen.getByTestId('invite-type-code-line');
        expect(line).toHaveTextContent(JOIN_DOOR_LABEL);
        expect(line.textContent).not.toMatch(/[A-Za-z]{3,}/); // no English words
        expect(document.body.textContent).not.toContain('Workers who cannot scan');
        // F5 (P11): the named button exists only in the new app — the sheet says so, in Marathi.
        const oldApp = screen.getByTestId('invite-old-app-line');
        expect(oldApp).toHaveTextContent('ॲप अपडेट');
        expect(oldApp.textContent).not.toMatch(/[A-Za-z]{3,}/);
    });

    it.each([[''], ['   ']])('never shows a blank code (server answered %j): no code box, no "type it" line', async (code) => {
        invite.farmCode = code;
        render(<FarmInviteQrSheet isOpen onClose={() => {}} farmId="f1" farmName="पवार शेती" />);

        // the sheet has loaded the invite (the QR is drawn) …
        await waitFor(() => expect(screen.getByAltText(/QR code to join/)).toBeInTheDocument());
        // … and there is nothing to type
        expect(screen.queryByTestId('invite-farm-code-card')).toBeNull();
        expect(screen.queryByTestId('invite-type-code-line')).toBeNull();
        expect(screen.queryByLabelText('Copy farm code')).toBeNull();
    });
});
