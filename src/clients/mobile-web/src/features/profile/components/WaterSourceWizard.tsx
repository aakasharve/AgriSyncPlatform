/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "नवीन पाण्याचा स्रोत" — the two-step form for a water source and its motors.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). Redrawn in the approved look with
 * every real field kept: 1. name (required) + type; 2. the motor(s) on it — name, HP, फेज, वीज कुठून,
 * ठिबक (pipe size, filter, flow) — up to 4, any number on a शेततळं; a motor without a name or HP is
 * left out. New: it can also open pre-filled (`initial`) to CHANGE a source and its motors — the ids
 * and every stored field the form does not show are kept. Saving hands the result to `onSave`.
 */
import React, { useState } from 'react';
import { Droplets, Plus, Trash2 } from 'lucide-react';
import type { FarmMotor, WaterResource } from '../../../domain/types/farm.types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { ChoiceChips, GlassCard, Tap, TextField } from '../../../shared/components/ui/placeUi';
import { PIPE_SIZES, POWER_SOURCES, POWER_SOURCE_LABEL, SOURCE_TYPES, SOURCE_TYPE_LABEL, pipeLabel } from './setupLabels';

interface WaterSourceWizardProps {
    /** When set, the form changes this source and its motors instead of adding a new one. */
    initial?: { source: WaterResource; motors: FarmMotor[] };
    onSave: (source: WaterResource, motors: FarmMotor[]) => void;
    onCancel: () => void;
}

interface MotorDraft {
    key: string;
    base?: FarmMotor;
    name: string;
    hp: number;
    phase: FarmMotor['phase'];
    powerSourceType: FarmMotor['powerSourceType'];
    hasDrip: boolean;
    dripPipeSize: string;
    dripHasFilter: boolean;
    dripFlow: string;
}

const blankMotor = (): MotorDraft => ({
    key: idGenerator.generate(), name: '', hp: 5, phase: '3', powerSourceType: 'MSEB',
    hasDrip: false, dripPipeSize: '16mm', dripHasFilter: true, dripFlow: '',
});

const draftOf = (m: FarmMotor): MotorDraft => ({
    key: m.id, base: m, name: m.name, hp: m.hp, phase: m.phase, powerSourceType: m.powerSourceType,
    hasDrip: !!m.dripDetails, dripPipeSize: m.dripDetails?.pipeSize ?? '16mm', dripHasFilter: m.dripDetails?.hasFilter ?? true,
    dripFlow: m.dripDetails?.flowRatePerHour ? String(m.dripDetails.flowRatePerHour) : '',
});

/** The default a NEW motor has always been stored with. */
const NEW_MOTOR_SCHEDULE: NonNullable<FarmMotor['schedule']> = { windowStart: '22:00', windowEnd: '06:00', days: ['Daily'], rotationType: 'Weekly' };

