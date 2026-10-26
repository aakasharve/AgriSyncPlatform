// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-7, FR-8). The welcome is the LAST
 * first-run screen and is written for the person's REAL role on the open farm: मालक / मुकादम /
 * कामगार each read what THEY will do here. It replaced the one "लॉगिन यशस्वी · अभिनंदन!" everybody got
 * right after login (whose only role logic was hiding the owner line from a worker — JOURNEY FIX D10,
 * which this keeps: a worker is never told he owns the farm). It has one "← मागे".
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../onboarding/DawnScene', () => ({ default: () => null }));

import WelcomeScreen from '../WelcomeScreen';

afterEach(() => cleanup());

const textOf = (testId: string) => screen.getByTestId(testId).textContent ?? '';
/** What the person reads: the screen's text without its <style> block. */
const visibleText = () => {
    const el = screen.getByTestId('role-welcome').cloneNode(true) as HTMLElement;
    el.querySelectorAll('style').forEach(s => s.remove());
    return el.textContent ?? '';
};
const jobs = () => Array.from(screen.getByTestId('role-welcome-jobs').querySelectorAll('li')).map(li => li.textContent);

describe('WelcomeScreen — a welcome written for the role', () => {
    it('मालक: his farm is ready, he owns it by name, and the three things he will do', () => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="PrimaryOwner" farmName="आर्वे शेती" />);
        expect(screen.getByText('अभिनंदन!')).toBeInTheDocument();
        expect(textOf('role-welcome-title')).toBe('तुमचं शेत तयार आहे');
        expect(textOf('role-welcome-line')).toBe('तुम्ही आर्वे शेती चे मालक आहात.');
        expect(jobs()).toEqual(['रोज काय झालं ते बोलून सांगा', 'कामं ठरवा', 'टीम जोडा — QR दाखवा']);
        expect(screen.getByTestId('role-welcome')).toHaveAttribute('data-role', 'owner');
    });

    it('मुकादम: in the team as मुकादम; attendance only once the owner allows it', () => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="Mukadam" farmName="पवार मळा" />);
        expect(textOf('role-welcome-title')).toBe('तुम्ही टीममध्ये आहात');
        expect(textOf('role-welcome-line')).toBe('पवार मळा वर तुम्ही मुकादम आहात');
        expect(jobs()).toEqual(['झालेलं काम बोलून सांगा', 'मालकाने परवानगी दिली की हजेरी घ्या']);
    });

    it('कामगार: welcomed as कामगार — never told he is the owner (D10 kept)', () => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="Worker" farmName="पवार मळा" />);
        expect(textOf('role-welcome-title')).toBe('स्वागत आहे');
        expect(textOf('role-welcome-line')).toBe('पवार मळा वर तुम्ही कामगार आहात');
        expect(jobs()).toEqual(['काम झालं की बोलून सांगा', 'हाताने लिहूनही सांगता येतं']);
        expect(visibleText()).not.toMatch(/मालक आहात|शेत तयार आहे|टीम जोडा/);
    });

    it('the words are Marathi only (no English, no doubled labels) and nothing invented: no plots, no sample farm', () => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="Mukadam" farmName="पवार मळा" />);
        const all = visibleText();
        expect(all).not.toMatch(/[A-Za-z]{3,}/);
        expect(all).not.toMatch(/प्लॉट|Arve|लॉगिन यशस्वी/);
    });

    it('no farm name → the line is not drawn (never a placeholder)', () => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="PrimaryOwner" farmName="" />);
        expect(screen.queryByTestId('role-welcome-line')).toBeNull();
        expect(textOf('role-welcome-title')).toBe('तुमचं शेत तयार आहे');
    });

    it('one "← मागे" back to the step before, and one button onward', () => {
        const onBack = vi.fn();
        const onContinue = vi.fn();
        render(<WelcomeScreen onContinue={onContinue} onBack={onBack} farmRole="Worker" farmName="पवार मळा" />);
        expect(screen.getAllByRole('button', { name: 'मागे' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('welcome-continue'));
        expect(onContinue).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('welcome-continue')).toHaveTextContent('चला, सुरुवात करूया');
    });
});
