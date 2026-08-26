// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FarmListCard from '../FarmListCard';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

const farm: MyFarmDto = { farmId: 'f1', name: 'पुरुषोत्तमशेत', role: 'PrimaryOwner', farmCode: 'GT-4702', subscription: null };

describe('FarmListCard', () => {
    afterEach(() => cleanup());

    it('shows farm name and farm code, and fires onOpen on click', () => {
        const onOpen = vi.fn();
        render(<FarmListCard farm={farm} onOpen={onOpen} language="mr" />);
        expect(screen.getByText('पुरुषोत्तमशेत')).toBeInTheDocument();
        expect(screen.getByText(/GT-4702/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith('f1');
    });

    // Tripwire, not a deletion. This assertion used to require the tenure chip
    // to be PRESENT. It is now required to be ABSENT, so re-adding the chip
    // fails here rather than shipping a land-ownership claim the app has no
    // data for. Passing `tenure` explicitly proves the prop cannot resurrect
    // the label either. Truth audit T1.12b finding 5 — same defect class as
    // the "७/१२" claim removed in d1c3837d, which sat on this same card.
    it('never claims land tenure — nothing in the app captures it', () => {
        render(<FarmListCard farm={farm} tenure="owned" onOpen={() => {}} language="mr" />);
        expect(screen.queryByText('मालकीची')).not.toBeInTheDocument();
        cleanup();
        render(<FarmListCard farm={farm} tenure="leased" onOpen={() => {}} language="en" />);
        expect(screen.queryByText('Leased')).not.toBeInTheDocument();
    });
    it('hides the 7/12 line when farmCode is null', () => {
        render(<FarmListCard farm={{ ...farm, farmCode: null }} onOpen={() => {}} language="en" />);
        expect(screen.queryByText(/७\/१२/)).not.toBeInTheDocument();
    });
});