const MotorEditor: React.FC<{ m: MotorDraft; n: number; onChange: (m: MotorDraft) => void; onRemove?: () => void }> = ({ m, n, onChange, onRemove }) => (
    <div className="space-y-2.5 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200" data-testid={`motor-edit-${n}`}>
        <div className="flex items-center justify-between">
            <p className="m-0 text-[14px] font-extrabold text-stone-700">मोटर {n}</p>
            {onRemove && <Tap onClick={onRemove} aria-label="ही मोटर काढा" data-testid={`motor-slot-remove-${n}`} className="grid h-10 w-10 place-items-center rounded-full text-rose-600"><Trash2 size={18} aria-hidden="true" /></Tap>}
        </div>
        <input value={m.name} onChange={e => onChange({ ...m, name: e.target.value })} placeholder="मोटरचं नाव (उदा. 5 HP सबमर्सिबल)" data-testid={`motor-name-${n}`}
            className="min-h-[50px] w-full rounded-xl bg-white px-3 text-[16px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-blue-500" />
        <label className="flex items-center gap-2 text-[14px] font-extrabold text-stone-700">HP
            <input type="number" inputMode="decimal" value={m.hp} onChange={e => onChange({ ...m, hp: parseFloat(e.target.value) || 0 })} data-testid={`motor-hp-${n}`}
                className="min-h-[46px] w-24 rounded-xl bg-white px-3 text-[17px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300" />
        </label>
        <p className="m-0 text-[13px] font-extrabold text-stone-600">फेज</p>
        <ChoiceChips testId={`motor-phase-${n}`} value={m.phase} onPick={v => onChange({ ...m, phase: v })} items={[['1', 'सिंगल फेज'], ['3', 'थ्री फेज']] as const} />
        <p className="m-0 text-[13px] font-extrabold text-stone-600">वीज कुठून</p>
        <ChoiceChips testId={`motor-power-${n}`} value={m.powerSourceType} onPick={v => onChange({ ...m, powerSourceType: v })}
            items={POWER_SOURCES.map(k => [k, POWER_SOURCE_LABEL[k]] as const)} />
        <p className="m-0 text-[13px] font-extrabold text-stone-600">ठिबक जोडलं आहे?</p>
        <ChoiceChips testId={`motor-drip-${n}`} value={m.hasDrip ? 'yes' : 'no'} onPick={v => onChange({ ...m, hasDrip: v === 'yes' })} items={[['yes', 'हो'], ['no', 'नाही']] as const} />
        {m.hasDrip && (
            <div className="space-y-2 rounded-xl bg-white p-2.5 ring-1 ring-blue-100">
                <p className="m-0 text-[13px] font-extrabold text-stone-600">नळीचा आकार</p>
                <ChoiceChips testId={`motor-pipe-${n}`} value={m.dripPipeSize} onPick={v => onChange({ ...m, dripPipeSize: v })}
                    items={PIPE_SIZES.map(s => [s, pipeLabel(s)] as const)} />
                <ChoiceChips testId={`motor-filter-${n}`} value={m.dripHasFilter ? 'yes' : 'no'} onPick={v => onChange({ ...m, dripHasFilter: v === 'yes' })}
                    items={[['yes', 'फिल्टर आहे'], ['no', 'फिल्टर नाही']] as const} />
                <label className="flex items-center gap-2 text-[13.5px] font-extrabold text-stone-700">पाणी (लिटर / तास)
                    <input type="number" inputMode="numeric" value={m.dripFlow} placeholder="उदा. 8000" onChange={e => onChange({ ...m, dripFlow: e.target.value })} data-testid={`motor-flow-${n}`}
                        className="min-h-[44px] w-28 rounded-xl bg-stone-50 px-2 text-[16px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300" />
                </label>
            </div>
        )}
    </div>
);

