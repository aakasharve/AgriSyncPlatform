// @vitest-environment jsdom
/**
 * Labour V1 Task 7.4/7.6 — the optional stated-hours input on the labour sheet.
 *
 * Two properties are under test, and the second one is the important one:
 *   1. A stated number reaches the saved labour event as `durationHours`.
 *   2. NOTHING a farmer can do to this field produces a bad value. Blank, "0",
 *      and a stray non-numeric keystroke must all yield ABSENT — not NaN, not 0
 *      — because absent is what the server reads as "not stated" and records as
 *      its own assumed default. A NaN or a 0 would travel over the wire as a
 *      claim the farmer never made. The field is optional and must never be
 *      able to reject or block the day's log (Constraint 7 / P9).
 *
 * spec: 2026-07-13-labour-attendance-approval-design
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DetailSheet from '../DetailSheet';
import type { LedgerDefaults, FarmerProfile } from '../../../../../../types';

const defaults = {
    labour: {
        defaultWage: 400,
        defaultHours: 8,
        shifts: [{ id: 'full', name: 'Full Day', defaultRateMale: 500, defaultRateFemale: 400 }],
    },
    irrigation: { method: 'Drip', source: 'Well', defaultDuration: 2 },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
} as unknown as LedgerDefaults;

const profile = { name: 'Tester', motors: [], waterResources: [] } as unknown as FarmerProfile;

/** Renders the labour sheet and returns the hours input + the onSave spy. */
function renderLabourSheet() {
    const onSave = vi.fn();
    render(
        <DetailSheet
            type="labour"
            data={{ type: 'HIRED', count: 5, maleCount: 3, femaleCount: 2, shiftId: 'full' }}
            defaults={defaults}
            profile={profile}
            onSave={onSave}
            onClose={() => { }}
        />
    );

    const label = screen.getByText('कामाचे तास');
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    return { onSave, input };
}

function confirm() {
    fireEvent.click(screen.getByText('Confirm Details'));
}

describe('DetailSheet — कामाचे तास (stated hours)', () => {
    // DetailSheet renders through createPortal into document.body, and this
    // repo runs vitest without `globals`, so RTL's auto-cleanup never
    // registers — without this each sheet stays in the DOM and the next
    // query matches several at once.
    afterEach(() => cleanup());

    it('renders the Marathi label in the HIRED block', () => {
        renderLabourSheet();
        expect(screen.getByText('कामाचे तास')).toBeDefined();
    });

    it('entering 4 puts durationHours: 4 on the saved labour event', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: '4' } });
        confirm();

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0].durationHours).toBe(4);
    });

    it('accepts a fractional value', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: '4.5' } });
        confirm();

        expect(onSave.mock.calls[0][0].durationHours).toBe(4.5);
    });

    it('left blank, the field is omitted entirely — not 0, not NaN', () => {
        const { onSave } = renderLabourSheet();

        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.durationHours).toBeUndefined();
        expect('durationHours' in saved && saved.durationHours !== undefined).toBe(false);
    });

    it('CLEARING a previously entered value returns to absent', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: '6' } });
        fireEvent.change(input, { target: { value: '' } });
        confirm();

        expect(onSave.mock.calls[0][0].durationHours).toBeUndefined();
    });

    it('typing 0 yields absent, never a literal 0 hours on the wire', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: '0' } });
        confirm();

        expect(onSave.mock.calls[0][0].durationHours).toBeUndefined();
    });

    it('a stray non-numeric keystroke yields absent, never NaN', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: 'abc' } });
        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.durationHours).toBeUndefined();
        expect(Number.isNaN(saved.durationHours)).toBe(false);
    });

    it('a negative value yields absent', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: '-3' } });
        confirm();

        expect(onSave.mock.calls[0][0].durationHours).toBeUndefined();
    });

    it('never blocks the save — the rest of the labour event is saved regardless', () => {
        const { onSave, input } = renderLabourSheet();

        fireEvent.change(input, { target: { value: 'abc' } });
        confirm();

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0].count).toBe(5);
        expect(onSave.mock.calls[0][0].type).toBe('HIRED');
    });
});
