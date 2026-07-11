// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import FarmsSection from '../FarmsSection';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

const f = (name: string): MyFarmDto => ({ farmId: name, name, role: 'PrimaryOwner', farmCode: null, subscription: null });

describe('FarmsSection', () => {
    afterEach(() => cleanup());

    it('renders farms sorted by name and shows the family header with count', () => {
        render(<FarmsSection farms={[f('नाशिक'), f('खार्डी')]} familyName="आर्वे कुटुंब" onOpenFarm={() => {}} language="mr" />);
        expect(screen.getByText('आर्वे कुटुंब')).toBeInTheDocument();
        const names = screen.getAllByText(/नाशिक|खार्डी/).map(n => n.textContent);
        expect(names).toEqual(['खार्डी', 'नाशिक']); // Devanagari collation: ख before न
    });

    it('renders the Add CTA when there are no farms', () => {
        render(<FarmsSection farms={[]} onOpenFarm={() => {}} onAddFarm={() => {}} language="en" />);
        expect(screen.getByText(/Add a farm/i)).toBeInTheDocument();
    });
});
