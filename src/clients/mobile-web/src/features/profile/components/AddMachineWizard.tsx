/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "नवीन यंत्र" / "यंत्र बदला" — the machine form on the यंत्रं page.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look: name, type, own or rented.
 * Repair FIX-1 item 7 (R2-A 17, founder 27 Nov): the types ट्रॅक्टर, ब्लोअर, फवारणी यंत्र, रोटाव्हेटर, हार्वेस्टर, इतर; the
 * name stays the ONLY required field; after the type, that type's optional details (`MACHINE_DETAILS`): tractor कंपनी,
 * मॉडेल, HP; blower and sprayer कंपनी, मॉडेल, नोझलची संख्या, टाकी (लिटर) and one free line; the others कंपनी, मॉडेल.
 * It edits the draft it is given; MachinesSection saves it (and keeps only the chosen type's details).
 */
import React from 'react';
import { X } from 'lucide-react';
import type { FarmMachinery } from '../../../domain/types/farm.types';
import { BigButton, ChoiceChips, GlassCard, Tap, TextField } from '../../../shared/components/ui/placeUi';
import { MACHINE_DETAILS, MACHINE_DETAIL_FIELD, MACHINE_TYPES, setupWords, type MachineDetail } from './setupLabels';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

/** Repair FIX-1 round 1 (Bug 5) — the form's own words, one language at a time (Marathi exactly as before; English PROPOSED). */
const FORM_WORDS = {
    mr: { add: 'नवीन यंत्र', edit: 'यंत्र बदला', close: 'बंद करा', name: 'यंत्राचं नाव *', namePlaceholder: 'उदा. जॉन डियर 5050', type: 'प्रकार', save: 'यंत्र जतन करा' },
    en: { add: 'New machine', edit: 'Change machine', close: 'Close', name: 'Machine name *', namePlaceholder: 'e.g. John Deere 5050', type: 'Type', save: 'Save machine' },
} as const;

interface AddMachineWizardProps {
    newMachine: Partial<FarmMachinery>;
    onChange: (m: Partial<FarmMachinery>) => void;
    onSave: () => void;
    onCancel: () => void;
    /** Changing a saved machine (its id is kept): the title says so. */
    editing?: boolean;
}

const shown = (v: unknown): string => (v == null || (typeof v === 'number' && Number.isNaN(v)) ? '' : String(v));

const AddMachineWizard: React.FC<AddMachineWizardProps> = ({ newMachine, onChange, onSave, onCancel, editing = false }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? FORM_WORDS.en : FORM_WORDS.mr;
    const labels = setupWords(language);
    const type = newMachine.type ?? 'Tractor';
    const setDetail = (key: MachineDetail, raw: string) => {
        const kind = MACHINE_DETAIL_FIELD[key].kind;
        const value = raw === '' ? undefined : kind === 'number' ? parseFloat(raw) : raw;
        onChange({ ...newMachine, [key]: value });
    };
    return (
        <GlassCard className="ring-2 ring-amber-300" testId="machine-form">
            <div className="flex items-center justify-between">
                <p className="m-0 text-[17px] font-extrabold text-stone-900">{editing ? words.edit : words.add}</p>
                <Tap onClick={onCancel} aria-label={words.close} data-testid="machine-cancel" className="grid h-11 w-11 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200">
                    <X size={20} aria-hidden="true" />
                </Tap>
            </div>
            <div className="mt-3 space-y-3">
                <TextField label={words.name} value={newMachine.name || ''} placeholder={words.namePlaceholder} testId="machine-name"
                    onChange={v => onChange({ ...newMachine, name: v })} />
                <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{words.type}</p>
                <ChoiceChips testId="machine-type" value={type} onPick={v => onChange({ ...newMachine, type: v })}
                    items={MACHINE_TYPES.map(k => [k, labels.machineType[k]] as const)} />
                <ChoiceChips testId="machine-own" value={newMachine.ownership ?? 'Owned'} onPick={v => onChange({ ...newMachine, ownership: v })}
                    items={[['Owned', labels.ownership.Owned], ['Rented', labels.ownership.Rented]] as const} />
                {MACHINE_DETAILS[type].map(key => {
                    const f = MACHINE_DETAIL_FIELD[key];
                    const shownLabel = labels.detail[key];
                    return (
                        <TextField key={key} label={shownLabel.label} type={f.kind} value={shown(newMachine[key])} placeholder={shownLabel.placeholder}
                            testId={f.testId} onChange={v => setDetail(key, v)} />
                    );
                })}
                <BigButton onClick={onSave} testId="machine-save" disabled={!newMachine.name?.trim()}>{words.save}</BigButton>
            </div>
        </GlassCard>
    );
};

export default AddMachineWizard;
