// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL, section 10). Adding a NAMED worker
 * on the team page needs his name, a phone (tagged स्वतःचा / घरचा / मुकादमचा) and his home PIN — "जोडा" stays off until
 * all three are right; the one-tap "शेताचाच पिन" chip appears only when the farm has a PIN on record. A shared number is
 * a question, never a block (R4). Adding him by his card is one tap away ("कोड किंवा QR ने जोडा").
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddMemberWizard } from '../../../people/components/AddMemberWizard';

afterEach(() => cleanup());

const ok = (name: string) => ({ ok: true as const, worker: { id: 'w1', displayName: name, isActive: true } });

function mount(props: Partial<React.ComponentProps<typeof AddMemberWizard>> = {}) {
    const onAdd = vi.fn(async (input: { displayName: string }) => ok(input.displayName));
    const onAdded = vi.fn();
    const onLinkByCard = vi.fn();
    render(
        <AddMemberWizard
            onAdd={onAdd}
            onAdded={onAdded}
            onCancel={() => undefined}
            onLinkByCard={onLinkByCard}
            {...props}
        />,
    );
    return { onAdd, onAdded, onLinkByCard };
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('WID — adding a named worker needs his name, phone and PIN', () => {
    it('keeps जोडा off until name + phone + PIN are right, and the farm PIN chip meets the PIN in one tap', async () => {
        const { onAdd } = mount({ farmPinCode: '413304' });
        const submit = () => screen.getByTestId('add-worker-submit');

        expect(submit()).toBeDisabled();
        type('add-worker-name', 'रमेश पाटील');
        expect(submit()).toBeDisabled();
        type('add-worker-phone', '60000 00101');
        expect(submit()).toBeDisabled();

        const chip = screen.getByTestId('add-worker-pin-chip');
        expect(chip).toHaveTextContent('413304');
        fireEvent.click(chip);
        expect(submit()).toBeEnabled();

        fireEvent.click(submit());
        await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
        expect(onAdd.mock.calls[0][0]).toEqual(expect.objectContaining({
            displayName: 'रमेश पाटील',
            phone: '6000000101',
            phoneWhose: 'Own',
            homePin: '413304',
        }));
    });

    it('shows no farm-PIN chip when the farm has none on record; a wrong PIN gets a calm hint and keeps जोडा off', () => {
        mount({ farmPinCode: null });
        expect(screen.queryByTestId('add-worker-pin-chip')).toBeNull();
        type('add-worker-name', 'सुनीता');
        type('add-worker-phone', '6000000104');
        type('add-worker-pin', '013304');
        expect(screen.getByTestId('add-worker-pin-hint')).toHaveTextContent('पिन 6 अंकी असतो');
        expect(screen.getByTestId('add-worker-submit')).toBeDisabled();
        type('add-worker-pin', '411001');
        expect(screen.getByTestId('add-worker-submit')).toBeEnabled();
    });

    it('a half-typed phone keeps जोडा off; whose phone it is defaults to स्वतःचा and can be घरचा or मुकादमचा', async () => {
        const { onAdd } = mount({ farmPinCode: '413304' });
        type('add-worker-name', 'महादेव');
        type('add-worker-phone', '60000');
        fireEvent.click(screen.getByTestId('add-worker-pin-chip'));
        expect(screen.getByTestId('add-worker-submit')).toBeDisabled();
        type('add-worker-phone', '6000000103');
        expect(screen.getByTestId('add-worker-whose-Own')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('add-worker-whose-Mukadam'));
        fireEvent.click(screen.getByTestId('add-worker-submit'));
        await waitFor(() => expect(onAdd).toHaveBeenCalled());
        expect(onAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ phoneWhose: 'Mukadam' }));
    });

    it('a number already on this farm is ONE gentle question, never a block (R4)', async () => {
        const onCheckPhone = vi.fn(async () => ({ sameFarmNames: ['रमेश पाटील'], verifiedHolderExists: false }));
        const { onAdd } = mount({ farmPinCode: '413304', onCheckPhone });
        type('add-worker-name', 'सुनीता पाटील');
        type('add-worker-phone', '6000000101');
        fireEvent.click(screen.getByTestId('add-worker-pin-chip'));

        const question = await screen.findByTestId('add-worker-shared-question');
        expect(question).toHaveTextContent('रमेश पाटील');
        expect(screen.getByTestId('add-worker-submit')).toBeEnabled();

        fireEvent.click(screen.getByTestId('add-worker-shared-family'));
        expect(screen.getByTestId('add-worker-whose-Family')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('add-worker-submit'));
        await waitFor(() => expect(onAdd).toHaveBeenCalled());
        expect(onAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ phoneWhose: 'Family', phone: '6000000101' }));
    });

    it('offers "कोड किंवा QR ने जोडा" for a worker already on ShramSafal', () => {
        const { onLinkByCard } = mount({ farmPinCode: null });
        fireEvent.click(screen.getByTestId('add-worker-by-card'));
        expect(onLinkByCard).toHaveBeenCalledTimes(1);
    });
});
