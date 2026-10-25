// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the redesigned "यंत्रं" page keeps
 * the real add form (name, type, own/rented, tank litres) and remove, both through `onUpdate`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MachinesSection from '../sections/MachinesSection';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const profileWith = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...over,
});

const saved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as FarmerProfile;

describe('MachinesSection (redesigned)', () => {
    afterEach(() => cleanup());

    it('says machines are saved on this phone only, and shows the empty state', () => {
        render(<MachinesSection profile={profileWith()} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('setup-this-phone-only')).toHaveTextContent('फक्त या फोनवर साठवलं जातं');
        expect(screen.getByTestId('machines-empty')).toBeInTheDocument();
    });

    it('adds a rented sprayer with its tank — every field reaches the profile', () => {
        const onUpdate = vi.fn();
        render(<MachinesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        expect(screen.getByTestId('machine-save')).toBeDisabled();
        fireEvent.change(screen.getByTestId('machine-name'), { target: { value: 'ब्लोअर' } });
        fireEvent.click(screen.getByTestId('machine-type-Sprayer'));
        fireEvent.click(screen.getByTestId('machine-own-Rented'));
        fireEvent.change(screen.getByTestId('machine-tank'), { target: { value: '200' } });
        fireEvent.click(screen.getByTestId('machine-save'));
        const m = saved(onUpdate).machineries;
        expect(m).toHaveLength(1);
        expect(m![0]).toMatchObject({ name: 'ब्लोअर', type: 'Sprayer', ownership: 'Rented', capacity: 200 });
        expect(m![0].id).toMatch(/^mach_/);
    });

    it('has no tank field for a rotavator', () => {
        render(<MachinesSection profile={profileWith()} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        expect(screen.getByTestId('machine-tank')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('machine-type-Rotavator'));
        expect(screen.queryByTestId('machine-tank')).toBeNull();
    });

    it('lists machines in plain words and removes one', () => {
        const onUpdate = vi.fn();
        const profile = profileWith({ machineries: [
            { id: 'a', name: 'जॉन डियर', type: 'Tractor', ownership: 'Owned', capacity: 600 },
            { id: 'b', name: 'जुनं यंत्र', type: 'Other', ownership: 'Rented' },
        ] });
        render(<MachinesSection profile={profile} onUpdate={onUpdate} />);
        expect(screen.getByTestId('machine-a')).toHaveTextContent('स्वतःचं · ट्रॅक्टर · टाकी 600 लिटर');
        expect(screen.getByTestId('machine-b')).toHaveTextContent('भाड्याचं · इतर');
        fireEvent.click(screen.getByTestId('machine-remove-a'));
        expect(saved(onUpdate).machineries!.map(m => m.id)).toEqual(['b']);
    });

    it('closing the form saves nothing', () => {
        const onUpdate = vi.fn();
        render(<MachinesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        fireEvent.change(screen.getByTestId('machine-name'), { target: { value: 'x' } });
        fireEvent.click(screen.getByTestId('machine-cancel'));
        expect(onUpdate).not.toHaveBeenCalled();
    });
});
