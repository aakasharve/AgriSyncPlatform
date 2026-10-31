/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-61 = 5A + rule TAP-1) — the small sheets of
 * "किंवा दाबून बदला" (the working phones' 5A): one part's value changed by tapping, "काय जोडायचं?" for "+ आणखी जोडा", and
 * "जे बदलायचं ते लिहा" (typed words, read like speech). Each has its own "रद्द" / "ठीक" inside it (rule FOOT-1: nothing
 * behind the bottom bar). Presentational: the screen applies what he chose to its working copy.
 */
import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { CropActivityEvent, InputEvent, IrrigationEvent, LabourEvent } from '../../../../types';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { PHONE_COLUMN } from '../phoneColumn';
import { partNameIn } from '../voiceResult/partNames';
import { correctionWords } from './correctionWords';
import {
    ADD_KINDS, UNIT_CHOICES, WATER_METHODS, WORK_CHOICES, methodName, productFace, setCount, setProduct, setWater, setWork, unitName,
    type AddKind, type TapBucket,
} from './tapEdit';

const SANS = "'Noto Sans Devanagari', sans-serif";

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; testId: string }> = ({ title, onClose, children, testId }) => {
    useBackDismiss(true, onClose);
    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45" onClick={onClose} data-testid={testId} style={{ fontFamily: SANS }}>
            <div className={`max-h-[92%] overflow-y-auto rounded-t-[28px] bg-white p-4 pb-6 shadow-2xl ${PHONE_COLUMN}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
                <h3 className="m-0 mb-3 text-[19px] font-extrabold text-stone-900">{title}</h3>
                {children}
            </div>
        </div>
    );
};

const Chip: React.FC<{ on: boolean; onClick: () => void; testId: string; children: React.ReactNode }> = ({ on, onClick, testId, children }) => (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={on}
        className={`min-h-[44px] rounded-full border-2 px-3.5 text-[15px] font-extrabold ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-stone-200 bg-white text-stone-700'}`}>
        {children}
    </button>
);

const Stepper: React.FC<{ value: number | undefined; step: number; min: number; onChange: (n: number) => void; testId: string; dash: string }> = ({ value, step, min, onChange, testId, dash }) => (
    <div className="flex items-center gap-3" data-testid={testId}>
        <button type="button" onClick={() => onChange(Math.max(min, +((value ?? min + step) - step).toFixed(2)))} data-testid={`${testId}-minus`} aria-label="−"
            className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-800"><Minus size={22} aria-hidden="true" /></button>
        <b className="min-w-[56px] text-center text-[22px] font-extrabold text-stone-900" data-testid={`${testId}-value`}>{value ?? dash}</b>
        <button type="button" onClick={() => onChange(+((value ?? 0) + step).toFixed(2))} data-testid={`${testId}-plus`} aria-label="+"
            className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-800"><Plus size={22} aria-hidden="true" /></button>
    </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="mb-1.5 mt-3 text-[14px] font-extrabold text-stone-700">{children}</div>;

const Actions: React.FC<{ onCancel: () => void; onOk: () => void; okDisabled?: boolean }> = ({ onCancel, onOk, okDisabled }) => {
    const w = correctionWords(useOptionalLanguage()?.language);
    return (
        <div className="mt-4 flex gap-2">
            <button type="button" onClick={onCancel} data-testid="tap-sheet-cancel" className="min-h-[52px] flex-1 rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">{w.cancel}</button>
            <button type="button" onClick={onOk} disabled={okDisabled} data-testid="tap-sheet-ok" className="min-h-[52px] flex-1 rounded-2xl bg-emerald-700 text-[16px] font-extrabold text-white disabled:bg-stone-300">{w.ok}</button>
        </div>
    );
};

export interface TapEditSheetProps {
    bucket: TapBucket;
    item: unknown;
    /** No internet now, and a worker count cannot be queued yet: say so in the sheet (`correctionCapabilities`). */
    labourNeedsNet?: boolean;
    onOk: (item: unknown) => void;
    onCancel: () => void;
}

/** One part's value, by tapping. */
export const TapEditSheet: React.FC<TapEditSheetProps> = ({ bucket, item, labourNeedsNet, onOk, onCancel }) => {
    const language = useOptionalLanguage()?.language;
    const w = correctionWords(language);
    const part = bucket === 'cropActivities' ? 'crop' : bucket === 'inputs' ? 'inputs' : bucket === 'irrigation' ? 'irrigation' : 'labour';
    const title = w.editTitle(partNameIn(part, language));
    const [work, setWorkState] = useState<string | undefined>(() => (bucket === 'cropActivities' ? WORK_CHOICES.find(([en, mr]) => (item as CropActivityEvent).workTypes?.includes(en) || (item as CropActivityEvent).title === mr)?.[0] : undefined));
    const [face, setFace] = useState(() => (bucket === 'inputs' ? productFace(item as InputEvent) : { name: '' }));
    const [method, setMethod] = useState<string | undefined>(() => (bucket === 'irrigation' ? (item as IrrigationEvent).method : undefined));
    const [hours, setHours] = useState<number | undefined>(() => (bucket === 'irrigation' ? (item as IrrigationEvent).durationHours : undefined));
    const [count, setCountState] = useState<number | undefined>(() => (bucket === 'labour' ? (item as LabourEvent).count : undefined));

    if (bucket === 'cropActivities') {
        return (
            <Sheet title={title} onClose={onCancel} testId="tap-sheet-crop">
                <Label>{w.whatWork}</Label>
                <div className="flex flex-wrap gap-2">
                    {WORK_CHOICES.map(([en, mr]) => <Chip key={en} on={work === en} onClick={() => setWorkState(en)} testId={`tap-work-${en}`}>{language === 'en' ? en : mr}</Chip>)}
                </div>
                <Actions onCancel={onCancel} okDisabled={!work} onOk={() => {
                    const hit = WORK_CHOICES.find(([en]) => en === work);
                    if (hit) onOk(setWork(item as CropActivityEvent, hit[0], hit[1]));
                }} />
            </Sheet>
        );
    }
    if (bucket === 'inputs') {
        return (
            <Sheet title={title} onClose={onCancel} testId="tap-sheet-inputs">
                <Label>{w.productName}</Label>
                <input value={face.name} onChange={e => setFace(f => ({ ...f, name: e.target.value }))} data-testid="tap-product-name"
                    className="min-h-[52px] w-full rounded-xl border-2 border-stone-300 px-3 text-[17px] font-bold text-stone-900 outline-none focus:border-emerald-600" />
                <Label>{w.amount}</Label>
                <input inputMode="decimal" value={face.qty ?? ''} data-testid="tap-product-qty"
                    onChange={e => { const n = Number(e.target.value); setFace(f => ({ ...f, qty: e.target.value === '' || !Number.isFinite(n) ? undefined : n })); }}
                    className="min-h-[52px] w-40 rounded-xl border-2 border-stone-300 px-3 text-[18px] font-extrabold text-stone-900 outline-none focus:border-emerald-600" />
                <Label>{w.unit}</Label>
                <div className="flex flex-wrap gap-2">
                    {UNIT_CHOICES.map(u => <Chip key={u} on={face.unit === u} onClick={() => setFace(f => ({ ...f, unit: u }))} testId={`tap-unit-${u}`}>{unitName(u, language)}</Chip>)}
                </div>
                {!face.name.trim() && <p className="m-0 mt-2 text-[13.5px] font-bold text-amber-800" data-testid="tap-name-needed">{w.nameNeeded}</p>}
                <Actions onCancel={onCancel} okDisabled={!face.name.trim()} onOk={() => onOk(setProduct(item as InputEvent, face))} />
            </Sheet>
        );
    }
    if (bucket === 'irrigation') {
        return (
            <Sheet title={title} onClose={onCancel} testId="tap-sheet-irrigation">
                <Label>{w.waterHow}</Label>
                <div className="flex flex-wrap gap-2">
                    {WATER_METHODS.map(m => <Chip key={m} on={method === m} onClick={() => setMethod(m)} testId={`tap-method-${m}`}>{methodName(m, language)}</Chip>)}
                </div>
                <Label>{w.hours}</Label>
                <Stepper value={hours} step={0.5} min={0.5} onChange={setHours} testId="tap-hours" dash="—" />
                <Actions onCancel={onCancel} onOk={() => onOk(setWater(item as IrrigationEvent, method, hours))} />
            </Sheet>
        );
    }
    return (
        <Sheet title={title} onClose={onCancel} testId="tap-sheet-labour">
            <Label>{w.people}</Label>
            <Stepper value={count} step={1} min={1} onChange={setCountState} testId="tap-count" dash="—" />
            {labourNeedsNet && <p className="m-0 mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[14px] font-bold text-amber-900" data-testid="tap-labour-needs-net">{w.labourNeedsNet}</p>}
            <Actions onCancel={onCancel} okDisabled={count === undefined} onOk={() => onOk(setCount(item as LabourEvent, count ?? 0))} />
        </Sheet>
    );
};

/** "+ आणखी जोडा": what to add (crop work, water, a product — never workers: no route can add an engagement). */
export const AddKindSheet: React.FC<{ onPick: (kind: AddKind) => void; onCancel: () => void }> = ({ onPick, onCancel }) => {
    const language = useOptionalLanguage()?.language;
    const w = correctionWords(language);
    const partOf: Record<AddKind, 'crop' | 'irrigation' | 'inputs'> = { cropActivities: 'crop', irrigation: 'irrigation', inputs: 'inputs' };
    return (
        <Sheet title={w.addWhat} onClose={onCancel} testId="tap-sheet-add">
            <div className="flex flex-wrap gap-2">
                {ADD_KINDS.map(k => <Chip key={k} on={false} onClick={() => onPick(k)} testId={`tap-add-${k}`}>{partNameIn(partOf[k], language)}</Chip>)}
            </div>
            <button type="button" onClick={onCancel} data-testid="tap-sheet-cancel" className="mt-4 min-h-[52px] w-full rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">{w.cancel}</button>
        </Sheet>
    );
};

/** "जे बदलायचं ते लिहा": typed words, sent to the same understanding as speech. */
export const TypeChangeSheet: React.FC<{ onSend: (text: string) => void; onCancel: () => void }> = ({ onSend, onCancel }) => {
    const language = useOptionalLanguage()?.language;
    const w = correctionWords(language);
    const [text, setText] = useState('');
    return (
        <Sheet title={w.typeTitle} onClose={onCancel} testId="tap-sheet-type">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} data-testid="tap-type-input" placeholder={w.examples[0]}
                className="w-full resize-none rounded-2xl border-2 border-stone-300 p-3 text-[17px] leading-relaxed text-stone-900 outline-none focus:border-emerald-600" />
            <p className="m-0 mt-1.5 text-[13.5px] font-bold text-stone-600">{w.typeNote}</p>
            <Actions onCancel={onCancel} okDisabled={text.trim().length < 3} onOk={() => onSend(text.trim())} />
        </Sheet>
    );
};
