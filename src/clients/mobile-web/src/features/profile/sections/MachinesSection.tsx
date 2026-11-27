/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "यंत्रं" — the farm's own and rented machines.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look on the REAL
 * `profile.machineries`: each machine (name, own/rented, type, its details), remove it, add one
 * (`AddMachineWizard`). Every change goes out through `onUpdate` (the page's `onUpdateProfile`).
 * Machines are saved on this phone only (I3), and the page says so.
 *
 * Repair FIX-1 item 7 (R2-A 17): each machine can be CHANGED, and keeps its id; the form asks the chosen type's optional
 * details. On save only the chosen type's details are kept — except a detail the machine ALREADY had and the form does not
 * show for its unchanged type (a tank saved on a tractor before), which stays exactly as it was: nothing he saved is dropped.
 */
import React, { useState } from 'react';
import { Pencil, Plus, Tractor, Trash2, Wrench } from 'lucide-react';
import type { FarmerProfile, FarmMachinery } from '../../../domain/types/farm.types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import AddMachineWizard from '../components/AddMachineWizard';
import { BigButton, GlassCard, IconDot, Tap, ThisPhoneOnly } from '../../../shared/components/ui/placeUi';
import { MACHINE_DETAILS, MACHINE_DETAIL_KEYS, machineLine } from '../components/setupLabels';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

/** Repair FIX-1 round 1 (Bug 5) — the page's own words, one language at a time (Marathi exactly as before; English PROPOSED). */
const PAGE_WORDS = {
    mr: { edit: 'हे यंत्र बदला', remove: 'हे यंत्र काढा', empty: 'अजून एकही यंत्र जोडलेलं नाही.', add: 'यंत्र जोडा' },
    en: { edit: 'Change this machine', remove: 'Remove this machine', empty: 'No machine added yet.', add: 'Add a machine' },
} as const;

interface MachinesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

const EMPTY_DRAFT: Partial<FarmMachinery> = { type: 'Tractor', ownership: 'Owned' };

const present = (v: unknown): boolean =>
    v != null && !(typeof v === 'number' && Number.isNaN(v)) && !(typeof v === 'string' && v.trim() === '');

/** The machine to store: name, type, own/rented, and the details that belong to its type (see the header). */
function toMachine(id: string, draft: Partial<FarmMachinery>, original?: FarmMachinery): FarmMachinery {
    const type = draft.type || 'Tractor';
    const machine: FarmMachinery = {
        ...(original?.defaultOperatorId ? { defaultOperatorId: original.defaultOperatorId } : {}),
        id,
        name: (draft.name ?? '').trim(),
        type,
        ownership: draft.ownership || 'Owned',
    };
    const asked = new Set(MACHINE_DETAILS[type]);
    const out = machine as unknown as Record<string, unknown>;
    for (const key of MACHINE_DETAIL_KEYS) {
        const value = draft[key];
        if (asked.has(key)) {
            if (present(value)) out[key] = typeof value === 'string' ? value.trim() : value;
        } else if (original && original.type === type && present(original[key])) {
            out[key] = original[key];
        }
    }
    return machine;
}

const MachinesSection: React.FC<MachinesSectionProps> = ({ profile, onUpdate }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? PAGE_WORDS.en : PAGE_WORDS.mr;
    const [isAdding, setIsAdding] = useState(false);
    /** The machine being changed (its id), or null. */
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newMachine, setNewMachine] = useState<Partial<FarmMachinery>>(EMPTY_DRAFT);
    const machines = profile.machineries || [];

    const closeForm = () => { setIsAdding(false); setEditingId(null); setNewMachine(EMPTY_DRAFT); };

    const saveMachine = () => {
        if (!newMachine.name?.trim()) return;
        if (editingId) {
            const original = machines.find(m => m.id === editingId);
            onUpdate({ ...profile, machineries: machines.map(m => (m.id === editingId ? toMachine(editingId, newMachine, original) : m)) });
        } else {
            onUpdate({ ...profile, machineries: [...machines, toMachine(`mach_${idGenerator.generate()}`, newMachine)] });
        }
        closeForm();
    };

    const startEdit = (m: FarmMachinery) => {
        setIsAdding(false);
        setEditingId(m.id);
        setNewMachine({ ...m });
    };

    const deleteMachine = (id: string) => {
        onUpdate({ ...profile, machineries: machines.filter(m => m.id !== id) });
    };

    const form = (
        <AddMachineWizard newMachine={newMachine} onChange={setNewMachine} onSave={saveMachine} onCancel={closeForm} editing={editingId !== null} />
    );

    return (
        <div className="space-y-3" data-testid="hub-machines">
            <ThisPhoneOnly language={language} />
            {machines.map(m => (m.id === editingId ? <React.Fragment key={m.id}>{form}</React.Fragment> : (
                <GlassCard key={m.id} testId={`machine-${m.id}`}>
                    <div className="flex items-center gap-3">
                        <IconDot tone="amber">{m.type === 'Tractor' ? <Tractor size={22} aria-hidden="true" /> : <Wrench size={22} aria-hidden="true" />}</IconDot>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[16px] font-extrabold text-stone-900">{m.name}</p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-600">{machineLine(m, language)}</p>
                            {m.otherDetails && <p className="m-0 text-[13.5px] font-semibold text-stone-600 [overflow-wrap:anywhere]">{m.otherDetails}</p>}
                        </div>
                        <Tap onClick={() => startEdit(m)} aria-label={words.edit} data-testid={`machine-edit-${m.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-600 ring-1 ring-stone-200"><Pencil size={17} aria-hidden="true" /></Tap>
                        <Tap onClick={() => deleteMachine(m.id)} aria-label={words.remove} data-testid={`machine-remove-${m.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200"><Trash2 size={18} aria-hidden="true" /></Tap>
                    </div>
                </GlassCard>
            )))}
            {machines.length === 0 && !isAdding && (
                <GlassCard testId="machines-empty">
                    <p className="m-0 text-[15px] font-bold text-stone-700">{words.empty}</p>
                </GlassCard>
            )}
            {isAdding ? form : editingId === null && (
                <BigButton onClick={() => setIsAdding(true)} tone="white" testId="machine-add"><Plus size={20} aria-hidden="true" />{words.add}</BigButton>
            )}
        </div>
    );
};

export default MachinesSection;
