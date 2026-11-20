// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; CTO ruling 2026-11-21 on the "Other / अन्य" variety chip)
 *
 * A farmer whose grape variety is not in the list must be able to enter it: tapping the last chip ("अन्य") shows it chosen in the one dark chosen
 * look, opens the typing box, and what he types is his own variety text - saved exactly as typed, never rewritten and never matched to a list entry.
 * Before the fix, tapping the chip set the variety to '' so the chip never showed chosen and the box never appeared.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VarietySelector } from '../VarietySelector';

afterEach(cleanup);

const Harness: React.FC<{ start?: string; language?: string; onValue?: (v: string) => void }> = ({ start = '', language = 'mr', onValue }) => {
    const [value, setValue] = useState(start);
    return (
        <>
            <VarietySelector cropName="Grapes" value={value} language={language} onChange={v => { setValue(v); onValue?.(v); }} />
            <output data-testid="saved">{value}</output>
        </>
    );
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const typeInto = (text: string) => fireEvent.change(screen.getByTestId('variety-other-input'), { target: { value: text } });

describe('the "अन्य" chip: a variety that is not in the list', () => {
    it('tapping it shows the chip chosen in the dark chosen look, 48 px, with a tick - and opens the typing box (this fails without the fix)', () => {
        render(<Harness />);
        expect(screen.queryByTestId('variety-other-input')).toBeNull();
        const other = screen.getByTestId('variety-chip-Other');
        expect(other).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(other);
        const on = screen.getByTestId('variety-chip-Other');
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(on.className).toContain('text-white');
        expect(on.className).toContain('min-h-[48px]');
        expect(part(on, 'tick')).toBeTruthy();
        expect(screen.getByTestId('variety-other-input')).toBeInTheDocument();
        expect(screen.getByTestId('variety-other-input')).toHaveFocus(); // he can type at once
        expect(screen.getByTestId('saved').textContent).toBe(''); // nothing is saved until he types
    });

    it('what he types is saved exactly as typed, and the box and the chip stay while he types', () => {
        const seen = vi.fn();
        render(<Harness onValue={seen} />);
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        typeInto('माझं स्वतःचं वाण');
        expect(screen.getByTestId('saved').textContent).toBe('माझं स्वतःचं वाण');
        expect(seen).toHaveBeenLastCalledWith('माझं स्वतःचं वाण');
        expect(screen.getByTestId('variety-other-input')).toHaveValue('माझं स्वतःचं वाण');
        expect(screen.getByTestId('variety-chip-Other')).toHaveAttribute('aria-pressed', 'true');
        // not trimmed, not title-cased, not rewritten
        typeInto('  sonaka  x ');
        expect(screen.getByTestId('saved').textContent).toBe('  sonaka  x ');
    });

    it('typing the name of a list variety is still HIS text: it is never matched to the list chip, and the box stays open', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        typeInto('Thompson Seedless');
        expect(screen.getByTestId('saved').textContent).toBe('Thompson Seedless');
        expect(screen.getByTestId('variety-other-input')).toBeInTheDocument();
        expect(screen.getByTestId('variety-chip-Thompson Seedless')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('variety-chip-Other')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a list variety picked first is cleared when he turns to "अन्य"; text he already typed stays when he taps it again', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('variety-chip-Super Sonaka'));
        expect(screen.getByTestId('saved').textContent).toBe('Super Sonaka');
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        expect(screen.getByTestId('saved').textContent).toBe(''); // "Super Sonaka" is not his own text
        expect(screen.getByTestId('variety-chip-Super Sonaka')).toHaveAttribute('aria-pressed', 'false');
        typeInto('माझं वाण');
        fireEvent.click(screen.getByTestId('variety-chip-Other')); // tapping it again does not wipe what he typed
        expect(screen.getByTestId('saved').textContent).toBe('माझं वाण');
        expect(screen.getByTestId('variety-other-input')).toBeInTheDocument();
    });

    it('choosing a list variety afterwards closes the box and saves that variety', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        typeInto('माझं वाण');
        fireEvent.click(screen.getByTestId('variety-chip-Sharad Seedless'));
        expect(screen.queryByTestId('variety-other-input')).toBeNull();
        expect(screen.getByTestId('saved').textContent).toBe('Sharad Seedless');
        expect(screen.getByTestId('variety-chip-Sharad Seedless')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('variety-chip-Other')).toHaveAttribute('aria-pressed', 'false');
    });

    it('editing a plot whose stored variety is not in the list opens the box with his text and shows the chip chosen', () => {
        render(<Harness start="माझं जुनं वाण" />);
        expect(screen.getByTestId('variety-chip-Other')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('variety-other-input')).toHaveValue('माझं जुनं वाण');
        expect(screen.getByTestId('saved').textContent).toBe('माझं जुनं वाण');
    });

    it('Marathi mode: the chip says "अन्य" and the box asks in Marathi; English mode keeps "Other"', () => {
        const { unmount } = render(<Harness language="mr" />);
        expect(screen.getByTestId('variety-chip-Other')).toHaveTextContent('अन्य');
        expect(screen.getByTestId('variety-chip-Other').textContent).not.toMatch(/Other/);
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        expect(screen.getByTestId('variety-other-input')).toHaveAttribute('placeholder', 'वाणाचं नाव लिहा');
        unmount();
        render(<Harness language="en" />);
        expect(screen.getByTestId('variety-chip-Other')).toHaveTextContent('Other');
        fireEvent.click(screen.getByTestId('variety-chip-Other'));
        expect(screen.getByTestId('variety-other-input')).toHaveAttribute('placeholder', 'Enter variety name');
    });
});
