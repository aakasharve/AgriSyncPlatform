// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — the phone number as one plain field (founder change note
 * of 2026-11-17; replaces the ten-box PhoneDigitBoxes of lane UI-5).
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PhoneField, { phoneFromPaste, sanitizePhoneDigits } from '../PhoneField';

const Harness: React.FC<{ initial?: string; lang?: 'mr' | 'en' }> = ({ initial = '', lang = 'mr' }) => {
    const [v, setV] = useState(initial);
    return (
        <div>
            <PhoneField id="t-phone" value={v} onChange={setV} language={lang} />
            <output data-testid="out">{v}</output>
            <button type="button" disabled={v.length !== 10}>go</button>
        </div>
    );
};

const field = () => document.getElementById('t-phone') as HTMLInputElement;
const out = () => screen.getByTestId('out').textContent;
afterEach(cleanup);

describe('PhoneField', () => {
    it('is one input with +91 fixed at its left and the caller element id on it', () => {
        render(<Harness />);
        expect(document.querySelectorAll('input')).toHaveLength(1);
        expect(field()).toBeInTheDocument();
        expect(screen.getByTestId('phone-prefix')).toHaveTextContent('+91');
    });

    it('typing keeps plain digits and the button waits for ten', () => {
        render(<Harness />);
        fireEvent.change(field(), { target: { value: '98765' } });
        expect(out()).toBe('98765');
        expect(screen.getByText('go')).toBeDisabled();
        fireEvent.change(field(), { target: { value: '9876543210' } });
        expect(screen.getByText('go')).toBeEnabled();
    });

    it('ignores letters and cuts at ten digits', () => {
        render(<Harness />);
        fireEvent.change(field(), { target: { value: 'ab98x76' } });
        expect(out()).toBe('9876');
        fireEvent.change(field(), { target: { value: '987654321012' } });
        expect(out()).toBe('9876543210');
    });

    it('paste with +91, a leading 0, spaces and dashes ends as the ten digits', () => {
        render(<Harness />);
        fireEvent.change(field(), { target: { value: '+91 98765-43210' } });
        expect(out()).toBe('9876543210');
        fireEvent.change(field(), { target: { value: '09876543210' } });
        expect(out()).toBe('9876543210');
    });

    it('phoneFromPaste and sanitizePhoneDigits handle prefixes and Devanagari digits', () => {
        expect(phoneFromPaste('09876543210')).toBe('9876543210');
        expect(phoneFromPaste('919876543210')).toBe('9876543210');
        expect(phoneFromPaste('९८७६५४३२१०')).toBe('9876543210');
        expect(sanitizePhoneDigits('९८७६५४३२१०')).toBe('9876543210');
    });

    it('fill() on the real input lands the whole number (the e2e helper path)', () => {
        render(<Harness />);
        field().focus();
        fireEvent.change(field(), { target: { value: '8888888888' } });
        expect(out()).toBe('8888888888');
        expect(field().value).toBe('8888888888');
    });

    it('shows no counter, and no per-digit boxes', () => {
        render(<Harness initial="98765" />);
        expect(screen.queryByTestId('phone-digits-left')).toBeNull();
        expect(screen.queryByTestId('phone-box-1')).toBeNull();
    });

    it('a number starting 5 gets the short 6/7/8/9 note in both languages; 9 does not', () => {
        const { unmount } = render(<Harness initial="5123456789" />);
        expect(screen.getByTestId('phone-bad-start')).toHaveTextContent('६, ७, ८ किंवा ९');
        unmount();
        const second = render(<Harness initial="5123456789" lang="en" />);
        expect(screen.getByTestId('phone-bad-start')).toHaveTextContent('6, 7, 8 or 9');
        second.unmount();
        render(<Harness initial="9123456789" />);
        expect(screen.queryByTestId('phone-bad-start')).toBeNull();
    });

    it('passes the autofill hint through (sign-in uses "username" for the password manager)', () => {
        render(<PhoneField id="t-phone" value="" onChange={() => {}} language="mr" autoComplete="username" />);
        expect(field()).toHaveAttribute('autocomplete', 'username');
    });
});
