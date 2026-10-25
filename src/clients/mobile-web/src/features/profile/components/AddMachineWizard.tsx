/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "नवीन यंत्र" — the add form on the यंत्रं page.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look with every real
 * field: name, type (ट्रॅक्टर / फवारणी यंत्र / रोटाव्हेटर / हार्वेस्टर), own or rented, and the tank in
 * litres for a sprayer or tractor. It edits the draft it is given; MachinesSection saves it.
 */
import React from 'react';
import { X } from 'lucide-react';
import type { FarmMachinery } from '../../../domain/types/farm.types';
import { BigButton, ChoiceChips, GlassCard, Tap, TextField } from '../../../shared/components/ui/placeUi';
import { MACHINE_TYPES, MACHINE_TYPE_LABEL, OWNERSHIP_LABEL } from './setupLabels';

interface AddMachineWizardProps {
    newMachine: Partial<FarmMachinery>;
    onChange: (m: Partial<FarmMachinery>) => void;
    onSave: () => void;
    onCancel: () => void;
}

const AddMachineWizard: React.FC<AddMachineWizardProps> = ({ newMachine, onChange, onSave, onCancel }) => {
    const type = newMachine.type ?? 'Tractor';
    const hasTank = type === 'Sprayer' || type === 'Tractor';
    return (
        <GlassCard className="ring-2 ring-amber-300" testId="machine-form">
            <div className="flex items-center justify-between">
                <p className="m-0 text-[17px] font-extrabold text-stone-900">नवीन यंत्र</p>
                <Tap onClick={onCancel} aria-label="बंद करा" data-testid="machine-cancel" className="grid h-11 w-11 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200">
                    <X size={20} aria-hidden="true" />
                </Tap>
            </div>
            <div className="mt-3 space-y-3">
                <TextField label="यंत्राचं नाव *" value={newMachine.name || ''} placeholder="उदा. जॉन डियर 5050" testId="machine-name"
                    onChange={v => onChange({ ...newMachine, name: v })} />
                <p className="m-0 text-[13.5px] font-extrabold text-stone-700">प्रकार</p>
                <ChoiceChips testId="machine-type" value={type} onPick={v => onChange({ ...newMachine, type: v })}
                    items={MACHINE_TYPES.map(k => [k, MACHINE_TYPE_LABEL[k]] as const)} />
                <ChoiceChips testId="machine-own" value={newMachine.ownership ?? 'Owned'} onPick={v => onChange({ ...newMachine, ownership: v })}
                    items={[['Owned', OWNERSHIP_LABEL.Owned], ['Rented', OWNERSHIP_LABEL.Rented]] as const} />
                {hasTank && (
                    <TextField label="टाकी (लिटर)" type="number" value={newMachine.capacity != null && !Number.isNaN(newMachine.capacity) ? String(newMachine.capacity) : ''}
                        placeholder={type === 'Sprayer' ? 'उदा. 200' : 'उदा. 600'} testId="machine-tank"
                        onChange={v => onChange({ ...newMachine, capacity: v === '' ? undefined : parseFloat(v) })} />
                )}
                <BigButton onClick={onSave} testId="machine-save" disabled={!newMachine.name?.trim()}>यंत्र जतन करा</BigButton>
            </div>
        </GlassCard>
    );
};

export default AddMachineWizard;
