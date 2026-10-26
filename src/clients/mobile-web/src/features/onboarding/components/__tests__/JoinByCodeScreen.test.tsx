// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the typed-code door.
 *   - a typed code is cleaned up (case, spaces, dashes, look-alikes) and a complete one goes BY ITSELF;
 *   - success says plainly the OWNER will choose the role and approve;
 *   - a wrong code gets one plain line and no farm name; 429 gets "थोड्या वेळाने पुन्हा प्रयत्न करा";
 *   - a pasted QR link goes to the QR landing page; nothing on the screen is English.
 * Only the network call is stubbed (`inviteApi.joinByCode`).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const mockJoinByCode = vi.fn();
vi.mock('../../qr/inviteApi', () => ({
    joinByCode: (...a: unknown[]) => mockJoinByCode(...a),
}));

import JoinByCodeScreen, { JOIN_BY_CODE_COPY as C } from '../JoinByCodeScreen';

const FARM = 'पवार यांची शेती';

function mount(extra: Partial<React.ComponentProps<typeof JoinByCodeScreen>> = {}) {
    const onClose = vi.fn();
    const onJoined = vi.fn();
    const openJoinLink = vi.fn();
    const view = render(<JoinByCodeScreen isOpen onClose={onClose} onJoined={onJoined} openJoinLink={openJoinLink} {...extra} />);
    return { ...view, onClose, onJoined, openJoinLink };
}

const type = (value: string) => fireEvent.change(screen.getByTestId('join-code-input'), { target: { value } });

beforeEach(() => {
    mockJoinByCode.mockReset();
    mockJoinByCode.mockResolvedValue({ kind: 'joined', farm: { farmId: 'f-2', farmName: FARM, status: 'PendingApproval' } });
});
afterEach(cleanup);

describe('typing the code', () => {
    it('cleans up the code and sends a complete one by itself — no button to press', async () => {
        mount();
        expect(screen.queryByRole('button', { name: /पुढे/ })).toBeNull();
        type(' k7 m-2qo ');
        await waitFor(() => expect(mockJoinByCode).toHaveBeenCalledTimes(1));
        expect(mockJoinByCode).toHaveBeenCalledWith('K7M2Q0');
    });

    it('sends nothing while the code is still short', () => {
        mount();
        type('K7M2');
        expect(mockJoinByCode).not.toHaveBeenCalled();
        expect(screen.queryByTestId('join-code-problem')).toBeNull();
    });

    it('a code longer than any farm code is told at once, without asking the server', () => {
        mount();
        type('K7M2QXZ');
        expect(screen.getByTestId('join-code-problem')).toHaveTextContent(C.unknown);
        expect(mockJoinByCode).not.toHaveBeenCalled();
    });

    it('says it is checking while the server answers, and one code is sent once', async () => {
        let resolve!: (v: unknown) => void;
        mockJoinByCode.mockImplementation(() => new Promise((r) => { resolve = r; }));
        mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-code-checking')).toHaveTextContent(C.checking);
        expect(screen.getByTestId('join-code-input')).toBeDisabled();
        type('K7M2QX');
        expect(mockJoinByCode).toHaveBeenCalledTimes(1);
        await act(async () => { resolve({ kind: 'code_unknown' }); });
    });
});

