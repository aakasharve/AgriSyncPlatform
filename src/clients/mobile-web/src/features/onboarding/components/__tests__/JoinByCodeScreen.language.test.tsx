// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, round-2 review LANG-strict-EN-join).
 *
 * The join door follows the language the person chose. On the English first run "I was invited" used to
 * open this screen in Marathi only (JOIN_BY_CODE_COPY), breaking "in English only show English". In
 * English every word here — the title, the one back, the code box, the QR line, the server's answer —
 * is English; with no choice (or Marathi) it is the Marathi it always was. Only the network is stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: null as 'mr' | 'en' | null }));

const mockJoinByCode = vi.fn();
vi.mock('../../qr/inviteApi', () => ({
    joinByCode: (...a: unknown[]) => mockJoinByCode(...a),
}));
// `h.lang === null` = no provider (the app's default, Marathi).
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.lang ? { language: h.lang, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));

import JoinByCodeScreen from '../JoinByCodeScreen';
import { JOIN_BY_CODE_COPY, JOIN_BY_CODE_COPY_EN } from '../joinByCodeCopy';

const DEVANAGARI = /[ऀ-ॿ]/;
const text = () => document.body.textContent ?? '';
const type = (value: string) => fireEvent.change(screen.getByTestId('join-code-input'), { target: { value } });

beforeEach(() => {
    h.lang = null;
    mockJoinByCode.mockReset();
});
afterEach(cleanup);

describe('English chosen', () => {
    it('the whole screen is English: title, one "Back", the code box, the role note and the QR line', () => {
        h.lang = 'en';
        const onClose = vi.fn();
        render(<JoinByCodeScreen isOpen onClose={onClose} openJoinLink={vi.fn()} />);

        expect(screen.getByTestId('page-title')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.title);
        expect(screen.getByTestId('join-code-input')).toHaveAttribute('placeholder', JOIN_BY_CODE_COPY_EN.codePlaceholder);
        expect(screen.getByLabelText(JOIN_BY_CODE_COPY_EN.codeLabel)).toBeInTheDocument();
        expect(screen.getByTestId('join-code-role-note')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.roleNote);
        expect(screen.getByTestId('join-qr-door')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.qrLine);
        expect(text()).not.toMatch(DEVANAGARI);

        const back = screen.getByTestId('page-back');
        expect(back).toHaveTextContent('Back');
        expect(back).toHaveAccessibleName('Back');
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the server\'s answer is English too — a request sent, and a wrong code', async () => {
        h.lang = 'en';
        mockJoinByCode.mockResolvedValueOnce({ kind: 'code_unknown' });
        render(<JoinByCodeScreen isOpen onClose={vi.fn()} openJoinLink={vi.fn()} />);
        type('K7M2QX');
        expect(await screen.findByTestId('join-code-problem')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.unknown);
        expect(text()).not.toMatch(DEVANAGARI);

        mockJoinByCode.mockResolvedValueOnce({ kind: 'joined', farm: { farmId: 'f-2', farmName: 'Pawar farm', status: 'PendingApproval' } });
        type('K7M2QY');
        expect(await screen.findByTestId('join-done-title')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.sentTitle);
        expect(screen.getByTestId('join-done-line')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.sentLine);
        expect(screen.getByTestId('join-done-ok')).toHaveTextContent(JOIN_BY_CODE_COPY_EN.ok);
        expect(text()).not.toMatch(DEVANAGARI);
    });
});

describe('no choice made / Marathi chosen', () => {
    it.each([null, 'mr'] as const)('language %s: the Marathi it always was, with मागे and no English word but "QR"', (lang) => {
        h.lang = lang;
        render(<JoinByCodeScreen isOpen onClose={vi.fn()} openJoinLink={vi.fn()} />);
        expect(screen.getByTestId('page-title')).toHaveTextContent(JOIN_BY_CODE_COPY.title);
        expect(screen.getByTestId('page-back')).toHaveTextContent('मागे');
        expect(text().replace(/QR/g, '')).not.toMatch(/[A-Za-z]/);
    });
});

describe('the two tables say the same things', () => {
    it('every Marathi line has an English line, and no English line carries Devanagari', () => {
        expect(Object.keys(JOIN_BY_CODE_COPY_EN).sort()).toEqual(Object.keys(JOIN_BY_CODE_COPY).sort());
        Object.values(JOIN_BY_CODE_COPY_EN).forEach(line => expect(line).not.toMatch(DEVANAGARI));
    });
});
