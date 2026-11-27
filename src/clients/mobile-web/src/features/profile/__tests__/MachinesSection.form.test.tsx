// @vitest-environment jsdom
/**
 * Repair FIX-1 item 7 (R2-A 17, founder 27 Nov) — the machine form: the type chips ट्रॅक्टर, ब्लोअर, फवारणी यंत्र, रोटाव्हेटर,
 * हार्वेस्टर, इतर; the name stays the ONLY required field; after the type, optional details for that type (tractor: कंपनी, मॉडेल, HP;
 * blower and sprayer: कंपनी, मॉडेल, नोझलची संख्या, टाकी (लिटर), one free line; others: कंपनी, मॉडेल); edit keeps the machine's id;
 * a machine saved before these fields existed still loads. Storage stays on this phone (the page says so).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MachinesSection from '../sections/MachinesSection';
import { VerificationStatus, type FarmerProfile, type FarmMachinery } from '../../../domain/types/farm.types';

const profileWith = (machineries?: FarmMachinery[]): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...(machineries ? { machineries } : {}),
});
const saved = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[fn.mock.calls.length - 1][0] as FarmerProfile).machineries ?? [];
const type = (v: string) => fireEvent.change(screen.getByTestId('machine-name'), { target: { value: v } });
const field = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const DETAIL_IDS = ['machine-company', 'machine-model', 'machine-hp', 'machine-nozzles', 'machine-tank', 'machine-other'];
const shownDetails = () => DETAIL_IDS.filter(id => screen.queryByTestId(id) !== null);

afterEach(() => cleanup());

describe('यंत्रं — the machine form', () => {
    it('offers the six types in the founder\'s order', () => {
        render(<MachinesSection profile={profileWith()} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        const chips = Array.from(screen.getByTestId('machine-form').querySelectorAll('[data-testid^="machine-type-"]')).map(el => el.textContent);
        expect(chips).toEqual(['ट्रॅक्टर', 'ब्लोअर', 'फवारणी यंत्र', 'रोटाव्हेटर', 'हार्वेस्टर', 'इतर']);
    });

    it('a machine saves with the name only', () => {
        const onUpdate = vi.fn();
        render(<MachinesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        expect(screen.getByTestId('machine-save')).toBeDisabled();
        type('जुनं यंत्र');
        fireEvent.click(screen.getByTestId('machine-save'));
        const [m] = saved(onUpdate);
        expect(m.name).toBe('जुनं यंत्र');
        expect(m.id).toMatch(/^mach_/);
        for (const k of ['company', 'model', 'hp', 'nozzleCount', 'capacity', 'otherDetails'] as const) expect(m[k]).toBeUndefined();
    });

    it('the tractor block is कंपनी, मॉडेल, HP — never nozzles, never a tank', () => {
        render(<MachinesSection profile={profileWith()} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        fireEvent.click(screen.getByTestId('machine-type-Tractor'));
        expect(shownDetails()).toEqual(['machine-company', 'machine-model', 'machine-hp']);
        expect(screen.getByTestId('machine-form')).not.toHaveTextContent('नोझल');
        expect(screen.getByTestId('machine-form')).not.toHaveTextContent('टाकी');
    });

    it('blower and sprayer: कंपनी, मॉडेल, नोझलची संख्या, टाकी (लिटर) and one free line; the others: कंपनी, मॉडेल', () => {
        render(<MachinesSection profile={profileWith()} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        for (const t of ['Blower', 'Sprayer']) {
            fireEvent.click(screen.getByTestId(`machine-type-${t}`));
            expect(shownDetails()).toEqual(['machine-company', 'machine-model', 'machine-nozzles', 'machine-tank', 'machine-other']);
            expect(screen.getByTestId('machine-form')).toHaveTextContent('नोझलची संख्या');
            expect(screen.getByTestId('machine-form')).toHaveTextContent('टाकी (लिटर)');
        }
        for (const t of ['Rotavator', 'Harvester', 'Other']) {
            fireEvent.click(screen.getByTestId(`machine-type-${t}`));
            expect(shownDetails()).toEqual(['machine-company', 'machine-model']);
        }
    });

    it('a blower saves its details; a detail typed for another type is not saved', () => {
        const onUpdate = vi.fn();
        render(<MachinesSection profile={profileWith()} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('machine-add'));
        type('मित्रा ब्लोअर');
        fireEvent.click(screen.getByTestId('machine-type-Tractor'));
        field('machine-hp', '45');
        fireEvent.click(screen.getByTestId('machine-type-Blower'));
        field('machine-company', 'मित्रा');
        field('machine-model', 'टर्बो 600');
        field('machine-nozzles', '4');
        field('machine-tank', '600');
        field('machine-other', 'दोन्ही बाजूंनी फवारा');
        fireEvent.click(screen.getByTestId('machine-save'));
        const [m] = saved(onUpdate);
        expect(m).toMatchObject({ name: 'मित्रा ब्लोअर', type: 'Blower', company: 'मित्रा', model: 'टर्बो 600', nozzleCount: 4, capacity: 600, otherDetails: 'दोन्ही बाजूंनी फवारा' });
        expect(m.hp).toBeUndefined();
    });

    it('edit keeps the machine\'s id and its place in the list', () => {
        const onUpdate = vi.fn();
        render(<MachinesSection profile={profileWith([
            { id: 'm1', name: 'जॉन डियर', type: 'Tractor', ownership: 'Owned', hp: 45 },
            { id: 'm2', name: 'फवारा', type: 'Sprayer', ownership: 'Rented' },
        ])} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('machine-edit-m1'));
        expect((screen.getByTestId('machine-name') as HTMLInputElement).value).toBe('जॉन डियर');
        expect((screen.getByTestId('machine-hp') as HTMLInputElement).value).toBe('45');
        type('जॉन डियर 5050');
        field('machine-company', 'जॉन डियर');
        fireEvent.click(screen.getByTestId('machine-save'));
        const list = saved(onUpdate);
        expect(list.map(m => m.id)).toEqual(['m1', 'm2']);
        expect(list[0]).toMatchObject({ id: 'm1', name: 'जॉन डियर 5050', company: 'जॉन डियर', hp: 45, type: 'Tractor' });
    });

    it('a machine saved before these fields existed loads, shows, and keeps what it had through an edit', () => {
        const onUpdate = vi.fn();
        const old = { id: 'old', name: 'जुना ट्रॅक्टर', type: 'Tractor', ownership: 'Owned', capacity: 600 } as FarmMachinery;
        render(<MachinesSection profile={profileWith([old])} onUpdate={onUpdate} />);
        expect(screen.getByTestId('machine-old')).toHaveTextContent('स्वतःचं · ट्रॅक्टर · टाकी 600 लिटर');
        fireEvent.click(screen.getByTestId('machine-edit-old'));
        expect(within(screen.getByTestId('machine-form')).getByText('यंत्र बदला')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('machine-save'));
        expect(saved(onUpdate)).toEqual([{ id: 'old', name: 'जुना ट्रॅक्टर', type: 'Tractor', ownership: 'Owned', capacity: 600 }]);
    });

    it('the card says the details in plain words', () => {
        render(<MachinesSection profile={profileWith([
            { id: 'b', name: 'मित्रा ब्लोअर', type: 'Blower', ownership: 'Owned', company: 'मित्रा', model: 'टर्बो', nozzleCount: 4, capacity: 600, otherDetails: 'दोन्ही बाजूंनी' },
            { id: 't', name: 'ट्रॅक्टर', type: 'Tractor', ownership: 'Rented', hp: 45 },
        ])} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('machine-b')).toHaveTextContent('स्वतःचं · ब्लोअर · मित्रा टर्बो · 4 नोझल · टाकी 600 लिटर');
        expect(screen.getByTestId('machine-b')).toHaveTextContent('दोन्ही बाजूंनी');
        expect(screen.getByTestId('machine-t')).toHaveTextContent('भाड्याचं · ट्रॅक्टर · 45 HP');
    });
});