describe('the server answers', () => {
    it('PendingApproval: the farm name and, plainly, that the OWNER chooses the role and approves', async () => {
        const { onJoined, onClose } = mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-done')).toBeInTheDocument();
        expect(screen.getByTestId('join-done-title')).toHaveTextContent(C.sentTitle);
        expect(screen.getByTestId('join-done-farm')).toHaveTextContent(FARM);
        expect(screen.getByTestId('join-done-line')).toHaveTextContent('मालक तुमची भूमिका ठरवतील आणि मंजूर करतील — तोपर्यंत वाट पाहा');
        expect(onJoined).toHaveBeenCalledWith({ farmId: 'f-2', farmName: FARM, status: 'PendingApproval' });
        // no role is claimed for him
        expect(document.body.textContent).not.toMatch(/कामगार|मुकादम|सहमालक/);

        fireEvent.click(screen.getByTestId('join-done-ok'));
        expect(onClose).toHaveBeenCalled();
    });

    it('an existing seat is told as it is: already in, or work paused', async () => {
        mockJoinByCode.mockResolvedValueOnce({ kind: 'joined', farm: { farmId: 'f-2', farmName: FARM, status: 'Active' } });
        mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-done-title')).toHaveTextContent(C.activeTitle);
        cleanup();

        mockJoinByCode.mockResolvedValueOnce({ kind: 'joined', farm: { farmId: 'f-2', farmName: FARM, status: 'Suspended' } });
        mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-done-title')).toHaveTextContent(C.pausedTitle);
        expect(screen.getByTestId('join-done-line')).toHaveTextContent(C.pausedLine);
    });

    it('a wrong code: one plain line, no farm name, no success — and the same code is not asked again', async () => {
        mockJoinByCode.mockResolvedValue({ kind: 'code_unknown' });
        const { onJoined } = mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent('हा कोड सापडला नाही. मालकाला पुन्हा विचारा.');
        expect(screen.queryByTestId('join-done')).toBeNull();
        expect(screen.queryByTestId('join-done-farm')).toBeNull();
        expect(document.body.textContent).not.toContain(FARM);
        expect(onJoined).not.toHaveBeenCalled();

        type('K7M2Q');
        type('K7M2QX');
        expect(screen.getByTestId('join-code-problem')).toHaveTextContent(C.unknown);
        expect(mockJoinByCode).toHaveBeenCalledTimes(1);

        type('K7M2QY'); // a different code is asked
        await waitFor(() => expect(mockJoinByCode).toHaveBeenCalledTimes(2));
    });

    it('429: "थोड्या वेळाने पुन्हा प्रयत्न करा", and पुन्हा पाठवा sends the same code again', async () => {
        mockJoinByCode.mockResolvedValueOnce({ kind: 'rate_limited' });
        mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent('थोड्या वेळाने पुन्हा प्रयत्न करा');

        fireEvent.click(screen.getByTestId('join-code-retry'));
        expect(await screen.findByTestId('join-done')).toBeInTheDocument();
        expect(mockJoinByCode).toHaveBeenCalledTimes(2);
        expect(mockJoinByCode.mock.calls[1][0]).toBe('K7M2QX');
    });

    it('no network: an honest failure with a retry, never a success', async () => {
        mockJoinByCode.mockResolvedValueOnce({ kind: 'failed', status: 0 });
        mount();
        type('K7M2QX');
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent(C.failed);
        expect(screen.getByTestId('join-code-retry')).toBeInTheDocument();
        expect(screen.queryByTestId('join-done')).toBeNull();
    });

    it('a sign-in the server refused even after a refresh: says plainly to log in again — not "check the internet", no retry', async () => {
        mockJoinByCode.mockResolvedValueOnce({ kind: 'signed_out' });
        mount();
        type('K7M2QX');
        const line = await screen.findByTestId('join-code-problem');
        expect(line).toHaveTextContent(C.signedOut);
        expect(line).toHaveTextContent('पुन्हा लॉग इन करा');
        expect(line).not.toHaveTextContent('इंटरनेट');
        expect(screen.queryByTestId('join-code-retry')).toBeNull();
        expect(screen.queryByTestId('join-done')).toBeNull();
    });

    it('an answer that arrives after the screen was closed and opened again does not paint over it', async () => {
        let resolve!: (v: unknown) => void;
        mockJoinByCode.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        const { rerender, onJoined } = mount();
        type('K7M2QX');
        await screen.findByTestId('join-code-checking');
        rerender(<JoinByCodeScreen isOpen={false} onClose={vi.fn()} onJoined={onJoined} />);
        rerender(<JoinByCodeScreen isOpen onClose={vi.fn()} onJoined={onJoined} />);
        await act(async () => { resolve({ kind: 'joined', farm: { farmId: 'f-2', farmName: FARM, status: 'PendingApproval' } }); });

        expect(screen.queryByTestId('join-done')).toBeNull();
        expect(screen.getByTestId('join-code-input')).toHaveValue('');
        // the seat exists on the server, so the farm list is still refreshed
        expect(onJoined).toHaveBeenCalledTimes(1);
    });
});

describe('the QR way', () => {
    it('a pasted QR link opens the QR landing page — without any role — and sends no code', () => {
        const { openJoinLink } = mount();
        type('https://shramsafal.app/join?t=tok-9&f=K7M2QX&r=Mukadam');
        expect(openJoinLink).toHaveBeenCalledWith('/?join=tok-9&farm=K7M2QX');
        expect(mockJoinByCode).not.toHaveBeenCalled();
    });

    it('a link that is not a join link is told so', () => {
        const { openJoinLink } = mount();
        type('https://example.com/something');
        expect(screen.getByTestId('join-code-problem')).toHaveTextContent(C.badLink);
        expect(openJoinLink).not.toHaveBeenCalled();
    });

    it('the screen offers both doors and no English words', () => {
        mount();
        expect(screen.getByTestId('join-code-input')).toBeInTheDocument();
        expect(screen.getByTestId('join-qr-door')).toHaveTextContent(C.qrLine);
        expect(screen.getByTestId('join-code-role-note')).toHaveTextContent(C.roleNote);
        expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('closed means nothing on screen', () => {
        mount({ isOpen: false });
        expect(screen.queryByTestId('join-by-code')).toBeNull();
    });
});
