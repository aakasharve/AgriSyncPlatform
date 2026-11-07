// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
//
// The question screen itself: the founder's words with the account's name, होय continues with the session the server
// opened, नाही ends with the D-85 words and one "मागे", a lost answer says "try again", and a question the server no
// longer holds goes back to sign-in. One language at a time: Marathi, and the English twins.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    language: 'mr' as 'mr' | 'en',
    answer: vi.fn(),
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.language, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: h.language, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../data/deviceCheckClient', () => ({
    answerDeviceCheck: (...a: unknown[]) => h.answer(...a),
}));

import DeviceCheckQuestion from '../DeviceCheckQuestion';

const SESSION = { userId: 'u-1', accessToken: 'opens-the-account', expiresAtUtc: '2026-11-07T07:00:00Z' };

function renderQuestion() {
    const onConfirmed = vi.fn();
    const onFinished = vi.fn();
    render(<DeviceCheckQuestion accountName="रमेश पाटील" onConfirmed={onConfirmed} onFinished={onFinished} />);
    return { onConfirmed, onFinished };
}

beforeEach(() => {
    h.language = 'mr';
    h.answer.mockReset();
});
afterEach(cleanup);

describe('the new-phone question (D-56)', () => {
    it('asks in the founder\'s words, with the account\'s name, and only होय / नाही', () => {
        renderQuestion();
        expect(screen.getByTestId('device-check-question')).toHaveTextContent('हे खातं रमेश पाटील यांचं आहे — तुम्ही तेच आहात का?');
        expect(screen.getByTestId('device-check-yes')).toHaveTextContent('होय');
        expect(screen.getByTestId('device-check-no')).toHaveTextContent('नाही');
        expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('होय sends "yes" and continues with the session the server opened', async () => {
        h.answer.mockResolvedValue({ kind: 'confirmed', session: SESSION });
        const { onConfirmed, onFinished } = renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-yes'));

        await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(SESSION));
        expect(h.answer).toHaveBeenCalledWith('yes');
        expect(h.answer).toHaveBeenCalledTimes(1);
        expect(onFinished).not.toHaveBeenCalled();
    });

    it('नाही ends here with the D-85 words and one "मागे" back to sign-in', async () => {
        h.answer.mockResolvedValue({ kind: 'declined' });
        const { onConfirmed, onFinished } = renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-no'));

        expect(await screen.findByTestId('device-check-declined'))
            .toHaveTextContent('हे खातं तुमचं नाही. नंबर बदलला असेल तर श्रमसफल मदतीशी संपर्क करा.');
        expect(h.answer).toHaveBeenCalledWith('no');
        expect(screen.queryByTestId('device-check-yes')).toBeNull();
        expect(onConfirmed).not.toHaveBeenCalled();
        expect(onFinished).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('device-check-back'));
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('a second tap while the answer is on its way sends nothing more', async () => {
        let resolve: (v: unknown) => void = () => undefined;
        h.answer.mockReturnValue(new Promise(r => { resolve = r; }));
        renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-yes'));
        fireEvent.click(screen.getByTestId('device-check-no'));
        expect(h.answer).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('device-check-yes')).toHaveTextContent('पाठवत आहे…');
        await act(async () => { resolve({ kind: 'confirmed', session: SESSION }); });
    });

    it('an answer that did not arrive says so and can be tried again', async () => {
        h.answer.mockResolvedValueOnce({ kind: 'unreachable' }).mockResolvedValueOnce({ kind: 'confirmed', session: SESSION });
        const { onConfirmed } = renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-yes'));
        expect(await screen.findByTestId('device-check-failed')).toHaveTextContent('उत्तर पोहोचलं नाही. पुन्हा प्रयत्न करा.');
        expect(onConfirmed).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('device-check-yes'));
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(SESSION));
    });

    it('a thrown failure is shown as "try again", never a dead screen', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        h.answer.mockRejectedValue(new Error('keystore'));
        renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-no'));
        expect(await screen.findByTestId('device-check-failed')).toBeInTheDocument();
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('a question the server no longer holds goes straight back to sign-in', async () => {
        h.answer.mockResolvedValue({ kind: 'expired' });
        const { onFinished, onConfirmed } = renderQuestion();

        fireEvent.click(screen.getByTestId('device-check-yes'));

        await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('in English: the twins, one language only', async () => {
        h.language = 'en';
        h.answer.mockResolvedValue({ kind: 'declined' });
        renderQuestion();

        expect(screen.getByTestId('device-check-question')).toHaveTextContent('This account belongs to रमेश पाटील — is that you?');
        expect(screen.getByTestId('device-check-yes')).toHaveTextContent('Yes');
        expect(screen.getByTestId('device-check-no')).toHaveTextContent('No');
        expect(screen.queryByText(/होय|नाही/)).toBeNull();

        fireEvent.click(screen.getByTestId('device-check-no'));
        expect(await screen.findByTestId('device-check-declined'))
            .toHaveTextContent('This account is not yours. If your number changed hands, contact ShramSafal help.');
        expect(screen.getByTestId('device-check-back')).toHaveTextContent('Back');
    });
});
