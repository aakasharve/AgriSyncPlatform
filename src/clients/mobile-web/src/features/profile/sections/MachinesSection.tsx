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
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, P6). Once the server has sent the OPEN farm's set, the page lists THAT farm's machines
 * (machines belong to the whole farm) and every change goes through the farm-setup doors: a new machine gets a bare GUID, a change keeps the id and
 * sends the revision the phone last received, a removal is a state on the server. The honest lines replace "फक्त या फोनवर…"; a person who may not
 * change the farm setup reads only. Before the server has sent the farm's set the page is the phone-only page it was.
 */
import React, { useState } from 'react';
import { Pencil, Plus, Tractor, Trash2, Wrench } from 'lucide-react';
import type { FarmerProfile, FarmMachinery } from '../../../domain/types/farm.types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import AddMachineWizard from '../components/AddMachineWizard';
import { BigButton, GlassCard, IconDot, Tap, ThisPhoneOnly } from '../../../shared/components/ui/placeUi';
import { MACHINE_DETAILS, MACHINE_DETAIL_KEYS, machineLine } from '../components/setupLabels';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FarmSetupRefusal, LocalFarmSetup } from '../farmSetup/farmSetupLocal';
import { closeRefusedChange, removeMachine, saveMachine } from '../farmSetup/farmSetupCommands';
import { formOfMachinePayload, machineInputOf, toMachinery } from '../farmSetup/farmSetupView';
import { PageWaitingLine, ReadOnlyLine, RefusedBox, SetupMessage, WaitingLine, saveProblemWords } from '../farmSetup/FarmSetupLines';

/** Repair FIX-1 round 1 (Bug 5) — the page's own words, one language at a time (Marathi exactly as before; English PROPOSED). */
const PAGE_WORDS = {
    mr: { edit: 'हे यंत्र बदला', remove: 'हे यंत्र काढा', empty: 'अजून एकही यंत्र जोडलेलं नाही.', add: 'यंत्र जोडा' },
    en: { edit: 'Change this machine', remove: 'Remove this machine', empty: 'No machine added yet.', add: 'Add a machine' },
} as const;

interface MachinesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
    /** repair D-9 - the OPEN farm's set (absent / not received: the phone-only page; null: still being read, nothing to tap). */
    farmSetup?: LocalFarmSetup | null;
    /** repair D-9 - may change the farm setup on this farm (absent = yes). */
    canEdit?: boolean;
    /** repair D-9 (P10) - the move question of what this phone held before (server mode only). */
    moveCard?: React.ReactNode;
}

interface MachineView { machine: FarmMachinery; state: 'saved' | 'waiting' | 'refused'; refusal: FarmSetupRefusal | null }

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

