// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane UI-5 (founder D-149 item 1).
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PhoneDigitBoxes, { phoneFromPaste, sanitizePhoneDigits } from '../PhoneDigitBoxes';

const Harness: React.FC<{ initial?: string; lang?: 'mr' | 'en' }> = ({ initial = '', lang = 'mr' }) => {
    const [v, setV] = useState(initial);
    return (
        <div>
            <PhoneDigitBoxes id="t-phone" value={v} onChange={setV} language={lang} />
            <output data-testid="out">{v}</output>
            <button type="button" disabled={v.length !== 10}>go</button>
        </div>
    );
};

const box = (n: number) => screen.getByTestId(`phone-box-${n}`) as HTMLInputElement;
const out = () => screen.getByTestId('out').textContent;
afterEach(cleanup);

describe('PhoneDigitBoxes', () => {
    it('shows ten numbered boxes', () => {
        render(<Harness />);
        for (let i = 1; i <= 10; i++) expect(box(i)).toBeInTheDocument();
        expect(screen.getByText('10', { selector: 'span[aria-hidden="true"]' })).toBeInTheDocument();
    });

    it('typing fills a box and moves to the next', () => {
        render(<Harness />);
        fireEvent.change(box(1), { target: { value: '9' } });
        expect(out()).toBe('9');
        expect(document.activeElement).toBe(box(2));
        fireEvent.change(box(2), { target: { value: '8' } });
        expect(out()).toBe('98');
    });

    it('ignores letters', () => {
        render(<Harness />);
        fireEvent.change(box(1), { target: { value: 'a' } });
        expect(out()).toBe('');
    });

    it('Backspace in the middle erases that digit and steps back', () => {
        render(<Harness initial="9876543210" />);
        fireEvent.keyDown(box(5), { key: 'Backspace' });
        expect(out()).toBe('987643210');
        expect(document.activeElement).toBe(box(4));
    });

    it('a middle digit can be changed without retyping the others', () => {
        render(<Harness initial="9876543210" />);
        fireEvent.change(box(3), { target: { value: '1' } });
        expect(out()).toBe('9816543210');
    });

    it('paste with +91, spaces and dashes fills all ten', () => {
        render(<Harness />);
        fireEvent.paste(box(1), { clipboardData: { getData: () => '+91 98765-43210' } });
        expect(out()).toBe('9876543210');
        expect(box(10).value).toBe('0');
    });

    it('phoneFromPaste and sanitizePhoneDigits handle prefixes and Devanagari digits', () => {
        expect(phoneFromPaste('09876543210')).toBe('9876543210');
        expect(phoneFromPaste('919876543210')).toBe('9876543210');
        expect(sanitizePhoneDigits('९८७६५४३२१०')).toBe('9876543210');
    });

    it('shows "N अंक बाकी" while short, and the button stays off until 10 digits', () => {
        render(<Harness initial="98765" />);
        expect(screen.getByTestId('phone-digits-left')).toHaveTextContent('5 अंक बाकी');
        expect(screen.getByText('go')).toBeDisabled();
        fireEvent.paste(box(1), { clipboardData: { getData: () => '9876543210' } });
        expect(screen.getByText('go')).toBeEnabled();
        expect(screen.getByTestId('phone-digits-left')).not.toHaveTextContent('बाकी');
    });

    it('English twin', () => {
        render(<Harness initial="98765" lang="en" />);
        expect(screen.getByTestId('phone-digits-left')).toHaveTextContent('5 digits left');
    });

    it('a number starting 5 gets the short 6/7/8/9 note; 9 does not', () => {
        const { unmount } = render(<Harness initial="5123456789" />);
        expect(screen.getByTestId('phone-bad-start')).toBeInTheDocument();
        unmount();
        render(<Harness initial="9123456789" />);
        expect(screen.queryByTestId('phone-bad-start')).toBeNull();
    });

    it('the hidden real input keeps the element id and follows fill()', () => {
        render(<Harness />);
        const real = document.getElementById('t-phone') as HTMLInputElement;
        fireEvent.change(real, { target: { value: '9876543210' } });
        expect(out()).toBe('9876543210');
        expect(box(1).value).toBe('9');
    });
});
