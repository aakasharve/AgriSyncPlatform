/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; founder D-24, D-24a, D-24c, D-26, D-29, D-30, TAP-1, CTX-1, R15) -
 * "कामाचे नियोजन": the form, ported from the 25 Oct preview (`postVoiceResult/PlanWork.tsx`) onto the real task record.
 *
 *   1. काम काय आहे?   the mic FIRST (the log's own recorder, `PlanMic`); what he says is understood by the log's own parse and the
 *                     first planned item fills the work and the "when" cue; with none, his words fill the box. Then "बोलता येत
 *                     नसेल तर इथे लिहा" (the box is always there: voice first, never voice only), then the five work chips.
 *   2. कुठे?          THE crop -> plot selector the log flow uses (`CropSelector`, layout stepper; rule CTX-1): several plots,
 *                     "संपूर्ण शेत" alone. The form asks; a place left unchosen blocks the button (D-30: only speech may save
 *                     "अजून ठरवलेलं नाही", and that is not this form).
 *   3. कधी?           आज / उद्या / 8 दिवसांनी / तारीख निवडा, or तारीख ठरलेली नाही: या आठवड्यात / या महिन्यात / जमेल तेव्हा.
 *   4. कोणाला?        "स्वतः", "फक्त आठवण", and - only for the primary owner or an AssignWork holder - the people the server listed.
 *   5. तपशील          प्रमाण, मजुरी / कसं करायचं (words only), सूचना; for a मुकादम also the "टीम" words and "किती जण".
 *
 * Nothing here makes a हजेरी, a wage or a cost (P4). The task goes to the outbox through `PlannedWorkCommands.create` and works
 * with no net; the server decides who may do what (D-26). A task made here is `PlanForm`, whether he spoke or typed; the form keeps
 * no audio of its own and sends no voice reference (R15).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import CropSelector from '../../context/components/CropSelector';
import { STEPPER_LABELS } from '../../logs/components/entry/entryWords';
import { resolveDueDate } from '../../../core/domain/dueDateResolver';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import type { PlannedWorkPayModeName } from '../../../infrastructure/storage/plannedWorkRow';
import { PlannedWorkCommands, type CreatePlannedWorkInput } from '../data/plannedWorkCommands';
import { understandPlanSpeech, type PlanSpeechResult } from '../data/planVoice';
import { pickForDate, toIso, whenFields, type WhenPick } from '../planDates';
import { plannedWorkWords } from '../plannedWorkWords';
import { fontFor } from './PlanCard';
import { PlanAssigneeChips, type AssigneeChoice } from './PlanAssigneeChips';
import { PlanChip, PlanQuestion } from './PlanChip';
import { PlanMic } from './PlanMic';

/** The selector's own two steps (controlled here, so the form can keep the plot step open). */
type PlaceStep = 'crop' | 'plot';

/** The server's role name of the seat the crew fields are for (display only; the server decides). */
const CREW_ROLE = 'Mukadam';

/** The most the server takes in each box (the zod twin of `plannedwork.create`): longer words are never cut for him, they block the button. */
export const LIMITS = { title: 200, crewText: 100, quantityText: 200, note: 1000, headcountDigits: 3 } as const;

const PAY_ORDER: readonly PlannedWorkPayModeName[] = ['Cash', 'Daily', 'Contract', 'Later'];

export interface PlanSavedInfo {
    reminder: boolean;
    /** The person's name as entered, when the work went to another person. */
    assignedTo: string | null;
}

export interface PlanFormProps {
    farmId: string;
    /** The signed-in person's user id (for "स्वतः"). */
    userId: string | null;
    language: string | null | undefined;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    /** The primary owner or a holder of AssignWork - from the server's authorities, never a label. */
    mayAssign: boolean;
    assignees: readonly PlannedWorkAssigneeDto[];
    assigneesFromCache?: boolean;
    /** The farm-local day; injected so tests are stable. */
    today: Date;
    /** Understands what he said. Absent = the log's own pipeline (`understandPlanSpeech`). */
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
    onSaved: (info: PlanSavedInfo) => void;
    /**
     * spec: plr-d10 lane SCH-GATE-b (D-83 = 1, open point 9 (b)) - told every time the chosen place changes: the plots chosen, or the whole
     * farm. The page in front of the form uses it to ask "आधी शेड्यूल निवडा" for a chosen plot that needs a schedule. Absent = nobody listens.
     */
    onPlaceChanged?: (place: { plotIds: readonly string[]; whole: boolean }) => void;
    /** While true the work cannot be saved (the ask in front of the form is standing); nothing else about the form changes. */
    saveHeld?: boolean;
}

type VoiceState = 'idle' | 'working' | 'offline' | 'failed';

export const PlanForm: React.FC<PlanFormProps> = ({
    farmId, userId, language, crops, farmerProfile, mayAssign, assignees, assigneesFromCache, today, understand, onSaved, onPlaceChanged, saveHeld = false,
}) => {
    const words = plannedWorkWords(language);
    const font = fontFor(language);
    const [work, setWork] = useState('');
    const [cropIds, setCropIds] = useState<string[]>([]);
    const [plotsByCrop, setPlotsByCrop] = useState<Record<string, string[]>>({});
    const [placeStep, setPlaceStep] = useState<PlaceStep>('crop');
    const [whenPick, setWhenPick] = useState<WhenPick>(null);
    const [dateText, setDateText] = useState('');
    const [assignee, setAssignee] = useState<AssigneeChoice>(null);
    const [qty, setQty] = useState('');
    const [pay, setPay] = useState<PlannedWorkPayModeName | null>(null);
    const [note, setNote] = useState('');
    const [crewText, setCrewText] = useState('');
    const [headcount, setHeadcount] = useState('');
    const [voice, setVoice] = useState<VoiceState>('idle');
    const [heard, setHeard] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const whole = cropIds.includes('FARM_GLOBAL');
    const plotIds = [...new Set(Object.values(plotsByCrop).flat())];
    const placeChosen = whole || plotIds.length > 0;
    // spec: plr-d10 lane SCH-GATE-b - the page in front of the form hears which place is chosen (keyed, so it hears a change only once).
    const placeKey = `${whole ? 'W' : 'P'}:${plotIds.join('|')}`;
    useEffect(() => { onPlaceChanged?.({ plotIds, whole }); }, [placeKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const when = whenFields(whenPick, dateText, today);

    const person = assignee?.kind === 'person' ? assignees.find(a => a.userId === assignee.userId) ?? null : null;
    // Display only (the server decides): the crew fields open for a chosen person whose seat the server lists as मुकादम.
    const crewFields = person?.role === CREW_ROLE;
    const reminder = assignee !== null && assignee.kind !== 'person';

    // Over a limit the server would refuse the task for good after it was queued: say so now, cut nothing.
    const over = ((): { box: string; max: number } | null => {
        if (work.trim().length > LIMITS.title) return { box: words.what, max: LIMITS.title };
        if (crewFields && crewText.trim().length > LIMITS.crewText) return { box: words.crew, max: LIMITS.crewText };
        if (qty.trim().length > LIMITS.quantityText) return { box: words.quantity, max: LIMITS.quantityText };
        if (note.trim().length > LIMITS.note) return { box: words.note, max: LIMITS.note };
        return null;
    })();
    const ready = work.trim().length >= 2 && placeChosen && when !== null && assignee !== null && over === null && !saving && !saveHeld;

    const hear = useCallback(async (audio: AudioData) => {
        setVoice('working');
        const result = await (understand ?? ((a: AudioData) => understandPlanSpeech(a, { crops, profile: farmerProfile })))(audio);
        if (!alive.current) return;
        if (!result.ok) { setVoice(result.reason === 'offline' ? 'offline' : 'failed'); return; }
        setVoice('idle');
        setHeard(result.speech.transcript);
        setWork(result.speech.title);
        if (result.speech.dueHint) {
            const iso = resolveDueDate(result.speech.dueHint, toIso(today));
            if (iso) {
                const filled = pickForDate(iso, today);
                setWhenPick(filled.pick);
                setDateText(filled.dateText);
            } else if (/आठवड्यात|week/i.test(result.speech.dueHint)) {
                setWhenPick('Week'); setDateText('');
            } else if (/महिन्यात|month/i.test(result.speech.dueHint)) {
                setWhenPick('Month'); setDateText('');
            }
        }
    }, [understand, crops, farmerProfile, today]);

    const submit = async () => {
        if (!ready || when === null || assignee === null) return;
        setSaving(true);
        setFailed(false);
        const toPerson = assignee.kind === 'person' ? assignee.userId : assignee.kind === 'self' ? userId ?? undefined : undefined;
        const count = Number.parseInt(headcount, 10);
        const input: CreatePlannedWorkInput = {
            plannedWorkId: idGenerator.generate(),
            farmId,
            title: work.trim(),
            scope: whole ? 'Farm' : plotIds.length === 1 ? 'Plot' : 'MultiPlot',
            plotIds: whole ? undefined : plotIds,
            ...when,
            assigneeUserId: toPerson,
            crewText: crewFields ? crewText.trim() || undefined : undefined,
            expectedHeadcount: crewFields && Number.isFinite(count) && count > 0 ? count : undefined,
            quantityText: qty.trim() || undefined,
            payMode: pay ?? undefined,
            note: note.trim() || undefined,
            sourceKind: 'PlanForm',
            recordedOn: toIso(today),
        };
        try {
            await PlannedWorkCommands.create(input);
        } catch {
            if (alive.current) { setFailed(true); setSaving(false); }
            return;
        }
        if (!alive.current) return;
        onSaved({ reminder, assignedTo: person?.displayName ?? null });
        setWork(''); setCropIds([]); setPlotsByCrop({}); setPlaceStep('crop'); setWhenPick(null); setDateText(''); setAssignee(null);
        setQty(''); setPay(null); setNote(''); setCrewText(''); setHeadcount(''); setHeard(null); setVoice('idle');
        setSaving(false);
    };

    return (
        <section className="space-y-3.5 rounded-3xl border-2 border-[#1448E6]/30 bg-white p-3.5" data-testid="plan-form" style={{ fontFamily: font }}>
            <h4 className="m-0 text-[19px] font-extrabold text-[#1448E6]">{words.newWork}</h4>

            <div>
                <PlanQuestion>{words.q1}</PlanQuestion>
                <PlanMic onAudio={audio => { void hear(audio); }} onProcessingStart={() => setVoice('working')} disabled={voice === 'working'} />
                {voice === 'working' && <p className="m-0 mt-1 text-[13px] font-bold text-stone-700" role="status" data-testid="plan-voice-working">{words.understanding}</p>}
                {voice === 'offline' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="plan-voice-offline">{words.voiceOffline}</p>}
                {voice === 'failed' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="plan-voice-failed">{words.voiceFailed}</p>}
                {heard && <p className="m-0 mt-1 rounded-xl bg-emerald-50 px-3 py-2 text-[13px] font-bold leading-snug text-emerald-900" data-testid="plan-heard">{words.heard}: &ldquo;{heard}&rdquo;</p>}
                <label htmlFor="plan-work-input" className="mb-1 mt-2 block text-[13px] font-extrabold text-stone-700">{words.typeHere}</label>
                <input id="plan-work-input" maxLength={LIMITS.title} value={work} onChange={e => setWork(e.target.value)} placeholder={words.workPh} data-testid="plan-work-input"
                    className="min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[18px] font-bold text-stone-900 outline-none focus:border-[#1448E6]" />
                <div className="mt-2 flex flex-wrap gap-2">
                    {words.commonWork.map(c => <PlanChip key={c} on={work === c} onClick={() => setWork(c)} testId={`plan-work-${c}`}>{c}</PlanChip>)}
                </div>
            </div>

            <div data-testid="plan-where">
                <PlanQuestion>{words.q2}</PlanQuestion>
                {/* THE crop -> plot selector (rule CTX-1): the one the log flow uses, not a second picker. */}
                <CropSelector
                    mode="log" layout="stepper" crops={crops}
                    selectedCrops={cropIds} selectedPlots={plotsByCrop}
                    onSelectionChange={(newCrops, newPlots) => { setCropIds(newCrops); setPlotsByCrop(newPlots); }}
                    stepper={{ step: placeStep, onStepChange: setPlaceStep, labels: STEPPER_LABELS }}
                />
                {!placeChosen && <p className="m-0 mt-1 text-[12px] font-semibold text-stone-600" data-testid="plan-where-hint">{words.noWhere}</p>}
            </div>

            <div>
                <PlanQuestion>{words.q3}</PlanQuestion>
                <div className="flex flex-wrap gap-2">
                    <PlanChip on={whenPick === 'today'} onClick={() => setWhenPick('today')} testId="plan-when-today">{words.today}</PlanChip>
                    <PlanChip on={whenPick === 'tomorrow'} onClick={() => setWhenPick('tomorrow')} testId="plan-when-tomorrow">{words.tomorrow}</PlanChip>
                    <PlanChip on={whenPick === 'in8'} onClick={() => setWhenPick('in8')} testId="plan-when-in8">{words.in8}</PlanChip>
                    <PlanChip on={whenPick === 'date'} onClick={() => setWhenPick('date')} testId="plan-when-date">{words.pickDate}</PlanChip>
                </div>
                {whenPick === 'date' && (
                    <input type="date" value={dateText} min={toIso(today)} onChange={e => setDateText(e.target.value)} data-testid="plan-date-input"
                        className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[17px] font-bold text-stone-900 outline-none focus:border-[#1448E6]" />
                )}
                <p className="m-0 mb-1 mt-2.5 text-[13px] font-extrabold text-stone-700">{words.noDate}:</p>
                <div className="flex flex-wrap gap-2">
                    {(['Week', 'Month', 'Anytime'] as const).map(l => (
                        <PlanChip key={l} tone="amber" on={whenPick === l} onClick={() => setWhenPick(l)} testId={`plan-when-${l.toLowerCase()}`}>{words.looseWhen[l]}</PlanChip>
                    ))}
                </div>
            </div>

            <div>
                <PlanQuestion>{words.q4}</PlanQuestion>
                <PlanAssigneeChips value={assignee} onChange={setAssignee} mayAssign={mayAssign} assignees={assignees}
                    myUserId={userId} language={language} fromCache={assigneesFromCache} />
            </div>

            <div>
                <PlanQuestion>{words.q5}</PlanQuestion>
                <label className="mb-1 block text-[13px] font-extrabold text-stone-700" htmlFor="plan-qty">{words.quantity}</label>
                <input id="plan-qty" maxLength={LIMITS.quantityText} value={qty} onChange={e => setQty(e.target.value)} placeholder={words.qtyPh} data-testid="plan-qty"
                    className="mb-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[16px] font-bold text-stone-900 outline-none focus:border-[#1448E6]" />
                <p className="m-0 mb-1 text-[13px] font-extrabold text-stone-700">{words.pay}</p>
                <div className="mb-2 flex flex-wrap gap-2">
                    {PAY_ORDER.map(k => <PlanChip key={k} on={pay === k} onClick={() => setPay(pay === k ? null : k)} testId={`plan-pay-${k.toLowerCase()}`}>{words.payMode[k]}</PlanChip>)}
                </div>
                {pay && <p className="m-0 mb-2 text-[12px] font-semibold text-stone-600" data-testid="plan-pay-words-only">{words.payIsWordsOnly}</p>}
                {crewFields && (
                    <div className="mb-2 space-y-2 rounded-2xl bg-stone-50 p-2.5" data-testid="plan-crew-fields">
                        <label className="block text-[13px] font-extrabold text-stone-700" htmlFor="plan-crew">{words.crew}</label>
                        <input id="plan-crew" maxLength={LIMITS.crewText} value={crewText} onChange={e => setCrewText(e.target.value)} placeholder={words.crewPh} data-testid="plan-crew"
                            className="min-h-[48px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[16px] font-bold text-stone-900 outline-none focus:border-[#1448E6]" />
                        <label className="block text-[13px] font-extrabold text-stone-700" htmlFor="plan-headcount">{words.expectedHeadcount}</label>
                        <input id="plan-headcount" inputMode="numeric" value={headcount} onChange={e => setHeadcount(e.target.value.replace(/[^0-9]/g, '').slice(0, LIMITS.headcountDigits))} data-testid="plan-headcount"
                            className="min-h-[48px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[16px] font-bold text-stone-900 outline-none focus:border-[#1448E6]" />
                    </div>
                )}
                <label className="mb-1 block text-[13px] font-extrabold text-stone-700" htmlFor="plan-note">{words.note}</label>
                <textarea id="plan-note" maxLength={LIMITS.note} value={note} onChange={e => setNote(e.target.value)} placeholder={words.notePh} rows={2} data-testid="plan-note"
                    className="w-full resize-none rounded-2xl border-2 border-stone-300 bg-white p-3 text-[16px] font-semibold text-stone-900 outline-none focus:border-[#1448E6]" />
            </div>

            {over && <p className="m-0 text-[13px] font-bold text-red-800" role="alert" data-testid="plan-too-long">{words.tooLong(over.box, over.max)}</p>}
            {failed && <p className="m-0 text-[13px] font-bold text-red-800" role="alert" data-testid="plan-save-failed">{words.sendFailed}</p>}
            <button type="button" disabled={!ready} onClick={() => { void submit(); }} data-testid="plan-submit"
                className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1448E6] text-[19px] font-extrabold text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500">
                <Plus size={22} strokeWidth={3} aria-hidden="true" />{reminder ? words.submitRemind : words.submitAssign}
            </button>
        </section>
    );
};

export default PlanForm;
