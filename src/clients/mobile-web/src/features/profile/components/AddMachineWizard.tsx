/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from MachineryManager's inline add form
 * in `pages/ProfilePage.tsx`. Used only by MachinesSection.
 */

import React from 'react';
import { X, Cylinder } from 'lucide-react';
import { FarmMachinery } from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { useLanguage } from '../../../i18n/LanguageContext';

interface AddMachineWizardProps {
    newMachine: Partial<FarmMachinery>;
    onChange: (m: Partial<FarmMachinery>) => void;
    onSave: () => void;
    onCancel: () => void;
}

const AddMachineWizard: React.FC<AddMachineWizardProps> = ({ newMachine, onChange, onSave, onCancel }) => {
    const { t } = useLanguage();
    return (
        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-lg animate-in fade-in ring-1 ring-emerald-50 space-y-3">
            <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-emerald-600 uppercase">{t('profile.newMachine')}</h4>
                <button onClick={onCancel}><X size={16} className="text-slate-400" /></button>
            </div>
            <input
                placeholder="Name (e.g. John Deere 5050)"
                autoFocus
                className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-emerald-500"
                value={newMachine.name || ''}
                onChange={e => onChange({ ...newMachine, name: e.target.value })}
            />
            <div className="flex gap-2">
                <select
                    className="flex-1 p-2.5 border border-slate-200 rounded-xl bg-white text-sm outline-none"
                    value={newMachine.type}
                    onChange={e => onChange({ ...newMachine, type: e.target.value as FarmMachinery['type'] })}
                >
                    <option value="Tractor">Tractor</option>
                    <option value="Sprayer">Sprayer</option>
                    <option value="Rotavator">Rotavator</option>
                    <option value="Harvester">Harvester</option>
                </select>
                <select
                    className="w-32 p-2.5 border border-slate-200 rounded-xl bg-white text-sm outline-none"
                    value={newMachine.ownership}
                    onChange={e => onChange({ ...newMachine, ownership: e.target.value as FarmMachinery['ownership'] })}
                >
                    <option value="Owned">{t('profile.owned')}</option>
                    <option value="Rented">{t('profile.rented')}</option>
                </select>
            </div>

            {/* Capacity for Sprayers */}
            {(newMachine.type === 'Sprayer' || newMachine.type === 'Tractor') && (
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">{t('profile.tankCapacity')}</label>
                    <div className="relative">
                        <input
                            type="number"
                            placeholder={newMachine.type === 'Sprayer' ? 'e.g. 200' : 'e.g. 600'}
                            className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-emerald-500 pl-9"
                            value={newMachine.capacity || ''}
                            onChange={e => onChange({ ...newMachine, capacity: parseFloat(e.target.value) })}
                        />
                        <Cylinder size={16} className="absolute left-3 top-4 text-slate-400" />
                    </div>
                </div>
            )}

            <Button onClick={onSave} className="w-full py-3 text-xs">{t('profile.saveMachine')}</Button>
        </div>
    );
};

export default AddMachineWizard;
