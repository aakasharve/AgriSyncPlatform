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

    it('shows farm name, 7/12 and an Owned tag, and fires onOpen on click', () => {
        const onOpen = vi.fn();
        render(<FarmListCard farm={farm} tenure="owned" onOpen={onOpen} language="mr" />);
        expect(screen.getByText('पुरुषोत्तमशेत')).toBeInTheDocument();
        expect(screen.getByText(/GT-4702/)).toBeInTheDocument();
        expect(screen.getByText('मालकीची')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith('f1');
    });
    it('hides the 7/12 line when farmCode is null', () => {
        render(<FarmListCard farm={{ ...farm, farmCode: null }} onOpen={() => {}} language="en" />);
        expect(screen.queryByText(/७\/१२/)).not.toBeInTheDocument();
    });
});
