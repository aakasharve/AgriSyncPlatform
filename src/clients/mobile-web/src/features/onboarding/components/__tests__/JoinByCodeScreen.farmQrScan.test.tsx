// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1 (review L-7). The join door's scanner reads a
 * personal invitation's QR. A FARM's QR scanned there used to do nothing at all; now the person is told what to do, in
 * his language only. The camera is stubbed (jsdom has none); the scanner's own reader (`readCode`) is the real one.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: null as 'mr' | 'en' | null, scanned: '' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.lang ? { language: h.lang, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
vi.mock('../../qr/inviteApi', () => ({ joinByCode: vi.fn() }));
const mockFind = vi.fn();
vi.mock('../../../invitations/personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../../../invitations/personalInvitationClient')>()),
    findInvitation: (...a: unknown[]) => mockFind(...a),
}));
vi.mock('../../../labour/identity/CardScanner', () => ({
    platformQrDetector: () => ({}),
    CardScanner: ({ readCode, onCode }: { readCode: (raw: string) => string | null; onCode: (code: string) => void }) => (
        <button type="button" data-testid="fake-camera" onClick={() => { const code = readCode(h.scanned); if (code) onCode(code); }}>
            camera
        </button>
    ),
}));

import JoinByCodeScreen from '../JoinByCodeScreen';

const FARM_QR = 'https://shramsafal.in/join?join=tok123&farm=K7M2QP';

beforeEach(() => { h.lang = null; h.scanned = ''; mockFind.mockReset(); });
afterEach(cleanup);

describe('a farm QR at the invitation scanner', () => {
    it('says what to do, in Marathi', () => {
        h.scanned = FARM_QR;
        render(<JoinByCodeScreen isOpen onClose={vi.fn()} openJoinLink={vi.fn()} />);
        fireEvent.click(screen.getByTestId('join-scan-qr'));
        fireEvent.click(screen.getByTestId('fake-camera'));
        expect(screen.getByTestId('join-farm-qr-line'))
            .toHaveTextContent('हा शेताचा QR आहे, आमंत्रणाचा नाही. त्या शेतावर विनंती पाठवायला शेताचा कोड वर टाका.');
        expect(mockFind).not.toHaveBeenCalled();
    });

    it('says it in English only when English was chosen', () => {
        h.lang = 'en';
        h.scanned = FARM_QR;
        render(<JoinByCodeScreen isOpen onClose={vi.fn()} openJoinLink={vi.fn()} />);
        fireEvent.click(screen.getByTestId('join-scan-qr'));
        fireEvent.click(screen.getByTestId('fake-camera'));
        expect(screen.getByTestId('join-farm-qr-line'))
            .toHaveTextContent("This is a farm's QR, not an invitation. To ask to join that farm, type the farm's code above.");
    });

    it('an invitation QR still opens its card', async () => {
        h.scanned = 'https://shramsafal.in/i/48217730';
        mockFind.mockResolvedValue({
            invitationId: 'inv-1', farmName: 'पाटील फार्म', invitedByName: null, label: 'Worker', name: null, plotScope: 'OwnWork',
            plotNames: [], authorities: [], expiresAtUtc: '2026-11-13T06:00:00Z', status: 'Waiting', namesYou: true, namesAWorker: false,
        });
        render(<JoinByCodeScreen isOpen onClose={vi.fn()} openJoinLink={vi.fn()} />);
        fireEvent.click(screen.getByTestId('join-scan-qr'));
        fireEvent.click(screen.getByTestId('fake-camera'));
        expect(await screen.findByTestId('invitation-card-inv-1')).toBeInTheDocument();
        expect(mockFind).toHaveBeenCalledWith('48217730');
        expect(screen.queryByTestId('join-farm-qr-line')).toBeNull();
    });
});