const WaterSourceWizard: React.FC<WaterSourceWizardProps> = ({ initial, onSave, onCancel }) => {
    const [step, setStep] = useState<1 | 2>(1);
    const [sourceName, setSourceName] = useState(initial?.source.name ?? '');
    const [sourceType, setSourceType] = useState<WaterResource['type']>(initial?.source.type ?? 'Well');
    const [sourceError, setSourceError] = useState('');
    const [motors, setMotors] = useState<MotorDraft[]>(() =>
        initial && initial.motors.length > 0 ? initial.motors.map(draftOf) : [blankMotor()]);

    const canAddMotor = sourceType === 'Farm Pond' || motors.length < 4;

    const handleNext = () => {
        if (!sourceName.trim()) {
            setSourceError('स्रोताचं नाव लिहा');
            return;
        }
        setSourceError('');
        setStep(2);
    };

    const handleSave = () => {
        const sourceId = initial?.source.id ?? `w_${idGenerator.generate()}`;
        const source: WaterResource = { isAvailable: true, ...initial?.source, id: sourceId, name: sourceName.trim(), type: sourceType };
        const validMotors = motors
            .filter(m => m.name.trim() && m.hp > 0)
            .map((m): FarmMotor => ({
                ...m.base,
                schedule: m.base ? m.base.schedule : { ...NEW_MOTOR_SCHEDULE, days: [...NEW_MOTOR_SCHEDULE.days] },
                id: m.base?.id ?? `m_${idGenerator.generate()}`,
                name: m.name.trim(),
                hp: m.hp,
                phase: m.phase,
                powerSourceType: m.powerSourceType,
                linkedWaterSourceId: sourceId,
                dripDetails: m.hasDrip ? { pipeSize: m.dripPipeSize, hasFilter: m.dripHasFilter, flowRatePerHour: Number(m.dripFlow) || undefined } : undefined,
            }));
        onSave(source, validMotors);
    };

    return (
        <GlassCard className="ring-2 ring-blue-300" testId="source-form">
            <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[17px] font-extrabold text-stone-900">{initial ? 'स्रोत बदला' : 'नवीन पाण्याचा स्रोत'}</p>
                <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-[12.5px] font-extrabold text-blue-800">पायरी {step} / 2</span>
            </div>
            {step === 1 ? (
                <div className="mt-3 space-y-3">
                    <TextField label="स्रोताचं नाव *" value={sourceName} placeholder="उदा. मोठी विहीर" testId="source-name" error={sourceError || undefined}
                        onChange={v => { setSourceName(v); if (sourceError) setSourceError(''); }} />
                    <p className="m-0 text-[13.5px] font-extrabold text-stone-700">प्रकार</p>
                    <ChoiceChips testId="source-type" value={sourceType} onPick={setSourceType} items={SOURCE_TYPES.map(k => [k, SOURCE_TYPE_LABEL[k]] as const)} />
                    <div className="grid grid-cols-2 gap-2 pt-1">
                        <Tap onClick={onCancel} data-testid="source-cancel" className="min-h-[50px] rounded-full bg-stone-100 text-[15px] font-extrabold text-stone-700">रद्द</Tap>
                        <Tap onClick={handleNext} data-testid="source-next" className="min-h-[50px] rounded-full bg-blue-700 text-[15px] font-extrabold text-white">पुढे — मोटर</Tap>
                    </div>
                </div>
            ) : (
                <div className="mt-3 space-y-3">
                    <p className="m-0 flex items-center gap-2 rounded-xl bg-blue-50 p-2.5 text-[15px] font-extrabold text-blue-900">
                        <Droplets size={18} aria-hidden="true" />{sourceName.trim()} · {SOURCE_TYPE_LABEL[sourceType]}
                    </p>
                    <p className="m-0 text-[13.5px] font-semibold text-stone-600">या स्रोतावरची मोटर. नाव नसलेली मोटर जतन होत नाही. शेततळ्यावर कितीही मोटर जोडता येतात.</p>
                    {motors.map((m, i) => (
                        <MotorEditor key={m.key} m={m} n={i + 1} onChange={x => setMotors(ms => ms.map(y => (y.key === m.key ? x : y)))}
                            onRemove={motors.length > 1 ? () => setMotors(ms => ms.filter(y => y.key !== m.key)) : undefined} />
                    ))}
                    {canAddMotor && (
                        <Tap onClick={() => setMotors(ms => [...ms, blankMotor()])} data-testid="motor-add"
                            className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-blue-400 text-[15px] font-extrabold text-blue-800">
                            <Plus size={18} aria-hidden="true" />आणखी मोटर
                        </Tap>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        <Tap onClick={() => setStep(1)} data-testid="source-back" className="min-h-[50px] rounded-full bg-stone-100 text-[15px] font-extrabold text-stone-700">मागे</Tap>
                        <Tap onClick={handleSave} data-testid="source-save" className="min-h-[50px] rounded-full bg-emerald-700 text-[15px] font-extrabold text-white">स्रोत जतन करा</Tap>
                    </div>
                </div>
            )}
        </GlassCard>
    );
};

export default WaterSourceWizard;