const MachinesSection: React.FC<MachinesSectionProps> = ({ profile, onUpdate, farmSetup, canEdit = true, moveCard }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? PAGE_WORDS.en : PAGE_WORDS.mr;
    const [isAdding, setIsAdding] = useState(false);
    /** The machine being changed (its id), or null. */
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newMachine, setNewMachine] = useState<Partial<FarmMachinery>>(EMPTY_DRAFT);
    const [message, setMessage] = useState<string | null>(null);
    const server = farmSetup?.received === true ? farmSetup : null;
    const mayEdit = server ? canEdit : true;
    const views: MachineView[] = server
        ? server.machines.map(m => ({ machine: toMachinery(m.item), state: m.state, refusal: m.refusal }))
        : (profile.machineries || []).map(machine => ({ machine, state: 'saved', refusal: null }));
    const machines = views.map(v => v.machine);

    const closeForm = () => { setIsAdding(false); setEditingId(null); setNewMachine(EMPTY_DRAFT); };

    /** A change through the farm-setup door; one that cannot be queued says why and keeps the form. */
    const send = async (change: () => Promise<unknown>): Promise<boolean> => {
        try {
            await change();
            setMessage(null);
            return true;
        } catch (error) {
            const said = saveProblemWords(error, language);
            if (said) { setMessage(said); return false; }
            throw error;
        }
    };

    const saveThisMachine = async () => {
        if (!newMachine.name?.trim()) return;
        if (server) {
            const id = editingId ?? idGenerator.generate();
            const original = editingId ? machines.find(m => m.id === editingId) : undefined;
            if (!(await send(() => saveMachine(machineInputOf(server.farmId, toMachine(id, newMachine, original)))))) return;
        } else if (editingId) {
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

    const deleteMachine = async (id: string) => {
        if (server) {
            await send(() => removeMachine({ farmId: server.farmId, machineId: id }));
            return;
        }
        onUpdate({ ...profile, machineries: machines.filter(m => m.id !== id) });
    };

    /** "माझा बदल पुन्हा करा": the refused change is closed and the form opens with what he typed, on the new version. */
    const redo = async (refusal: FarmSetupRefusal) => {
        await closeRefusedChange(refusal.rowId);
        const typed = formOfMachinePayload(refusal.payload);
        setIsAdding(false);
        setEditingId(typed.id);
        setNewMachine({ ...typed });
    };

    const form = (
        <AddMachineWizard newMachine={newMachine} onChange={setNewMachine} onSave={() => { void saveThisMachine(); }} onCancel={closeForm} editing={editingId !== null} />
    );

    if (farmSetup === null) return <div className="space-y-3" data-testid="hub-machines" aria-busy="true" />;

    return (
        <div className="space-y-3" data-testid="hub-machines">
            {server ? <PageWaitingLine count={server.waitingCount} language={language} /> : <ThisPhoneOnly language={language} />}
            {server && !mayEdit && <ReadOnlyLine language={language} />}
            {server && moveCard}
            <SetupMessage text={message} />
            {views.map(({ machine: m, state, refusal }) => (m.id === editingId ? <React.Fragment key={m.id}>{form}</React.Fragment> : (
                <GlassCard key={m.id} testId={`machine-${m.id}`}>
                    <div className="flex items-center gap-3">
                        <IconDot tone="amber">{m.type === 'Tractor' ? <Tractor size={22} aria-hidden="true" /> : <Wrench size={22} aria-hidden="true" />}</IconDot>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[16px] font-extrabold text-stone-900">{m.name}</p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-600">{machineLine(m, language)}</p>
                            {m.otherDetails && <p className="m-0 text-[13.5px] font-semibold text-stone-600 [overflow-wrap:anywhere]">{m.otherDetails}</p>}
                        </div>
                        {mayEdit && <Tap onClick={() => startEdit(m)} aria-label={words.edit} data-testid={`machine-edit-${m.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-600 ring-1 ring-stone-200"><Pencil size={17} aria-hidden="true" /></Tap>}
                        {mayEdit && <Tap onClick={() => { void deleteMachine(m.id); }} aria-label={words.remove} data-testid={`machine-remove-${m.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200"><Trash2 size={18} aria-hidden="true" /></Tap>}
                    </div>
                    {state === 'waiting' && <WaitingLine language={language} />}
                    {refusal && <RefusedBox refusal={refusal} language={language} onSeeNew={() => { void closeRefusedChange(refusal.rowId); }}
                        onRedo={mayEdit && refusal.mutationType.endsWith('.save') ? () => { void redo(refusal); } : undefined} />}
                </GlassCard>
            )))}
            {machines.length === 0 && !isAdding && (
                <GlassCard testId="machines-empty">
                    <p className="m-0 text-[15px] font-bold text-stone-700">{words.empty}</p>
                </GlassCard>
            )}
            {isAdding ? form : editingId === null && mayEdit && (
                <BigButton onClick={() => setIsAdding(true)} tone="white" testId="machine-add"><Plus size={20} aria-hidden="true" />{words.add}</BigButton>
            )}
        </div>
    );
};

export default MachinesSection;
