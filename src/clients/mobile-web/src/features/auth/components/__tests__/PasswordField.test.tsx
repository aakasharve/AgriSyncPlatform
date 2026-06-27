// @vitest-environment jsdom
/**
 * PasswordField tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - Input is hidden (type="password") by default.
 * - Clicking the toggle button → type="text" (visible).
 * - Clicking again → type="password" (hidden).
 * - Value is preserved across toggles.
 * - Accessible label toggles between "Show password" and "Hide password".
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PasswordField from '../PasswordField';

afterEach(() => {
    cleanup();
});

describe('PasswordField', () => {
    it('is hidden by default (type=password)', () => {
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value="secret"
                onChange={vi.fn()}
            />,
        );
        const input = screen.getByLabelText('Password');
        expect(input).toHaveAttribute('type', 'password');
    });

    it('clicking toggle button reveals password (type=text)', () => {
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value="secret"
                onChange={vi.fn()}
            />,
        );
        const toggleBtn = screen.getByRole('button', { name: 'Show password' });
        fireEvent.click(toggleBtn);

        const input = screen.getByLabelText('Password');
        expect(input).toHaveAttribute('type', 'text');
    });

    it('second click hides password again (type=password)', () => {
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value="secret"
                onChange={vi.fn()}
            />,
        );
        const toggleBtn = screen.getByRole('button', { name: 'Show password' });
        fireEvent.click(toggleBtn);
        // Now it's visible; button label should be "Hide password"
        const hideBtn = screen.getByRole('button', { name: 'Hide password' });
        fireEvent.click(hideBtn);

        const input = screen.getByLabelText('Password');
        expect(input).toHaveAttribute('type', 'password');
    });

    it('value is preserved across toggle', () => {
        const onChange = vi.fn();
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value="my-secret-value"
                onChange={onChange}
            />,
        );

        const input = screen.getByLabelText('Password') as HTMLInputElement;
        expect(input.value).toBe('my-secret-value');

        // Toggle to visible
        fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
        // Value is still the same (controlled)
        expect(input.value).toBe('my-secret-value');
    });

    it('accessible label is "Show password" by default', () => {
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value=""
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    });

    it('accessible label changes to "Hide password" when visible', () => {
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value=""
                onChange={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
        expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    });

    it('calls onChange when input value changes', () => {
        const onChange = vi.fn();
        render(
            <PasswordField
                id="test-pw"
                label="Password"
                value=""
                onChange={onChange}
            />,
        );
        const input = screen.getByLabelText('Password');
        fireEvent.change(input, { target: { value: 'new-value' } });
        expect(onChange).toHaveBeenCalledWith('new-value');
    });
});
