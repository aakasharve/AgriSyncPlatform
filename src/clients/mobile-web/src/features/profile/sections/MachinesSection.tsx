/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Machines tab section.
 *
 * Extracted verbatim from `pages/ProfilePage.tsx`'s MachineryManager. The
 * AddMachineWizard component lives at `../components/AddMachineWizard.tsx`
 * and renders the inline add form when triggered.
 */

import React, { useState } from 'react';
import { Plus, Trash2, X, Tractor, Wrench } from 'lucide-react';
import { FarmerProfile, FarmMachinery } from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { useLanguage } from '../../../i18n/LanguageContext';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import AddMachineWizard from '../components/AddMachineWizard';

interface MachinesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

const MachinesSection: React.FC<MachinesSectionProps> = ({ profile, onUpdate }) => {
    const { t } = useLanguage();
    const [isAdding, setIsAdding] = useState(false);
    const [newMachine, setNewMachine] = useState<Partial<FarmMachinery>>({ type: 'Tractor', ownership: 'Owned' });

    const addMachine = () => {
        if (!newMachine.name) return;
        const machine: FarmMachinery = {
            id: `mach_${idGenerator.generate()}`,
            name: newMachine.name,
            type: newMachine.type || 'Tractor',
            ownership: newMachine.ownership || 'Owned',
            capacity: newMachine.capacity
        };
        const updatedMachines = [...(profile.machineries || []), machine];
        onUpdate({ ...profile, machineries: updatedMachines });
        setIsAdding(false);
        setNewMachine({ type: 'Tractor', ownership: 'Owned' });
    };

    const deleteMachine = (id: string) => {
        const updatedMachines = (profile.machineries || []).filter(m => m.id !== id);
        onUpdate({ ...profile, machineries: updatedMachines });
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex justify-between items-center px-1">
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <Tractor size={24} className="text-orange-500" /> {t('profile.machinery')}
                </h3>
                <button onClick={() => setIsAdding(true)} className="text-emerald-600 font-bold text-xs flex items-center bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 hover:bg-emerald-100">
                    <Plus size={14} className="mr-1" /> {t('profile.addMachine')}
                </button>
            </div>

            <div className="grid gap-3">
                {(profile.machineries || []).map(m => (
                    <div key={m.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                                {m.type === 'Tractor' ? <Tractor size={20} /> : <Wrench size={20} />}
                            </div>
                            <div>
                                <p className="font-bold text-slate-800">{m.name}</p>
                                <p className="text-xs text-slate-500">
                                    {m.ownership} • {m.type}
                                    {m.capacity ? ` • ${m.capacity}L` : ''}
                                </p>
                            </div>
                        </div>
                        <button onClick={() => deleteMachine(m.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                ))}
                {(!profile.machineries || profile.machineries.length === 0) && (
                    <div className="p-6 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        {t('profile.noMachinery')}
                    </div>
                )}
            </div>

            {isAdding && (
                <AddMachineWizard
                    newMachine={newMachine}
                    onChange={setNewMachine}
                    onSave={addMachine}
                    onCancel={() => setIsAdding(false)}
                />
            )}
        </div>
    );
};

export default MachinesSection;
