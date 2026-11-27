// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; drawing V2-A card 1; CTO ruling Q6 = A) - "शेताची ओळख" on the hub:
 *   - the open farm's name and code (tap to copy: "कोड कॉपी केला"); no code from the server, no code box (never an invented one);
 *   - the join QR is drawn ONLY for the main owner; a co-owner, a मुकादम and a कामगार see none and the phone never asks for it;
 *   - the QR answer is kept per farm, so it draws with no network after the first time; with nothing kept and no network the card says
 *     "इंटरनेट आल्यावर QR दिसेल" (never a blank square);
 *   - tapping the QR opens the sheet; tapping the farm's name opens the farm's page.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const rows = vi.hoisted(() => new Map<string, unknown>());
const net = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        uiPrefs: {
            get: async (key: string) => (rows.has(key) ? { key, value: rows.get(key) } : undefined),
            put: async (row: { key: string; value: unknown }) => { rows.set(row.key, row.value); },
        },
    }),
}));
vi.mock('../../../infrastructure/storage/activeDatabaseName', () => ({ onActiveDatabaseChanged: () => () => { /* none */ } }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async (url: string) => `data:image/png;base64,${btoa(url).slice(0, 12)}`) } }));
vi.mock('../../onboarding/qr/inviteApi', () => ({ issueFarmInvite: (farmId: string) => net.issue(farmId) }));

import { FarmIdentityCard, farmJoinQrKey } from '../FarmIdentityCard';

const INVITE = { invitationId: 'i', joinTokenId: 'j', farmId: 'F1', farmName: 'आरवे फार्म', farmCode: 'GT4702', token: 'tok', issuedAtUtc: '', qrPayload: 'https://x' };

const mount = (over: Partial<React.ComponentProps<typeof FarmIdentityCard>> = {}) => {
    const props = { farmId: 'F1', farmName: 'आरवे फार्म', farmCode: 'GT4702', isPrimaryOwner: true, language: 'mr' as const,
        onOpenFarmPage: vi.fn(), onOpenQrSheet: vi.fn(), ...over };
    render(<FarmIdentityCard {...props} />);
    return props;
};

beforeEach(() => { rows.clear(); net.issue.mockReset(); });
afterEach(cleanup);

describe('शेताची ओळख card', () => {
    it('the farm\'s name and code; tapping the code says "कोड कॉपी केला"', async () => {
        const user = userEvent.setup();
        net.issue.mockResolvedValue(INVITE);
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        mount();
        expect(screen.getByTestId('hub-farm-name')).toHaveTextContent('आरवे फार्म');
        expect(screen.getByTestId('hub-farm-code')).toHaveTextContent('शेताचा ओळख क्रमांक');
        expect(screen.getByTestId('hub-farm-code')).toHaveTextContent('GT4702');
        await user.click(screen.getByTestId('hub-farm-code'));
        expect(writeText).toHaveBeenCalledWith('GT4702');
        expect(screen.getByTestId('hub-farm-code-copied')).toHaveTextContent('कोड कॉपी केला');
    });

    it('no code from the server: no code box', () => {
        net.issue.mockResolvedValue(INVITE);
        mount({ farmCode: null });
        expect(screen.queryByTestId('hub-farm-code')).toBeNull();
    });

    it('the main owner sees the QR on the card; tapping it opens the sheet; the name opens the farm page', async () => {
        const user = userEvent.setup();
        net.issue.mockResolvedValue(INVITE);
        const props = mount();
        await user.click(await screen.findByTestId('hub-farm-qr-open'));
        expect(props.onOpenQrSheet).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('hub-farm-qr')).toHaveTextContent('कामाला येणाऱ्यांना ही QR दाखवा');
        await user.click(screen.getByTestId('hub-farm-card-open'));
        expect(props.onOpenFarmPage).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(rows.get(farmJoinQrKey('F1'))).toMatchObject({ token: 'tok' }));
    });

    it('anyone but the main owner: no QR, and the phone never asks for one (the server would refuse)', async () => {
        net.issue.mockResolvedValue(INVITE);
        mount({ isPrimaryOwner: false });
        await new Promise(r => setTimeout(r, 30));
        expect(screen.queryByTestId('hub-farm-qr')).toBeNull();
        expect(net.issue).not.toHaveBeenCalled();
    });

    it('no network, a QR kept from before: it still draws', async () => {
        rows.set(farmJoinQrKey('F1'), INVITE);
        net.issue.mockRejectedValue(new TypeError('Failed to fetch'));
        mount();
        expect(await screen.findByTestId('hub-farm-qr-open')).toBeInTheDocument();
    });

    it('no network and nothing kept: "इंटरनेट आल्यावर QR दिसेल", never a blank square', async () => {
        net.issue.mockRejectedValue(new TypeError('Failed to fetch'));
        mount();
        expect(await screen.findByTestId('hub-farm-qr-offline')).toHaveTextContent('इंटरनेट आल्यावर QR दिसेल');
    });

    it('another farm\'s kept QR is never drawn for this farm', async () => {
        rows.set(farmJoinQrKey('F2'), { ...INVITE, farmId: 'F1' });
        rows.set(farmJoinQrKey('F1'), { ...INVITE, farmId: 'F9' });
        net.issue.mockRejectedValue(new TypeError('Failed to fetch'));
        mount();
        expect(await screen.findByTestId('hub-farm-qr-offline')).toBeInTheDocument();
    });

    it('English mode: English only', async () => {
        net.issue.mockResolvedValue(INVITE);
        mount({ language: 'en', farmName: 'Arve Farm' });
        await screen.findByTestId('hub-farm-qr-open');
        expect(screen.getByTestId('hub-farm-card').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
