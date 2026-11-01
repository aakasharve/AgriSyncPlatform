// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The server's C5 WaterRoleClassifier stamps `method: "fertigation"` on an NPK/WSF
 * row delivered through drip. The method picker in this sheet was written before
 * that value existed, so opening such a row offered no matching option and showed
 * the farmer no method selected at all.
 *
 * The save path was NOT losing the value — `method` state is seeded from the row
 * and an untouched save writes it straight back. That is asserted below so it stays
 * true now that the option exists and is clickable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import InputDetailSheet from '../InputDetailSheet';
import type { InputEvent, FarmerProfile } from '../../../../../../types';

const profile = { machineries: [] } as unknown as FarmerProfile;

function fertigationRow(): InputEvent {
    return {
        id: 'inp-fert',
        method: 'fertigation',
        mix: [{ id: 'mi-1', productName: '0-52-34 MKP', dose: 4, unit: 'kg' }],
    } as unknown as InputEvent;
}

afterEach(() => {
    cleanup();
});

describe('InputDetailSheet — fertigation method', () => {
    it('offers Fertigation as a delivery method', () => {
        render(
            <InputDetailSheet
                inputs={[fertigationRow()]}
                onSave={vi.fn()}
                onClose={vi.fn()}
                profile={profile}
            />,
        );

        expect(screen.getByRole('button', { name: 'Fertigation' })).toBeTruthy();
    });

    it('preserves the server-classified fertigation method through a save', () => {
        const onSave = vi.fn();

        render(
            <InputDetailSheet
                inputs={[fertigationRow()]}
                onSave={onSave}
                onClose={vi.fn()}
                profile={profile}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save Input Application' }));

        expect(onSave).toHaveBeenCalled();
        const saved = onSave.mock.calls[0][0] as InputEvent[];
        expect(saved[0].method).toBe('fertigation');
    });
});
