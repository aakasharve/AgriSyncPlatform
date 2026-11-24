/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker [LOOP]; approved spec plr-d10-schedule-approved-spec-2026-11-23; doctrine
 * P8, P9, P10) - the schedule maker's ONE-WORK screen for a plot-season's own schedule: one question per card, as the approved v7 "make" deck asks them.
 *
 *   start (only when a checked schedule exists) -> kind -> what (mic first, then type) -> stage (only from the schedule the plot follows; else open, said)
 *   -> when (day / after a work / when seen / later, and how often) -> how (the kind's own question) -> look -> ask -> "माझ्या शेड्यूलमध्ये ठेवा".
 *
 * A required question stops the deck (the kind, then the name: the format cannot hold a work without them); every later card is optional and the save is
 * reachable at once, so a spoken first work is kept in a handful of taps (P9). Back keeps the draft (`workDraftStore`). Saving queues ONE
 * `ownschedule.item.save` through the slice-3 command (offline first, P10) and never makes a plan or touches the main schedule. A new work never inherits
 * its stage's first day: the stage is a place, the day is his.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../../types';
import { Tap } from '../../../../shared/components/ui/placeUi';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import { cropNameIn } from '../../../../shared/names/namesIn';
import { idGenerator } from '../../../../core/domain/services/IdGenerator';
import { OwnScheduleCommands } from '../../../../application/usecases/sync/OwnScheduleCommands';
import { backgroundSyncWorker } from '../../../../infrastructure/sync/BackgroundSyncWorker';
import { plannedWorkWords } from '../../../plannedWork/plannedWorkWords';
import type { PlanSpeechResult } from '../../../plannedWork/data/planVoice';
import type { OwnLanguage } from '../ownScheduleWords';
import { checkedSourceFor, useOwnSchedules } from '../useOwnSchedules';
import { startWordFor, useOfferedStages, useOwnWorks, type OwnWorkPlace } from '../ownWorkPlace';
import { AmberCard, MakerHeader, useMakerVoice } from './makerBits';
import { AskCard, HowCard, KindCard, LookCard, StageCard, WhatCard, WhenCard } from './WorkCards';
import { blankDraft, buildTask, canSave, draftFromCheckedWork, draftFromTask, type WorkDraft } from './workDraft';
import { draftKey, dropWorkDraft, keepWorkDraft, readWorkDraft } from './workDraftStore';
import { dayLabel } from './workLine';
import { WORK_MAKER_WORDS } from './workMakerWords';

export interface OwnWorkCardsProps {
    place: OwnWorkPlace;
    /** The work being changed; null = a new work. */
    taskKey: string | null;
    language: OwnLanguage;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
    onBack: () => void;
    /** The save was handed to the outbox, with the line to say. */
    onSaved: (note: string) => void;
}

type Page = 'start' | 'refs' | 'cards';

export const OwnWorkCards: React.FC<OwnWorkCardsProps> = ({ place, taskKey, language, crops, farmerProfile, understand, onBack, onSaved }) => {
    const words = WORK_MAKER_WORDS[language];
    const planned = plannedWorkWords(language);
    const start = startWordFor(place.cropName);
    const works = useOwnWorks(place);
    const stages = useOfferedStages(place);
    const { rows } = useOwnSchedules();
    const checked = useMemo(() => (taskKey ? null : checkedSourceFor(rows, place.cropName)), [rows, place.cropName, taskKey]);
    const voice = useMakerVoice({ language, crops, farmerProfile, understand });
    const key = draftKey(place.cropCycleId, taskKey);

    const kept = readWorkDraft(key);
    const [draft, setDraft] = useState<WorkDraft | null>(() => kept ?? (taskKey ? null : blankDraft()));
    const [page, setPage] = useState<Page>(() => (kept || taskKey ? 'cards' : 'start'));
    const [earlyOpen, setEarlyOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const savingRef = useRef(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    // A change starts from the work as this phone knows it, once its row is read.
    const editing = taskKey && works ? works.find(w => w.taskKey === taskKey) ?? null : null;
    useEffect(() => {
        if (draft || !editing) return;
        setDraft(draftFromTask(editing.task));
    }, [draft, editing]);
    // "Start" is asked only when there is a checked schedule to start from.
    useEffect(() => { if (page === 'start' && !checked) setPage('cards'); }, [page, checked]);

    const set = (patch: Partial<WorkDraft>) => setDraft(d => {
        const next = { ...(d ?? blankDraft()), ...patch };
        keepWorkDraft(key, next);
        return next;
    });

    const cropShown = cropNameIn(place.cropName, language, place.cropMasterId);
    const header = <MakerHeader title={taskKey ? words.editTitle : words.makerTitle} onBack={onBack} sub={`${cropShown} · ${place.plotName}`} backLabel={planned.back} />;

    if (page === 'start' && checked) {
        return (
            <div className="space-y-3" data-testid="own-work-maker">
                {header}
                <AmberCard testId="own-work-start" title={words.startQ}>
                    <div className="space-y-2">
                        <Tap onClick={() => setPage('cards')} data-testid="own-work-start-blank" className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-amber-700 px-4 text-left text-white">
                            <Plus size={22} aria-hidden="true" />
                            <span><strong className="block text-[17px] font-black">{words.startBlank}</strong><span className="block text-[14px] font-bold text-white/90">{words.startBlankSub}</span></span>
                        </Tap>
                        <Tap onClick={() => setPage('refs')} data-testid="own-work-start-checked" className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-emerald-600 bg-white px-4 text-left text-stone-900">
                            <Check size={22} aria-hidden="true" />
                            <span><strong className="block text-[17px] font-black">{words.startChecked}</strong><span className="block text-[14px] font-bold text-stone-700">{words.startCheckedSub}</span></span>
                        </Tap>
                    </div>
                </AmberCard>
            </div>
        );
    }

    if (page === 'refs' && checked) {
        return (
            <div className="space-y-3" data-testid="own-work-maker">
                <MakerHeader title={checked.name || words.startChecked} onBack={() => setPage('start')} sub={`${cropShown} · ${place.plotName}`} backLabel={planned.back} />
                <AmberCard testId="own-work-refs" title={words.refsQ}>
                    <div className="space-y-2">
                        {checked.works.map((w, i) => (
                            <Tap key={`${w.name}-${i}`} data-testid={`own-work-ref-${i}`} onClick={() => { const d = draftFromCheckedWork(w); keepWorkDraft(key, d); setDraft(d); setPage('cards'); }}
                                className="flex min-h-[56px] w-full flex-col justify-center rounded-2xl border-2 border-stone-200 bg-white px-3 py-1.5 text-left">
                                <b className="block text-[16px] font-extrabold leading-tight text-stone-900">{w.name}</b>
                                <span className="block text-[13px] font-bold text-stone-600">
                                    {words.kinds[w.part]} · {w.endDay > w.startDay ? words.stageDays(dayLabel(w.startDay, words, start), dayLabel(w.endDay, words, start)) : dayLabel(w.startDay, words, start)}
                                </span>
                            </Tap>
                        ))}
                    </div>
                </AmberCard>
            </div>
        );
    }

    if (!draft) return <div className="space-y-3" data-testid="own-work-maker">{header}<div data-testid="own-maker-loading" /></div>;

    const ok = canSave(draft);
    const anchors = (works ?? []).filter(w => w.taskKey !== taskKey).map(w => ({ key: w.taskKey, name: w.task.name }));
    const props = { draft, set, words, language } as const;

    const save = async () => {
        if (savingRef.current || !ok) return;
        savingRef.current = true;
        setSaving(true);
        setFailed(false);
        const orders = (works ?? []).map(w => w.task.order);
        const built = buildTask(draft, {
            taskKey: draft.base?.taskKey ?? taskKey ?? `w-${idGenerator.generate()}`,
            order: draft.base ? draft.base.order : Math.min(9999, orders.length === 0 ? 0 : Math.max(...orders) + 1),
            language,
        });
        try {
            if (!built.ok) throw new Error(built.error);
            await OwnScheduleCommands.save(place, built.value);
        } catch {
            savingRef.current = false;
            if (alive.current) { setFailed(true); setSaving(false); }
            return;
        }
        dropWorkDraft(key);
        backgroundSyncWorker.triggerNow().catch(() => undefined);
        if (alive.current) onSaved(words.savedWaiting);
    };

    const nudge = !draft.kind ? words.needKind : draft.name.trim().length === 0 ? words.needName : null;
    return (
        <div className="space-y-3 pb-2" data-testid="own-work-maker">
            {header}
            <KindCard {...props} />
            {draft.kind && <WhatCard {...props} voice={voice.block(title => set({ name: title }))} />}
            {ok && (
                <>
                    <StageCard {...props} stages={stages} start={start} />
                    <WhenCard {...props} start={start} anchors={anchors} earlyOpen={earlyOpen} openEarly={() => setEarlyOpen(true)} />
                    <HowCard {...props} />
                    <LookCard {...props} />
                    <AskCard {...props} />
                </>
            )}
            {/* FOOT-1: sticks just above the bottom bar, never under it. */}
            <div className="sticky z-10 -mx-3 space-y-1.5 bg-stone-50/95 px-3 pb-2 pt-2" style={{ bottom: BOTTOM_BAR_CLEARANCE }}>
                {nudge && <p className="m-0 text-[14px] font-bold text-stone-700" data-testid="own-work-need">{nudge}</p>}
                {failed && <p className="m-0 text-[14px] font-bold text-rose-800" role="alert" data-testid="own-work-failed">{words.saveFailed}</p>}
                <Tap onClick={() => { void save(); }} disabled={!ok || saving} data-testid="own-work-save"
                    className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:opacity-50">
                    <Check size={20} aria-hidden="true" />{saving ? words.saving : words.save}
                </Tap>
                <p className="m-0 text-[12.5px] font-semibold text-stone-600">{words.nameEnough}</p>
            </div>
        </div>
    );
};

export default OwnWorkCards;
