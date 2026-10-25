// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the redesigned "पाणी आणि वीज" page
 * keeps every real water-source control, and each one still sends the right change through
 * `onUpdate` (ProfilePage wires it to `onUpdateProfile`). It also says the setup lives on this phone.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import UtilitiesSection from '../sections/UtilitiesSection';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const profileWith = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'Test', village: 'V', phone: '9999999999', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...over,
});

const seeded = () => profileWith({
    waterResources: [
        { id: 'w1', name: 'मोठी विहीर', type: 'Well', isAvailable: true, notes: 'keep me' },
        { id: 'w2', name: 'बोअर', type: 'Borewell', isAvailable: true },
    ],
    motors: [
        { id: 'm1', name: 'पंप 1', hp: 7.5, phase: '3', powerSourceType: 'MSEB', powerSourceName: 'DP-4', linkedWaterSourceId: 'w1', dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 8000 } },
        { id: 'm2', name: 'पंप 2', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'w2' },
    ],
});

const lastUpdate = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as FarmerProfile;

describe('UtilitiesSection (redesigned) — every real control still saves through onUpdate', () => {
    afterEach(() => cleanup());

    it('says the setup is saved on this phone only', () => {
        render(<UtilitiesSection profile={profileWith()} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('setup-this-phone-only')).toHaveTextContent('फक्त या फोनवर साठवलं जातं');
    });

    it('adds a source with its motor — every field of the two-step form reaches the profile', () => {
        const onUpdate = vi.fn();
        render(<UtilitiesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('source-add'));
        fireEvent.click(screen.getByTestId('source-next'));
        expect(screen.getByTestId('source-name-error')).toHaveTextContent('स्रोताचं नाव लिहा');
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: '  नवी बोअर ' } });
        fireEvent.click(screen.getByTestId('source-type-Borewell'));
        fireEvent.click(screen.getByTestId('source-next'));
        fireEvent.change(screen.getByTestId('motor-name-1'), { target: { value: 'सोलर पंप' } });
        fireEvent.change(screen.getByTestId('motor-hp-1'), { target: { value: '3' } });
        fireEvent.click(screen.getByTestId('motor-phase-1-1'));
        fireEvent.click(screen.getByTestId('motor-power-1-Solar'));
        fireEvent.click(screen.getByTestId('motor-drip-1-yes'));
        fireEvent.click(screen.getByTestId('motor-pipe-1-20mm'));
        fireEvent.click(screen.getByTestId('motor-filter-1-no'));
        fireEvent.change(screen.getByTestId('motor-flow-1'), { target: { value: '6000' } });
        // a second motor slot left without a name is not saved
        fireEvent.click(screen.getByTestId('motor-add'));
        fireEvent.click(screen.getByTestId('source-save'));

        expect(onUpdate).toHaveBeenCalledTimes(1);
        const next = lastUpdate(onUpdate);
        expect(next.waterResources).toHaveLength(1);
        const source = next.waterResources[0];
        expect(source).toMatchObject({ name: 'नवी बोअर', type: 'Borewell', isAvailable: true });
        expect(next.motors).toHaveLength(1);
        expect(next.motors[0]).toMatchObject({
            name: 'सोलर पंप', hp: 3, phase: '1', powerSourceType: 'Solar', linkedWaterSourceId: source.id,
            dripDetails: { pipeSize: '20mm', hasFilter: false, flowRatePerHour: 6000 },
            schedule: { windowStart: '22:00', windowEnd: '06:00', days: ['Daily'], rotationType: 'Weekly' },
        });
    });

    it('changes an existing source and its motor, keeping ids, unshown fields and other sources', () => {
        const onUpdate = vi.fn();
        render(<UtilitiesSection profile={seeded()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        fireEvent.click(screen.getByTestId('source-edit-w1'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'जुनी विहीर' } });
        fireEvent.click(screen.getByTestId('source-next'));
        fireEvent.change(screen.getByTestId('motor-hp-1'), { target: { value: '10' } });
        fireEvent.click(screen.getByTestId('source-save'));

        const next = lastUpdate(onUpdate);
        expect(next.waterResources.map(w => w.id)).toEqual(['w1', 'w2']);
        expect(next.waterResources[0]).toEqual({ id: 'w1', name: 'जुनी विहीर', type: 'Well', isAvailable: true, notes: 'keep me' });
        const m1 = next.motors.find(m => m.id === 'm1');
        expect(m1).toMatchObject({ hp: 10, powerSourceName: 'DP-4', linkedWaterSourceId: 'w1', dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 8000 } });
        expect(next.motors.find(m => m.id === 'm2')).toEqual(seeded().motors[1]);
        expect(next.motors).toHaveLength(2);
    });

    it('removes one motor', () => {
        const onUpdate = vi.fn();
        render(<UtilitiesSection profile={seeded()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        fireEvent.click(screen.getByTestId('motor-remove-m1'));
        expect(lastUpdate(onUpdate).motors.map(m => m.id)).toEqual(['m2']);
        expect(lastUpdate(onUpdate).waterResources).toHaveLength(2);
    });

    it('removes a source only after asking, and its motors go with it', () => {
        const onUpdate = vi.fn();
        render(<UtilitiesSection profile={seeded()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        fireEvent.click(screen.getByTestId('source-remove-w1'));
        expect(onUpdate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('source-remove-yes-w1'));
        const next = lastUpdate(onUpdate);
        expect(next.waterResources.map(w => w.id)).toEqual(['w2']);
        expect(next.motors.map(m => m.id)).toEqual(['m2']);
    });

    it('shows motors in plain words, warns "मोटर नाही", and says plot linking is not built (no dead alert)', () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
        render(<UtilitiesSection profile={profileWith({ waterResources: [...seeded().waterResources, { id: 'w3', name: 'तळं', type: 'Farm Pond', isAvailable: true }], motors: seeded().motors })} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('no-motor-w3')).toHaveTextContent('मोटर नाही');
        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        const motor = screen.getByTestId('motor-m1');
        expect(motor).toHaveTextContent('7.5 HP · थ्री फेज · महावितरण वीज');
        expect(motor).toHaveTextContent('ठिबक: 16 मिमी · फिल्टर · 8000 लि/तास');
        expect(screen.getByTestId('source-w1')).toHaveTextContent('लवकरच');
        expect(screen.queryByText(/Link to Plot/i)).toBeNull();
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('allows at most 4 motors on a well, any number on a शेततळं (the real rule)', () => {
        render(<UtilitiesSection profile={profileWith()} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('source-add'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'विहीर' } });
        fireEvent.click(screen.getByTestId('source-next'));
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('motor-add'));
        expect(screen.queryByTestId('motor-add')).toBeNull();
        fireEvent.click(screen.getByTestId('source-back'));
        fireEvent.click(screen.getByTestId('source-type-Farm Pond'));
        fireEvent.click(screen.getByTestId('source-next'));
        expect(screen.getByTestId('motor-add')).toBeInTheDocument();
        expect(within(screen.getByTestId('source-form')).getAllByTestId(/^motor-edit-/)).toHaveLength(4);
    });

    it('cancelling the form saves nothing', () => {
        const onUpdate = vi.fn();
        render(<UtilitiesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('source-add'));
        fireEvent.click(screen.getByTestId('source-cancel'));
        expect(onUpdate).not.toHaveBeenCalled();
        expect(screen.getByTestId('source-add')).toBeInTheDocument();
    });
});
