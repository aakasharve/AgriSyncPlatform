/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "यंत्रं" — the farm's own and rented machines.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look on the REAL
 * `profile.machineries`: each machine (name, own/rented, type, tank litres), remove it, add one
 * (`AddMachineWizard`). Every change goes out through `onUpdate` (the page's `onUpdateProfile`).
 * Machines are saved on this phone only (I3), and the page says so.
 */
import React, { useState } from 'react';
import { Plus, Tractor, Trash2, Wrench } from 'lucide-react';
import type { FarmerProfile, FarmMachinery } from '../../../domain/types/farm.types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import AddMachineWizard from '../components/AddMachineWizard';
import { BigButton, GlassCard, IconDot, Tap, ThisPhoneOnly } from '../components/hubUi';
import { MACHINE_TYPE_LABEL, OWNERSHIP_LABEL } from '../components/setupLabels';

interface MachinesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

const EMPTY_DRAFT: Partial<FarmMachinery> = { type: 'Tractor', ownership: 'Owned' };

const MachinesSection: React.FC<MachinesSectionProps> = ({ profile, onUpdate }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newMachine, setNewMachine] = useState<Partial<FarmMachinery>>(EMPTY_DRAFT);
    const machines = profile.machineries || [];

    const addMachine = () => {
        const name = newMachine.name?.trim();
        if (!name) return;
        const machine: FarmMachinery = {
            id: `mach_${idGenerator.generate()}`,
            name,
            type: newMachine.type || 'Tractor',
            ownership: newMachine.ownership || 'Owned',
            capacity: newMachine.capacity,
        };
        onUpdate({ ...profile, machineries: [...machines, machine] });
        setIsAdding(false);
        setNewMachine(EMPTY_DRAFT);
    };

    const deleteMachine = (id: string) => {
        onUpdate({ ...profile, machineries: machines.filter(m => m.id !== id) });
    };

    return (
        <div className="space-y-3" data-testid="hub-machines">
            <ThisPhoneOnly />
            {machines.map(m => (
                <GlassCard key={m.id} testId={`machine-${m.id}`}>
                    <div className="flex items-center gap-3">
                        <IconDot tone="amber">{m.type === 'Tractor' ? <Tractor size={22} aria-hidden="true" /> : <Wrench size={22} aria-hidden="true" />}</IconDot>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[16px] font-extrabold text-stone-900">{m.name}</p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-600">
                                {OWNERSHIP_LABEL[m.ownership] ?? m.ownership} · {MACHINE_TYPE_LABEL[m.type] ?? m.type}
                                {m.capacity ? ` · टाकी ${m.capacity} लिटर` : ''}
                            </p>
                        </div>
                        <Tap onClick={() => deleteMachine(m.id)} aria-label="हे यंत्र काढा" data-testid={`machine-remove-${m.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200"><Trash2 size={18} aria-hidden="true" /></Tap>
                    </div>
                </GlassCard>
            ))}
            {machines.length === 0 && !isAdding && (
                <GlassCard testId="machines-empty">
                    <p className="m-0 text-[15px] font-bold text-stone-700">अजून एकही यंत्र जोडलेलं नाही.</p>
                </GlassCard>
            )}
            {isAdding ? (
                <AddMachineWizard newMachine={newMachine} onChange={setNewMachine} onSave={addMachine}
                    onCancel={() => { setIsAdding(false); setNewMachine(EMPTY_DRAFT); }} />
            ) : (
                <BigButton onClick={() => setIsAdding(true)} tone="white" testId="machine-add"><Plus size={20} aria-hidden="true" />यंत्र जोडा</BigButton>
            )}
        </div>
    );
};

export default MachinesSection;
