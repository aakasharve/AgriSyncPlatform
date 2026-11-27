// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — what he scanned or typed BEFORE the SMS
 * code is sent by the join door ONCE, right after sign-in, exactly as if he had just typed or scanned it here:
 *   - a farm code asks to join (a request; the owner picks the role) and the farm's name comes from the SERVER;
 *   - an invitation opens its card (the owner's role, plots and rights; स्वीकारा / नको);
 *   - the owner's farm QR is claimed (a request) - and a dead QR says so plainly, in his language.
 * Only the network calls are stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: null as 'mr' | 'en' | null }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.lang ? { language: h.lang, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
const mockJoinByCode = vi.fn();
const mockClaim = vi.fn();
vi.mock('../../qr/inviteApi', () => ({
    joinByCode: (...a: unknown[]) => mockJoinByCode(...a),
    claimFarmJoin: (...a: unknown[]) => mockClaim(...a),
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));
const mockFind = vi.fn();
vi.mock('../../../invitations/personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../../../invitations/personalInvitationClient')>()),
    findInvitation: (...a: unknown[]) => mockFind(...a),
}));

import JoinByCodeScreen, { JOIN_BY_CODE_COPY as C } from '../JoinByCodeScreen';
import type { HeldJoin } from '../../joinStart/heldJoin';

const FARM = 'पवार यांची शेती';

function mount(held: HeldJoin) {
    const onJoined = vi.fn();
    const view = render(<JoinByCodeScreen isOpen onClose={vi.fn()} onJoined={onJoined} openJoinLink={vi.fn()} held={held} />);
    return { ...view, onJoined };
}

beforeEach(() => {
    h.lang = null;
    mockJoinByCode.mockReset();
    mockJoinByCode.mockResolvedValue({ kind: 'joined', farm: { farmId: 'f-2', farmName: FARM, status: 'PendingApproval' } });
    mockClaim.mockReset();
    mockFind.mockReset();
});
afterEach(cleanup);

describe('a held farm code', () => {
    it('is sent once when the door opens; the request waits for the owner, with the farm\'s name the server sent', async () => {
        const { onJoined, rerender } = mount({ kind: 'farmCode', code: 'K7M2QX' });
        await waitFor(() => expect(screen.getByTestId('join-done-title')).toHaveTextContent(C.sentTitle));
        expect(mockJoinByCode).toHaveBeenCalledTimes(1);
        expect(mockJoinByCode).toHaveBeenCalledWith('K7M2QX');
        expect(screen.getByTestId('join-done-farm')).toHaveTextContent(FARM);
        expect(screen.getByTestId('join-done-line')).toHaveTextContent(C.sentLine);
        expect(onJoined).toHaveBeenCalledWith({ farmId: 'f-2', farmName: FARM, status: 'PendingApproval' });

        // A re-render with the same held join never sends it again.
        rerender(<JoinByCodeScreen isOpen onClose={vi.fn()} onJoined={onJoined} openJoinLink={vi.fn()} held={{ kind: 'farmCode', code: 'K7M2QX' }} />);
        expect(mockJoinByCode).toHaveBeenCalledTimes(1);
    });

    it('a code the server does not know is said once, in the door, and he can type another', async () => {
        mockJoinByCode.mockResolvedValue({ kind: 'code_unknown' });
        mount({ kind: 'farmCode', code: 'K7M2QX' });
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent(C.unknown);
        expect(screen.getByTestId('join-code-input')).toHaveValue('K7M2QX');
        expect(screen.getByTestId('join-code-input')).toBeEnabled();
    });
});

describe('a held invitation', () => {
    it('opens its card from the server (the owner\'s role); nothing is accepted until he taps', async () => {
        mockFind.mockResolvedValue({
            invitationId: 'inv-1', farmName: 'पाटील फार्म', invitedByName: null, label: 'Mukadam', name: null, plotScope: 'OwnWork',
            plotNames: [], authorities: [], expiresAtUtc: '2099-01-01T06:00:00Z', status: 'Waiting', namesYou: true, namesAWorker: false,
        });
        mount({ kind: 'invitation', code: '48217730' });
        await waitFor(() => expect(mockFind).toHaveBeenCalledWith('48217730'));
        expect(await screen.findByTestId('join-invitation')).toBeInTheDocument();
        expect(screen.getByTestId('invitation-accept')).toBeInTheDocument();
        expect(mockJoinByCode).not.toHaveBeenCalled();
    });
});

describe('a held farm QR', () => {
    it('is claimed once: a request that waits for the owner', async () => {
        mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'f-3', farmName: FARM, role: 'Worker', wasAlreadyMember: false, status: 'PendingApproval' });
        const { onJoined } = mount({ kind: 'qr', token: 'tok-1', farmCode: 'FRM002' });
        await waitFor(() => expect(screen.getByTestId('join-done-title')).toHaveTextContent(C.sentTitle));
        expect(mockClaim).toHaveBeenCalledTimes(1);
        expect(mockClaim).toHaveBeenCalledWith('tok-1', 'FRM002');
        expect(onJoined).toHaveBeenCalledWith({ farmId: 'f-3', farmName: FARM, status: 'PendingApproval' });
    });

    it('his own farm\'s QR (the founder testing as himself) answers "already on this farm"', async () => {
        mockClaim.mockResolvedValue({ membershipId: 'm-0', farmId: 'f-own', farmName: FARM, role: 'PrimaryOwner', wasAlreadyMember: true, status: 'Active' });
        mount({ kind: 'qr', token: 'tok-own', farmCode: 'OWN001' });
        await waitFor(() => expect(screen.getByTestId('join-done-title')).toHaveTextContent(C.activeTitle));
    });

    it('a dead QR says so plainly in Marathi, and nothing else happens', async () => {
        mockClaim.mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid. Ask the farmer for a new one.', status: 404 });
        mount({ kind: 'qr', token: 'tok-dead', farmCode: 'FRM002' });
        const line = await screen.findByTestId('join-code-problem');
        expect(line).toHaveTextContent('हा QR चालत नाही. तुमच्या मालकाला नवीन QR मागा.');
        expect(line.textContent).not.toMatch(/[A-Za-z]{4,}/);
    });

    it('in English mode the dead-QR line is English only', async () => {
        h.lang = 'en';
        mockClaim.mockRejectedValue({ error: 'join.farm_code_mismatch', message: 'x', status: 409 });
        mount({ kind: 'qr', token: 'tok-dead', farmCode: 'FRM002' });
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent('This QR does not work. Ask your farm owner for a new QR.');
    });
});
