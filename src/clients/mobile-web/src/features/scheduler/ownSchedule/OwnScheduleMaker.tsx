/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 2; founder D-132 Q2 = 1 "both start buttons", Q3 = 1 "three things: काम, कधी,
 * किती वेळा", Q4 = 1 with note, D-136/D-137 made-for block; TAP-1, CTX-1, doctrine P4, P5, P9, P10) - the MAKER, copied from the founder's ticked v3 page
 * (`own-schedule-working-screen-v3`), four screens in planning:
 *   3. the two ways to start - blank (`schedule.create`), or a copy of the crop's CHECKED schedule (`schedule.clone` into his own, no check);
 *   4. "यासाठी बनवलं" - the crop is shown, the days are WORKED OUT from the stages (never a box), the variety from the app's own list (minus "Other"), soil /
 *      region / climate short optional lists (codes and Marathi labels are data in the contract's list file). The mic is first; it cannot fill the picks, and
 *      the screen says so;
 *   5. the stage list - adding / changing / removing a work, adding / changing a stage, the change list so far, and "जतन करा";
 *   6. one work - the mic first, then "बोलता येत नसेल तर इथे लिहा", then the three boxes always visible: काम (voice fills ONLY this one), कधी (days), किती वेळा
 *      (by hand: voice returns the work only, F215). The screen says so.
 * NOTHING is saved until he taps "जतन करा"; then the existing outbox gets the contract's mutations (`ownScheduleCommands.ts`) - offline-first - and the maker
 * closes. Saving never makes a plot follow (that is the per-plot tap on the schedule's own screen). Every change is a NEW version, never in place.
 * The phone asks the server's day rules first (`validateSchedule`) so a draft the server would refuse for good is not sent; the server asks again.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { cropNameIn } from '../../../shared/names/namesIn';
import { scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import { PlanMic } from '../../plannedWork/components/PlanMic';
import { understandPlanSpeech, type PlanSpeechResult } from '../../plannedWork/data/planVoice';
import { plannedWorkWords } from '../../plannedWork/plannedWorkWords';
import { SCHEDULE_GATE_WORDS } from '../schedulePage/scheduleGateCopy';
import { changeText, daysText, diffVersions, frequencyText, type ChangeItem } from './changeList';
import { madeForOptions, varietiesFor } from './madeFor';
import { MadeForPills, NumberBox, PickRow } from './OwnScheduleBits';
import { cropByName } from '../../../domain/crops/cropMaster';
import { OwnScheduleChangeBlocked, saveOwnSchedule, type SaveOwnScheduleInput } from './ownScheduleCommands';
import { derivedDays, validateSchedule, type MadeForTags, type OwnStage, type OwnWork, type ScheduleBody, type WorkMode, type WorkPart } from './ownScheduleModel';
import { OWN_WORDS, type OwnLanguage } from './ownScheduleWords';
import { checkedSourceFor, useChangeBlocked, useOwnSchedules } from './useOwnSchedules';

export type MakerMode = { kind: 'new'; cropId: string | null } | { kind: 'edit'; chainId: string };

export interface OwnScheduleMakerProps {
    mode: MakerMode;
    farmId: string;
    language: OwnLanguage;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    /** Injected for tests; absent = the log's own voice parse (`understandPlanSpeech`). */
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
    /** The back of the FIRST screen (new: wherever he came from; edit: the schedule's own screen). */
    onBack: () => void;
    /** Called once the save was handed to the outbox, with the line to say. */
    onSaved: (note: string) => void;
}

type Page = 'start' | 'madefor' | 'stages' | 'work';
type Kind = 'blank' | 'checked' | 'edit';
type Voice = 'idle' | 'working' | 'offline' | 'failed';

interface Draft {
    kind: Kind;
    cropId: string;
    cropName: string;
    name: string;
    nameTouched: boolean;
    stages: OwnStage[];
    works: OwnWork[];
    madeFor: MadeForTags;
    /** What the change list compares against: nothing / the checked schedule / the newest version. */
    base: ScheduleBody;
    /** The checked schedule to copy, or the version being changed. */
    sourceId: string | null;
}

// Lane SCH-MAKER-EMPTY (founder B3): `n` (every N days / times a week) of a NEW work and `to` (the last day) of a NEW stage start EMPTY (null): the person
// types them, nothing is suggested. A row that already has values opens with them.
interface WorkForm { editIndex: number | null; name: string; part: WorkPart; from: number; to: number; mode: WorkMode; n: number | null; operationKey?: string; stageName: string; stageFrom: number; stageTo: number }
interface StageForm { index: number | null; name: string; from: number; to: number | null }

const PARTS: readonly WorkPart[] = ['irrigation', 'nutrition', 'spray', 'work'];
const byStart = (a: OwnStage, b: OwnStage): number => a.startDay - b.startDay || a.endDay - b.endDay;
const placeOf = (stages: readonly OwnStage[], w: OwnWork): number => stages.findIndex(s => s.startDay <= w.startDay && w.startDay <= s.endDay);

export const OwnScheduleMaker: React.FC<OwnScheduleMakerProps> = ({ mode, farmId, language, crops, farmerProfile, understand, onBack, onSaved }) => {
    const words = OWN_WORDS[language];
    const planned = plannedWorkWords(language);
    const partWords = SCHEDULE_GATE_WORDS[language].parts;
    const { chains, rows } = useOwnSchedules();
    const editChain = mode.kind === 'edit' ? chains.find(c => c.id === mode.chainId) : undefined;

    const [page, setPage] = useState<Page>(mode.kind === 'edit' ? 'stages' : 'start');
    const [cropId, setCropId] = useState<string>(() => (mode.kind === 'new' && mode.cropId && crops.some(c => c.id === mode.cropId) ? mode.cropId : crops[0]?.id ?? ''));
    const cropOf = (id: string): CropProfile | undefined => crops.find(c => c.id === id);
    const shownCropName = (c: CropProfile | undefined): string => (c ? cropNameIn(c.name, language, c.masterId) : '');
    const defaultNameFor = (id: string): string => words.defaultName(shownCropName(cropOf(id)));
    const [startName, setStartName] = useState<string>(() => defaultNameFor(cropId));
    const [startNameTouched, setStartNameTouched] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [wf, setWf] = useState<WorkForm | null>(null);
    const [sf, setSf] = useState<StageForm | null>(null);
    const [voice, setVoice] = useState<Voice>('idle');
    const [heard, setHeard] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const savingRef = useRef(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    // Changing an own schedule: the draft starts as the newest version (once the pull's rows are here).
    useEffect(() => {
        if (mode.kind !== 'edit' || !editChain || draft) return;
        const latest = editChain.latest;
        const crop = crops.find(c => scheduleCropCode(c.name) === scheduleCropCode(editChain.cropType));
        const body: ScheduleBody = { name: latest.name, stages: latest.stages.map(s => ({ ...s })).sort(byStart), works: latest.works.map(w => ({ ...w })), madeFor: { ...latest.madeFor } };
        setDraft({ kind: 'edit', cropId: crop?.id ?? '', cropName: crop?.name ?? editChain.cropType, nameTouched: false, ...body, base: body, sourceId: latest.id });
    }, [mode, editChain, draft, crops]);

    // P001: while an earlier change of this schedule is still his unsynced change, a further one is refused (nothing is written).
    const blocked = useChangeBlocked(draft?.kind === 'edit' ? draft.sourceId : null, editChain ? editChain.versions.map(v => v.id) : []);

    const resetVoice = () => { setVoice('idle'); setHeard(null); };
    const go = (next: Page) => { resetVoice(); setPage(next); };

    const hear = useCallback(async (audio: AudioData, forWork: boolean) => {
        setVoice('working');
        const result = await (understand ?? ((a: AudioData) => understandPlanSpeech(a, { crops, profile: farmerProfile })))(audio);
        if (!alive.current) return;
        if (!result.ok) { setVoice(result.reason === 'offline' ? 'offline' : 'failed'); return; }
        setVoice('idle');
        setHeard(result.speech.transcript);
        // Voice returns the WORK only (F215): the title fills the काम box; no day window, no how-often, no made-for pick is read from it.
        if (forWork) setWf(form => (form ? { ...form, name: result.speech.title } : form));
    }, [understand, crops, farmerProfile]);

    const voiceBlock = (forWork: boolean) => (
        <>
            <PlanMic onAudio={audio => { void hear(audio, forWork); }} onProcessingStart={() => setVoice('working')} disabled={voice === 'working'} />
            {voice === 'working' && <p className="m-0 mt-1 text-[13px] font-bold text-stone-700" role="status" data-testid="own-voice-working">{planned.understanding}</p>}
            {voice === 'offline' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="own-voice-offline">{planned.voiceOffline}</p>}
            {voice === 'failed' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="own-voice-failed">{planned.voiceFailed}</p>}
            {heard && <p className="m-0 mt-1 rounded-xl bg-emerald-50 px-3 py-2 text-[13px] font-bold leading-snug text-emerald-900" data-testid="own-heard">{planned.heard}: &ldquo;{heard}&rdquo;</p>}
        </>
    );

    const header = (title: string, back: () => void, sub?: string) => (
        <div className="flex items-center gap-2">
            <Tap onClick={back} data-testid="own-back" aria-label={planned.back}
                className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-md">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} aria-hidden="true" /></span>
            </Tap>
            <div className="min-w-0 flex-1">
                <h3 className="m-0 truncate text-[20px] font-extrabold leading-tight text-stone-900" data-testid="own-title">{title}</h3>
                {sub && <p className="m-0 truncate text-[13.5px] font-bold text-stone-600">{sub}</p>}
            </div>
        </div>
    );

    // ---- screen 3: the two ways to start ----------------------------------------------------------------------------------------------------------
    if (page === 'start') {
        const crop = cropOf(cropId);
        // P007: a crop the phone cannot name to the server (it is not in the crop master) cannot start a schedule: the server would answer "the farm has
        // no such crop", which is not true. Both buttons are off, with a line that says what is true.
        const cropKnown = !!crop && !!cropByName(crop.name);
        const source = crop && cropKnown ? checkedSourceFor(rows, crop.name) : null;
        const begin = (kind: 'blank' | 'checked') => {
            if (!crop || !cropKnown) return;
            const stages = kind === 'checked' && source ? source.stages.map(s => ({ ...s })).sort(byStart) : [];
            const works = kind === 'checked' && source ? source.works.map(w => ({ ...w })) : [];
            const base: ScheduleBody = { name: startName, stages: stages.map(s => ({ ...s })), works: works.map(w => ({ ...w })), madeFor: {} };
            setDraft({
                kind, cropId: crop.id, cropName: crop.name, name: startName, nameTouched: startNameTouched,
                stages, works, madeFor: kind === 'checked' && source ? { ...source.madeFor } : {}, base, sourceId: kind === 'checked' ? source?.id ?? null : null,
            });
            go('madefor');
        };
        return (
            <div className="space-y-3" data-testid="own-start">
                {header(words.startTitle, onBack)}
                <div className="text-[15px] font-extrabold text-stone-900">{words.cropLabel}</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={words.cropLabel}>
                    {crops.map(c => (
                        <Tap key={c.id} data-testid={`own-crop-${c.id}`} aria-pressed={c.id === cropId}
                            onClick={() => { setCropId(c.id); if (!startNameTouched) setStartName(defaultNameFor(c.id)); }}
                            className={`min-h-[48px] rounded-full px-4 text-[16px] font-extrabold ring-1 ${c.id === cropId ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-stone-800 ring-stone-300'}`}>
                            {shownCropName(c)}
                        </Tap>
                    ))}
                </div>
                <label className="block">
                    <span className="text-[15px] font-extrabold text-stone-900">{words.nameLabel}</span>
                    <input value={startName} maxLength={120} data-testid="own-name" aria-label={words.nameLabel}
                        onChange={e => { setStartName(e.target.value); setStartNameTouched(true); }}
                        className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[18px] font-bold text-stone-900 outline-none focus:border-emerald-600" />
                </label>
                <Tap onClick={() => begin('blank')} disabled={!crop || !cropKnown || startName.trim().length === 0} data-testid="own-start-blank"
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-amber-700 px-4 text-left text-white disabled:opacity-50">
                    <Plus size={22} aria-hidden="true" />
                    <span><strong className="block text-[17px] font-black">{words.blank}</strong><span className="block text-[14px] font-bold text-white/90">{words.blankSub}</span></span>
                </Tap>
                <Tap onClick={() => begin('checked')} disabled={!crop || !source || startName.trim().length === 0} data-testid="own-start-checked"
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-emerald-600 bg-white px-4 text-left text-stone-900 disabled:opacity-50">
                    <Check size={22} aria-hidden="true" />
                    <span>
                        <strong className="block text-[17px] font-black">{words.checked}</strong>
                        {source && <span className="block text-[14px] font-bold text-stone-700">{words.checkedSub}</span>}
                    </span>
                </Tap>
                {crop && cropKnown && !source && <p className="m-0 rounded-2xl bg-stone-100 px-3 py-3 text-[15px] font-bold text-stone-700" data-testid="own-no-checked">{words.noChecked}</p>}
                {crop && !cropKnown && <p className="m-0 rounded-2xl bg-stone-100 px-3 py-3 text-[15px] font-bold text-stone-700" data-testid="own-crop-unknown">{words.cropUnknown}</p>}
                <p className="m-0 text-[14px] font-bold text-stone-600">{words.noCheckNeeded}</p>
            </div>
        );
    }

    if (!draft) return <div data-testid="own-maker-loading" />;

    const crop = cropOf(draft.cropId);
    const cropShown = crop ? shownCropName(crop) : cropNameIn(draft.cropName, language);
    const days = derivedDays(draft.stages);
    const current: ScheduleBody = { name: draft.name, stages: draft.stages, works: draft.works, madeFor: draft.madeFor };

    // The change list so far: the first line (how it began) for a new one, then what differs from its base. For a new schedule the name and the picks are
    // its start, not changes; for a change to an existing one every difference is a line.
    const items: ChangeItem[] = (() => {
        const diff = diffVersions(draft.base, current);
        if (draft.kind === 'edit') return diff;
        return [{ kind: draft.kind === 'checked' ? 'copied' : 'built' } as ChangeItem, ...diff.filter(i => i.kind.startsWith('stage') || i.kind.startsWith('work'))];
    })();
    const hasEdits = draft.kind === 'edit' ? items.length > 0 : true;
    const rawProblem = validateSchedule(draft.stages, draft.works);
    // The server's day rules apply to a version WRITTEN WHOLE (an edit). A plain copy of a checked schedule is sent as the copy alone - the server copies the
    // checked schedule's days as they are - so it is never blocked by them; a new blank schedule may be saved with no stage yet (it answers
    // "आधी कामं जोडा" until it has works). Every save that sends a whole version needs a valid one.
    const copyAlone = draft.kind === 'checked' && !items.some(i => i.kind.startsWith('stage') || i.kind.startsWith('work'))
        && Object.keys(draft.madeFor).length === 0 && !draft.nameTouched;
    const nothingYet = draft.kind !== 'edit' && draft.stages.length === 0 && draft.works.length === 0;
    const problem = copyAlone || nothingYet ? null : rawProblem;
    const canSave = hasEdits && !problem && !saving && !blocked && draft.name.trim().length > 0;

    const save = async () => {
        if (savingRef.current || !canSave) return;
        savingRef.current = true;
        setSaving(true);
        setFailed(false);
        const common = { farmId, madeFor: draft.madeFor, stages: draft.stages, works: draft.works };
        try {
            let input: SaveOwnScheduleInput;
            if (draft.kind === 'blank') {
                input = { mode: 'blank', cropKey: scheduleCropCode(draft.cropName), name: draft.name.trim(), ...common };
            } else if (draft.kind === 'checked' && draft.sourceId) {
                const changed = diffVersions(draft.base, current).some(i => i.kind.startsWith('stage') || i.kind.startsWith('work')) || Object.keys(draft.madeFor).length > 0 || draft.nameTouched;
                input = { mode: 'checked', sourceScheduleTemplateId: draft.sourceId, name: draft.nameTouched ? draft.name.trim() : null, changed, ...common };
            } else if (draft.kind === 'edit' && draft.sourceId) {
                input = { mode: 'edit', scheduleTemplateId: draft.sourceId, name: null, knownVersionIds: editChain ? editChain.versions.map(v => v.id) : undefined, ...common };
            } else {
                throw new Error('nothing to save');
            }
            await saveOwnSchedule(input);
            if (!alive.current) return;
            onSaved(words.savedWaiting);
        } catch (error) {
            // A refusal for an earlier unsynced change is already said (the note above the save button); nothing was written either way.
            savingRef.current = false;
            if (alive.current) { setFailed(!(error instanceof OwnScheduleChangeBlocked)); setSaving(false); }
        }
    };

    // ---- screen 4: "यासाठी बनवलं" ------------------------------------------------------------------------------------------------------------------
    if (page === 'madefor') {
        const set = (key: keyof MadeForTags, value: string | undefined) => setDraft(d => {
            if (!d) return d;
            const next = { ...d.madeFor };
            if (value) next[key] = value; else delete next[key];
            return { ...d, madeFor: next };
        });
        return (
            <div className="space-y-3" data-testid="own-madefor">
                {header(words.madeForTitle, () => (draft.kind === 'edit' ? go('stages') : go('start')), draft.name)}
                <section className="rounded-3xl border border-stone-200 bg-white p-3.5">
                    <div className="text-[15px] font-extrabold text-stone-900">{words.cropLabel}</div>
                    <span className="mt-1 inline-block rounded-full bg-stone-100 px-3 py-1 text-[15px] font-extrabold text-stone-900" data-testid="own-mf-crop">{cropShown}</span>
                    <div className="mt-3">{voiceBlock(false)}</div>
                    <p className="m-0 mt-2 rounded-xl bg-stone-100 px-3 py-2 text-[13.5px] font-bold text-stone-600" data-testid="own-mf-voice-note">{words.micMadeNote}</p>
                </section>
                <section className="rounded-3xl border border-stone-200 bg-white p-3.5">
                    <div className="text-[15px] font-extrabold text-stone-900">{words.totalDays}</div>
                    <div className="mt-1 text-[15px] font-bold text-stone-800" data-testid="own-mf-days">
                        {days > 0 ? <>{words.daysN(days)} <span className="text-[13.5px] text-stone-500">· {words.daysFromStages}</span></> : words.daysLater}
                    </div>
                    <PickRow testId="own-mf-variety" label={words.varietyL} optional={words.optional} options={varietiesFor(draft.cropName).map(v => ({ code: v, label: v }))}
                        value={draft.madeFor.variety} onPick={code => set('variety', code)} />
                    <PickRow testId="own-mf-soilType" label={words.soilL} optional={words.optional} options={madeForOptions('soilType', language)}
                        value={draft.madeFor.soilType} onPick={code => set('soilType', code)} />
                    <PickRow testId="own-mf-region" label={words.regionL} optional={words.optional} options={madeForOptions('region', language)}
                        value={draft.madeFor.region} onPick={code => set('region', code)} />
                    <PickRow testId="own-mf-climate" label={words.climateL} optional={words.optional} options={madeForOptions('climate', language)}
                        value={draft.madeFor.climate} onPick={code => set('climate', code)} />
                    <MadeForPills testId="own-mf-summary" cropName={cropShown} days={days} madeFor={draft.madeFor} language={language} />
                    <p className="m-0 mt-2 text-[14px] font-bold text-stone-600">{words.madeForNote}</p>
                </section>
                <Tap onClick={() => go('stages')} data-testid="own-mf-next" className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 text-[18px] font-extrabold text-white">
                    <Check size={20} aria-hidden="true" />{draft.kind === 'edit' ? words.done : words.next}
                </Tap>
            </div>
        );
    }

    // ---- screen 6: one work ------------------------------------------------------------------------------------------------------------------------
    if (page === 'work' && wf) {
        const bad = wf.to < wf.from;
        const repeats = wf.mode !== 'one_time';
        const ok = wf.name.trim().length >= 2 && !bad && (!repeats || (wf.n !== null && wf.n >= 1));
        // Changing how often: from one-time to a repeat the box starts empty (nothing is suggested); between the two repeats the typed number stays, unless a
        // week cannot hold it - then he types again.
        const setMode = (m: WorkMode) => setWf(f => (f ? { ...f, mode: m, n: m === 'one_time' ? f.n : f.mode === 'one_time' || (m === 'per_week' && f.n !== null && f.n > 7) ? null : f.n } : f));
        // ONE line, and it says which box holds the work back: the name first, else the empty every-N-days / times-a-week box (PROPOSED words).
        const nudge = wf.name.trim().length === 0 ? words.needName
            : repeats && wf.n === null ? (wf.mode === 'every_n_days' ? words.needEvery(wf.name.trim()) : words.needTimes(wf.name.trim())) : null;
        const finish = () => {
            if (!ok) return;
            const work: OwnWork = {
                name: wf.name.trim(), part: wf.part, startDay: wf.from, endDay: wf.to, mode: wf.mode, intervalDays: wf.mode === 'one_time' ? 1 : wf.n ?? 1,
                ...(wf.operationKey ? { operationKey: wf.operationKey } : {}),
            };
            setDraft(d => {
                if (!d) return d;
                const next = d.works.slice();
                if (wf.editIndex === null) next.push(work); else next[wf.editIndex] = work;
                return { ...d, works: next };
            });
            setWf(null);
            go('stages');
        };
        return (
            <div className="space-y-3" data-testid="own-work-page">
                {header(wf.editIndex === null ? words.workTitleNew : words.workTitleEdit, () => { setWf(null); go('stages'); }, wf.stageName)}
                <div className="space-y-3" data-testid="own-work">
                    <section className="rounded-3xl border border-stone-200 bg-white p-3.5" data-testid="own-box-what">
                        <div className="text-[15px] font-extrabold text-stone-900">{words.workLabel}</div>
                        <div className="mt-1">{voiceBlock(true)}</div>
                        <p className="m-0 mt-2 rounded-xl bg-stone-100 px-3 py-2 text-[13.5px] font-bold text-stone-600" data-testid="own-work-voice-note">{words.voiceOnlyWork}</p>
                        <label htmlFor="own-work-name" className="mt-2 block text-[14px] font-extrabold text-stone-700">{planned.typeHere}</label>
                        <input id="own-work-name" value={wf.name} maxLength={120} placeholder={planned.workPh} data-testid="own-work-name"
                            onChange={e => setWf(f => (f ? { ...f, name: e.target.value } : f))}
                            className="min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[18px] font-bold text-stone-900 outline-none focus:border-emerald-600" />
                        <div className="mt-2 text-[14px] font-extrabold text-stone-700">{words.partLabel}</div>
                        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={words.partLabel}>
                            {PARTS.map(p => (
                                <Tap key={p} data-testid={`own-part-${p}`} aria-pressed={wf.part === p} onClick={() => setWf(f => (f ? { ...f, part: p } : f))}
                                    className={`min-h-[48px] rounded-full px-4 text-[16px] font-extrabold ring-1 ${wf.part === p ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-stone-800 ring-stone-300'}`}>{partWords[p]}</Tap>
                            ))}
                        </div>
                    </section>
                    <section className="rounded-3xl border border-stone-200 bg-white p-3.5" data-testid="own-box-when">
                        <div className="text-[15px] font-extrabold text-stone-900">{words.whenLabel} <span className="text-[13px] font-bold text-stone-500">{words.whenSub(wf.stageName, wf.stageFrom, wf.stageTo)}</span></div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <div><div className="text-[13.5px] font-bold text-stone-600">{words.from}</div><NumberBox testId="own-from" value={wf.from} label={words.from} language={language} bad={bad} onChange={n => setWf(f => (f ? { ...f, from: n } : f))} /></div>
                            <div><div className="text-[13.5px] font-bold text-stone-600">{words.to}</div><NumberBox testId="own-to" value={wf.to} label={words.to} language={language} bad={bad} onChange={n => setWf(f => (f ? { ...f, to: n } : f))} /></div>
                        </div>
                        {bad && <p className="m-0 mt-2 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-work-err">{words.errEnd}</p>}
                    </section>
                    <section className="rounded-3xl border border-stone-200 bg-white p-3.5" data-testid="own-box-often">
                        <div className="text-[15px] font-extrabold text-stone-900">{words.howOften}</div>
                        <div className="mt-2 space-y-2" role="radiogroup" aria-label={words.howOften}>
                            <div role="radio" tabIndex={0} aria-checked={wf.mode === 'one_time'} data-testid="own-mode-one_time" onClick={() => setMode('one_time')}
                                className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 ring-1 ${wf.mode === 'one_time' ? 'bg-emerald-50 ring-emerald-500' : 'bg-white ring-stone-300'}`}>
                                <span className="text-[16px] font-extrabold text-stone-900">{words.once}</span>
                            </div>
                            <div role="radio" tabIndex={0} aria-checked={wf.mode === 'every_n_days'} data-testid="own-mode-every_n_days" onClick={() => setMode('every_n_days')}
                                className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 ring-1 ${wf.mode === 'every_n_days' ? 'bg-emerald-50 ring-emerald-500' : 'bg-white ring-stone-300'}`}>
                                <span className="text-[16px] font-extrabold text-stone-900">{wf.mode === 'every_n_days' && wf.n !== null ? frequencyText('every_n_days', wf.n, language) : words.everyNDays}</span>
                            </div>
                            <div role="radio" tabIndex={0} aria-checked={wf.mode === 'per_week'} data-testid="own-mode-per_week" onClick={() => setMode('per_week')}
                                className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 ring-1 ${wf.mode === 'per_week' ? 'bg-emerald-50 ring-emerald-500' : 'bg-white ring-stone-300'}`}>
                                <span className="text-[16px] font-extrabold text-stone-900">{wf.mode === 'per_week' && wf.n !== null ? frequencyText('per_week', wf.n, language) : words.perWeek}</span>
                            </div>
                            {repeats && (
                                <div className="max-w-[220px]">
                                    <NumberBox testId="own-interval" allowEmpty value={wf.n} min={1} label={wf.mode === 'every_n_days' ? words.days : words.times} language={language} onChange={n => setWf(f => (f ? { ...f, n: n !== null && wf.mode === 'per_week' ? Math.min(7, Math.max(1, n)) : n } : f))} />
                                </div>
                            )}
                        </div>
                    </section>
                </div>
                {nudge && <p className="m-0 rounded-2xl bg-stone-100 px-3 py-2 text-[14px] font-bold text-stone-700" data-testid="own-work-need">{nudge}</p>}
                <Tap onClick={finish} disabled={!ok} data-testid="own-work-ok" className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 text-[18px] font-extrabold text-white disabled:opacity-50">
                    <Check size={20} aria-hidden="true" />{wf.editIndex === null ? words.addThis : words.changeThis}
                </Tap>
                <Tap onClick={() => { setWf(null); go('stages'); }} data-testid="own-work-cancel" className="flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">{words.cancel}</Tap>
            </div>
        );
    }

    // ---- screen 5: the stages, the change list and the save ----------------------------------------------------------------------------------------
    const byStage = draft.stages.map((_, i) => draft.works.map((w, idx) => ({ w, idx })).filter(x => placeOf(draft.stages, x.w) === i));
    const unplaced = draft.works.map((w, idx) => ({ w, idx })).filter(x => placeOf(draft.stages, x.w) === -1);
    const openWork = (stageIndex: number, editIndex: number | null) => {
        const stage = draft.stages[stageIndex];
        const w = editIndex === null ? null : draft.works[editIndex];
        setWf({
            editIndex, name: w?.name ?? '', part: w?.part ?? 'work', from: w?.startDay ?? stage.startDay, to: w?.endDay ?? stage.endDay,
            mode: w?.mode ?? 'one_time', n: w ? w.intervalDays : null, ...(w?.operationKey ? { operationKey: w.operationKey } : {}),
            stageName: stage.name, stageFrom: stage.startDay, stageTo: stage.endDay,
        });
        go('work');
    };
    const rowText = (w: OwnWork): string => `${partWords[w.part]} · ${daysText(w.startDay, w.endDay, language)} · ${frequencyText(w.mode, w.intervalDays, language)}`;
    const workRow = (w: OwnWork, idx: number, i: number | string, j: number, stageIndex: number) => (
        <div key={`${i}-${j}-${idx}`} data-testid={`own-work-row-${i}-${j}`} className="mt-1.5 flex items-center gap-2 rounded-xl bg-stone-50 px-2.5 py-2 ring-1 ring-stone-200">
            <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-extrabold text-stone-900">{w.name}</div>
                <div className="text-[13.5px] font-bold text-stone-600">{rowText(w)}</div>
            </div>
            <Tap onClick={() => (stageIndex >= 0 ? openWork(stageIndex, idx) : openWork(Math.max(0, draft.stages.length - 1), idx))} data-testid={`own-work-edit-${i}-${j}`}
                className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-sky-800">{words.change}</Tap>
            <Tap onClick={() => setDraft(d => (d ? { ...d, works: d.works.filter((_, k) => k !== idx) } : d))} data-testid={`own-work-del-${i}-${j}`}
                className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-rose-700">{words.remove}</Tap>
        </div>
    );
    const stageOk = sf !== null && sf.name.trim().length > 0 && sf.to !== null && sf.to >= sf.from;
    const commitStage = () => {
        if (!sf || !stageOk || sf.to === null) return;
        const stage: OwnStage = { name: sf.name.trim(), startDay: sf.from, endDay: sf.to };
        setDraft(d => {
            if (!d) return d;
            const next = d.stages.slice();
            if (sf.index === null) next.push(stage); else next[sf.index] = stage;
            return { ...d, stages: next.sort(byStart) };
        });
        setSf(null);
    };
    const openStageForm = (index: number | null) => {
        const last = draft.stages.reduce((m, s) => Math.max(m, s.endDay), -1);
        const s = index === null ? null : draft.stages[index];
        setSf({ index, name: s?.name ?? '', from: s?.startDay ?? last + 1, to: s?.endDay ?? null });
    };

    return (
        <div className="space-y-3" data-testid="own-stages">
            {header(draft.name, draft.kind === 'edit' ? onBack : () => go('madefor'), cropShown)}
            <MadeForPills testId="own-mf-box" cropName={cropShown} days={days} madeFor={draft.madeFor} language={language} />
            <div className="text-right">
                <Tap onClick={() => go('madefor')} data-testid="own-edit-madefor" className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-sky-800 underline underline-offset-2">{words.change}</Tap>
            </div>
            <h4 className="m-0 text-[17px] font-extrabold text-stone-900">{words.stagesTitle}</h4>
            {draft.stages.length === 0 && <p className="m-0 rounded-2xl bg-stone-100 px-3 py-3 text-[15px] font-bold text-stone-700">{words.noStages}</p>}
            {draft.stages.map((stage, i) => (
                <section key={`${stage.name}-${i}`} data-testid={`own-stage-${i}`} className="rounded-3xl border border-stone-200 bg-white p-3.5">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <strong className="block text-[17px] font-black text-stone-900">{stage.name}</strong>
                            <span className="block text-[14px] font-bold text-stone-600">{words.stageLine(stage.startDay, stage.endDay, words.worksN(byStage[i].length))}</span>
                        </div>
                        <div className="flex shrink-0 items-center">
                            <Tap onClick={() => openStageForm(i)} data-testid={`own-stage-edit-${i}`} className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-sky-800">{words.change}</Tap>
                            {byStage[i].length === 0 && (
                                <Tap onClick={() => setDraft(d => (d ? { ...d, stages: d.stages.filter((_, k) => k !== i) } : d))} data-testid={`own-stage-del-${i}`} className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-rose-700">{words.remove}</Tap>
                            )}
                        </div>
                    </div>
                    {byStage[i].length === 0 && <p className="m-0 mt-1 text-[14px] font-bold text-stone-500">{words.noWork}</p>}
                    {byStage[i].map((x, j) => workRow(x.w, x.idx, i, j, i))}
                    <Tap onClick={() => openWork(i, null)} data-testid={`own-add-work-${i}`} className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-500 text-[16px] font-extrabold text-emerald-900">
                        <Plus size={18} aria-hidden="true" />{words.addWork}
                    </Tap>
                </section>
            ))}
            {unplaced.length > 0 && (
                <section data-testid="own-outside-works" className="rounded-3xl border border-rose-200 bg-rose-50/40 p-3.5">
                    <strong className="block text-[16px] font-black text-stone-900">{words.unplaced}</strong>
                    {unplaced.map((x, j) => workRow(x.w, x.idx, 'x', j, -1))}
                </section>
            )}
            {sf ? (
                <section className="rounded-3xl border border-stone-200 bg-white p-3.5" data-testid="own-stage-form">
                    <label className="block text-[14px] font-extrabold text-stone-700" htmlFor="own-stage-name">{words.stageName}</label>
                    <input id="own-stage-name" value={sf.name} maxLength={80} data-testid="own-stage-name" onChange={e => setSf(f => (f ? { ...f, name: e.target.value } : f))}
                        className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[18px] font-bold text-stone-900 outline-none focus:border-emerald-600" />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        <div><div className="text-[13.5px] font-bold text-stone-600">{words.days} {words.from}</div><NumberBox testId="own-stage-from" value={sf.from} label={words.from} language={language} bad={sf.to !== null && sf.to < sf.from} onChange={n => setSf(f => (f ? { ...f, from: n } : f))} /></div>
                        <div><div className="text-[13.5px] font-bold text-stone-600">{words.days} {words.to}</div><NumberBox testId="own-stage-to" allowEmpty value={sf.to} label={words.to} language={language} bad={sf.to !== null && sf.to < sf.from} onChange={n => setSf(f => (f ? { ...f, to: n } : f))} /></div>
                    </div>
                    {sf.to !== null && sf.to < sf.from && <p className="m-0 mt-2 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-stage-err">{words.errEnd}</p>}
                    {sf.to === null && <p className="m-0 mt-2 rounded-2xl bg-stone-100 px-3 py-2 text-[14px] font-bold text-stone-700" data-testid="own-stage-need">{words.needStageEnd(sf.name.trim())}</p>}
                    <Tap onClick={commitStage} disabled={!stageOk} data-testid="own-stage-ok" className="mt-3 flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-700 text-[17px] font-extrabold text-white disabled:opacity-50">{sf.index === null ? words.addStage : words.done}</Tap>
                    <Tap onClick={() => setSf(null)} data-testid="own-stage-cancel" className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">{words.cancel}</Tap>
                </section>
            ) : (
                <Tap onClick={() => openStageForm(null)} data-testid="own-add-stage" className="flex min-h-[56px] w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-emerald-600 bg-white text-[17px] font-extrabold text-emerald-900">
                    <Plus size={18} aria-hidden="true" />{words.addStage}
                </Tap>
            )}

            <h4 className="m-0 text-[17px] font-extrabold text-stone-900">{words.changesTitle}</h4>
            <div data-testid="own-changes">
                {items.length === 0
                    ? <p className="m-0 text-[14px] font-bold text-stone-600">{words.noChange}</p>
                    : <ul className="m-0 list-none space-y-1.5 p-0">{items.map((item, i) => <li key={i} className="border-l-4 border-amber-300 pl-2.5 text-[15px] font-bold text-stone-900">{changeText(item, language)}</li>)}</ul>}
            </div>
            <p className="m-0 text-[13.5px] font-bold text-stone-600" data-testid="own-save-note">{words.saveNote}</p>
            {blocked && <p className="m-0 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-blocked">{words.changeWaiting}</p>}
            {problem && <p className="m-0 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-problem">{words.problems[problem.code]}</p>}
            {failed && <p className="m-0 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-save-failed">{planned.sendFailed}</p>}
            <Tap onClick={() => { void save(); }} disabled={!canSave} data-testid="own-save" className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:opacity-50">
                <Check size={20} aria-hidden="true" />{saving ? words.saving : words.save}
            </Tap>
        </div>
    );
};

export default OwnScheduleMaker;
