/**
 * शेड्यूल लायब्ररी — the schedules the app holds for the farmer's crops (up to 3 per crop), each with who made
 * it, how long it runs and how many stages it has; "पाहा" opens its stages and tasks, "हे शेड्यूल वापरा" adopts
 * it for the chosen crop (only for the same crop).
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2, S15). It was English and showed four
 * score tiles (Adoption x/100, Detail x/100, Followers) and a sort with four orders. The scores are demo
 * fields every real schedule carries as 0 (`TemplateCatalog.mapTemplate`), so they are not drawn (P4), and the
 * three orders built on them or on a date no schedule has ("Highest Adoption", "Most Followed", "Newest")
 * could only reorder equal values (P5). The one real order, shortest first (by the schedule's total days), is
 * kept as a two-chip choice. The per-stage "Stage Notes" were app-made filler (the same English line for
 * every crop, `STAGE_NOTE_FALLBACKS`), not the schedule's, so they are not shown either. Search stays (it also
 * finds the Marathi name). Names are Marathi for the schedules the app ships (`scheduleNames`); a name a person
 * wrote is shown as written, and each task shows the schedule's own name for it.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, picture L2) - the library is now THREE NUMBERED STEPS on one screen:
 *   1 "कोणत्या प्लॉटसाठी?" - the plot chips (the plot the schedule is for, chosen first);
 *   2 "कोणतं शेड्यूल?" - a plain list of radio rows (the maker's badge, the name, who made it) for THAT plot's crop, with the kept search, the kept
 *     order, ShramSafal's check, the sample line, "वापरात आहे" and "पाहा" (the stages);
 *   3 "पक्कं करा" - ONE big button that names the plot ("<plot> साठी हे शेड्यूल लावा"), and under it "नवीन शेड्यूल बनवा", which only asks to go to planning.
 * Nothing else changed in what it offers (`libraryTemplates`) or how a choice is saved (the page's `onAdopt` -> `saveScheduleChoice`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, Plus, Search } from 'lucide-react';
import { CropProfile, CropScheduleTemplate } from '../../../types';
import { UNKNOWN_CROP, getAllTemplates, scheduleCropCode, sortTemplates } from '../../../infrastructure/reference/TemplateCatalog';
import { getOperationCategory } from '../planning/ClientPlanEngine';
import { isSampleSchedule, offeredForCrop } from '../planning/followableDefault';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { BigButton, ChoiceChips, Chip, GlassCard, SANS, Tap } from '../../../shared/components/ui/placeUi';
import { PickerCropPhoto, PlotChip } from '../../context/components/CropPlotPicker';
import { OWNER_LABEL, SC, frequencyMr, opNameMr, stageNameMr } from '../schedulePage/scheduleCopy';
import { cropNameIn } from '../../../shared/names/namesIn';
import { PART_LABEL, partOf } from '../schedulePage/scheduleModel';
import { scheduleNameMr, taskNameMr } from '../schedulePage/scheduleNames';
import { ScheduleCheckBadge } from './ScheduleCheckBadge';
import { ScheduleMakerBadge } from '../pictures/ScheduleMakerBadge';
import { scheduleMapWords, type ScheduleMapLanguage } from '../schedulePage/scheduleMapCopy';

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the library opened from a plot's "हे शेड्यूल पण पाळा": a pick FOLLOWS the schedule on
 * THIS plot as well (`onAdopt` is then an adopt for this plot only - never crop-wide, never a switch). A schedule the plot already follows
 * says so; when the three outside places are taken the button is disabled with the words that say why. The words arrive in the person's
 * language (`threePlusOneCopy`); the phone never counts - `full` is what the page draws, the server refuses a 4th.
 */
export interface LibraryPlotAdd {
    followedTemplateIds: ReadonlySet<string>;
    full: boolean;
    words: { follow: string; fullWhy: string; alreadyFollowed: string; title: string };
    /** UI-8: the plot follows nothing yet - the big button then says the plain "use this schedule", not "follow this one too". */
    followsNone?: boolean;
}

/** UI-8 step 1: one plot the schedule can be for. `cropName` is in his language; `cropRawName` is the stored name (the photo's key). */
export interface LibraryPlotOption {
    id: string;
    name: string;
    cropId: string;
    cropName: string;
    cropRawName: string;
    iconName: string;
    masterId?: string;
    /** The crop's own colour, a Tailwind `bg-...` class. */
    color?: string;
}

interface ScheduleLibraryViewProps {
    crop?: CropProfile;
    allCrops?: CropProfile[];
    adoptedScheduleId?: string | null;
    onAdopt: (templateId: string) => void;
    /** Set when the library was opened to follow one more schedule on one plot (L8b-3). */
    plotAdd?: LibraryPlotAdd;
    /** UI-8 step 1: every plot of the farm; absent = no step 1 (the old callers). */
    plots?: readonly LibraryPlotOption[];
    /** The plot chosen in step 1 (the page's own choice; `crop` is that plot's crop). */
    plotId?: string | null;
    onPickPlot?: (cropId: string, plotId: string) => void;
    /** UI-8 step 3: "नवीन शेड्यूल बनवा" - only asks to go to planning (the page decides whether this seat may; absent = no button). */
    onMakeOwn?: () => void;
    language?: ScheduleMapLanguage;
}

const opLabel = (opId: string): string => opNameMr(opId) ?? PART_LABEL[partOf(getOperationCategory(opId))];

/** The schedule's own name for a task, when it says more than the label or the part. */
const ownName = (opId: string, notes?: string): string | null => {
    const own = notes ? taskNameMr(notes) : '';
    return own && own !== opLabel(opId) && own !== PART_LABEL[partOf(getOperationCategory(opId))] ? own : null;
};

const stageTasks = (template: CropScheduleTemplate, stageId: string): Array<{ label: string; detail: string | null; timing: string }> => [
    ...template.periodicExpectations.filter(i => i.stageId === stageId).map(i => ({ label: opLabel(i.operationTypeId), detail: ownName(i.operationTypeId, i.notes), timing: frequencyMr(i.frequencyMode, i.frequencyValue) })),
    ...template.oneTimeExpectations.filter(i => i.stageId === stageId).map(i => ({ label: opLabel(i.operationTypeId), detail: ownName(i.operationTypeId, i.notes), timing: `दिवस ${i.targetDayFromRef}` })),
];

type Order = 'usual' | 'short';
const ORDERS: ReadonlyArray<readonly [Order, string]> = [
    ['usual', 'नेहमीचा क्रम'], // PROPOSED (Marathi)
    ['short', 'कमी दिवसांचं आधी'], // PROPOSED (Marathi) — the old "Shortest Duration"
];

// spec: plr-d10 lane L8b-1 — the library matches crops by THE crop rule (TemplateCatalog.scheduleCropCode, read through the
// crop master: "द्राक्ष" is Grapes), the same rule the server adopts by. Its own copy here read a Marathi name as no crop.
const canonicalCropCode = scheduleCropCode;

/**
 * spec: plr-d10 lane L8b-1F (founder D-82 note, D-91 = 1) - what a plot may be OFFERED for a new choice. An outside schedule is
 * offered only once ShramSafal has checked it; the samples (the app's built-in ones, and rows the library holds without stored
 * days: they read "not checked") only while their crop has no checked schedule; a withdrawn or sent-back one never. This farm's
 * own schedules (Team / Private) stay hidden until SCH-OWN opens that branch, so no "हे शेड्यूल वापरा" ever leads to a refusal.
 * A plot that already follows a schedule keeps it whatever this says (the page reads the plot's choice, not this list).
 */
// spec: plr-d10 lane SCH-GATE-b (open point 9 (c)) - the rule itself (`isOutsideSchedule`, `isSampleSchedule`, `offeredForCrop`) now lives in
// `planning/followableDefault.ts`, the one file the crop's default and this library both read; it is unchanged.

/** Up to three schedules per crop the farmer grows (most detailed first) — the same rule the page counts by. */
export function libraryTemplates(allCrops: readonly CropProfile[]): CropScheduleTemplate[] {
    const allowed = new Set(allCrops.map(c => canonicalCropCode(c.name)));
    const byCrop = new Map<string, CropScheduleTemplate[]>();
    getAllTemplates().forEach(t => {
        const code = canonicalCropCode(t.cropCode);
        // lane L8b-1 fix round 1 (L5) — an unreadable crop is never a crop: it matches none of the farm's crops.
        if (allowed.size > 0 && (code === UNKNOWN_CROP || !allowed.has(code))) return;
        byCrop.set(code, [...(byCrop.get(code) ?? []), t]);
    });
    const out: CropScheduleTemplate[] = [];
    byCrop.forEach(whole => {
        const bucket = offeredForCrop(whole);
        out.push(...[...bucket].sort((a, b) => {
            const d = (b.periodicExpectations.length + b.oneTimeExpectations.length) - (a.periodicExpectations.length + a.oneTimeExpectations.length);
            return d !== 0 ? d : a.name.localeCompare(b.name);
        }).slice(0, 3));
    });
    return sortTemplates(out);
}

const INTERNAL_AUTHORS = new Set(['ShramSafal Reference Data', 'System Fallback']);
const madeBy = (t: CropScheduleTemplate) => `${OWNER_LABEL[t.ownerType] ?? OWNER_LABEL.SYSTEM_DEFAULT}${t.createdBy && !INTERNAL_AUTHORS.has(t.createdBy) ? ` · ${t.createdBy}` : ''}`;

const StagesSheet: React.FC<{ template: CropScheduleTemplate; onClose: () => void }> = ({ template, onClose }) => {
    useBackDismiss(true, onClose);
    return (
        <div className="fixed inset-0 z-[120] flex justify-center bg-stone-900/40" style={{ fontFamily: SANS }}>
            <div className="flex h-full w-full max-w-md flex-col bg-stone-50" role="dialog" aria-modal="true" aria-label={scheduleNameMr(template.name)} data-testid="library-stages">
                <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5">
                    <Tap onClick={onClose} data-testid="library-stages-back" aria-label="मागे" className="flex min-h-[48px] shrink-0 items-center rounded-full border border-stone-300 bg-white px-4 text-[16px] font-extrabold text-stone-800">← मागे</Tap>
                    <p className="m-0 min-w-0 truncate text-[17px] font-extrabold text-stone-900" data-testid="library-stages-title">{scheduleNameMr(template.name)}</p>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">
                    {[...template.stages].sort((a, b) => a.orderIndex - b.orderIndex).map(stage => {
                        const tasks = stageTasks(template, stage.id);
                        return (
                            <GlassCard key={stage.id} testId={`library-stage-${stage.orderIndex}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="m-0 text-[17px] font-extrabold text-stone-900">{stageNameMr(stage.name)}</h4>
                                    <span className="text-[14px] font-bold text-stone-600">दिवस {stage.dayStart}–{stage.dayEnd}</span>
                                </div>
                                <ul className="m-0 mt-2 space-y-1.5 p-0">
                                    {tasks.length === 0
                                        ? <li className="list-none text-[15px] font-bold text-stone-500">—</li>
                                        : tasks.map((t, i) => (
                                            <li key={i} className="flex list-none items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-stone-200">
                                                <span className="min-w-0 text-[16px] font-extrabold text-stone-800">
                                                    {t.label}
                                                    {t.detail && <span className="block text-[14px] font-bold text-stone-600" data-testid="library-task-detail">{t.detail}</span>}
                                                </span>
                                                <span className="shrink-0 text-[14px] font-bold text-stone-600">{t.timing}</span>
                                            </li>
                                        ))}
                                </ul>
                            </GlassCard>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const STEP_NO: Readonly<Record<ScheduleMapLanguage, readonly [string, string, string]>> = { mr: ['१', '२', '३'], en: ['1', '2', '3'] };

const StepHead: React.FC<{ n: string; title: string; testId: string }> = ({ n, title, testId }) => (
    <div className="flex items-center gap-2.5" data-testid={testId}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-800 text-[16px] font-black text-white" aria-hidden="true">{n}</span>
        <h2 className="m-0 text-[18px] font-extrabold text-stone-900">{title}</h2>
    </div>
);

const ScheduleLibraryView: React.FC<ScheduleLibraryViewProps> = ({ crop, allCrops = [], adoptedScheduleId, onAdopt, plotAdd, plots, plotId = null, onPickPlot, onMakeOwn, language = 'mr' }) => {
    const words = scheduleMapWords(language);
    const stepNo = STEP_NO[language === 'en' ? 'en' : 'mr'];
    const [search, setSearch] = useState('');
    const [order, setOrder] = useState<Order>('usual');
    const [detail, setDetail] = useState<CropScheduleTemplate | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const activeCropCode = crop ? canonicalCropCode(crop.name) : null;
    const sampleCropName = (t: CropScheduleTemplate): string => {
        const own = allCrops.find(c => canonicalCropCode(c.name) === canonicalCropCode(t.cropCode));
        return own ? cropNameIn(own.name, 'mr', own.masterId) : t.cropCode;
    };
    const schedules = useMemo(() => libraryTemplates(allCrops), [allCrops]);
    // Step 2 lists what THE CHOSEN PLOT'S CROP can take (a schedule is only ever for its own crop); with no crop chosen it lists all, none choosable.
    const forCrop = useMemo(() => (activeCropCode ? schedules.filter(t => canonicalCropCode(t.cropCode) === activeCropCode) : schedules), [schedules, activeCropCode]);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        const found = q
            ? forCrop.filter(t => t.name.toLowerCase().includes(q) || scheduleNameMr(t.name).toLowerCase().includes(q) || t.createdBy.toLowerCase().includes(q) || t.cropCode.toLowerCase().includes(q))
            : forCrop;
        return order === 'short' ? sortTemplates(found, 'SHORTEST_DURATION') : found;
    }, [forCrop, search, order]);

    // A pick belongs to the plot it was made for: another plot (or crop) starts with nothing picked.
    useEffect(() => { setPicked(null); }, [plotId, activeCropCode]);

    const lockedFor = (t: CropScheduleTemplate): boolean => {
        const adopted = plotAdd ? false : t.id === adoptedScheduleId;
        const alreadyFollowed = plotAdd?.followedTemplateIds.has(t.id) === true;
        const canAdopt = !!activeCropCode && canonicalCropCode(t.cropCode) === activeCropCode;
        return adopted || alreadyFollowed || !canAdopt;
    };
    const effectivePick = picked && shown.some(t => t.id === picked && !lockedFor(t)) ? picked : null;

    const plot = plots?.find(p => p.id === plotId) ?? null;
    const plotLabel = plot ? `${plot.cropName} · ${plot.name}` : null;
    const confirmLabel = plotLabel
        ? (plotAdd && !plotAdd.followsNone ? words.confirmAdd(plotLabel) : words.confirm(plotLabel))
        : plotAdd ? plotAdd.words.follow : 'हे शेड्यूल वापरा'; // PROPOSED (Marathi) - the old button's own words, when no plot is named
    const full = plotAdd?.full === true;

    return (
        <div className="space-y-4" style={{ fontFamily: SANS }} data-testid="schedule-library">
            {plots && plots.length > 0 && (
                <section className="space-y-2" data-testid="library-step-plot">
                    <StepHead n={stepNo[0]} title={words.step1} testId="library-step-1" />
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={words.step1} data-testid="library-plots">
                        {plots.map(p => (
                            <PlotChip key={p.id} testId={`library-plot-${p.id}`} name={`${p.cropName} · ${p.name}`} on={p.id === plotId} color={p.color}
                                lead={<PickerCropPhoto crop={{ name: p.cropRawName, iconName: p.iconName, masterId: p.masterId }} px={22} />}
                                onClick={() => onPickPlot?.(p.cropId, p.id)} />
                        ))}
                    </div>
                </section>
            )}

            <section className="space-y-2" data-testid="library-step-schedule">
                <StepHead n={stepNo[1]} title={words.step2} testId="library-step-2" />
                <label className="flex min-h-[52px] items-center gap-2 rounded-2xl bg-white px-3 ring-1 ring-stone-300">
                    <Search size={20} className="shrink-0 text-stone-500" aria-hidden="true" />
                    {/* PROPOSED (Marathi) */}
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="शेड्यूल किंवा बनवणाऱ्याचं नाव शोधा" data-testid="library-search"
                        className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-stone-900 outline-none" />
                </label>
                {forCrop.length > 1 && <ChoiceChips items={ORDERS} value={order} onPick={setOrder} testId="library-order" />}
                {/* PROPOSED (Marathi) */}
                {schedules.length === 0 && <p className="m-0 rounded-2xl bg-stone-50 p-3 text-[15px] font-bold text-stone-600 ring-1 ring-stone-200" data-testid="library-empty">तुमच्या पिकांसाठी अजून एकही शेड्यूल आलेलं नाही. इंटरनेट चालू असताना ॲप उघडा.</p>}
                <div className="space-y-2" role="radiogroup" aria-label={words.step2} data-testid="library-list">
                    {shown.map(t => {
                        const adopted = plotAdd ? false : t.id === adoptedScheduleId;
                        const alreadyFollowed = plotAdd?.followedTemplateIds.has(t.id) === true;
                        const locked = lockedFor(t);
                        const on = effectivePick === t.id;
                        return (
                            <div key={t.id} data-testid={`library-${t.id}`} data-picked={on ? 'yes' : 'no'}
                                className={`flex flex-col gap-1 rounded-2xl border-2 p-2 ${on ? 'border-[#1448E6] bg-blue-50' : 'border-stone-200 bg-white'}`}>
                                <label className={`flex min-h-[56px] w-full min-w-0 items-start gap-2.5 focus-within:ring-2 focus-within:ring-[#1448E6]/40 ${locked ? 'opacity-90' : 'cursor-pointer'}`}>
                                    <input type="radio" name="library-schedule" className="sr-only" checked={on} disabled={locked} onChange={() => setPicked(t.id)} data-testid={`library-pick-${t.id}`} />
                                    <span aria-hidden="true" className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-[#1448E6]' : 'border-stone-400'} ${locked ? 'bg-stone-100' : 'bg-white'}`}>
                                        {on && <span className="h-3 w-3 rounded-full bg-[#1448E6]" />}
                                    </span>
                                    <ScheduleMakerBadge template={t} size={44} tone="light" testId={`library-badge-${t.id}`} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block break-words text-[16px] font-black leading-snug text-stone-900" data-testid={`library-name-${t.id}`}>{scheduleNameMr(t.name)}</span>
                                        {/* PROPOSED (Marathi) */}
                                        <span className="block text-[14px] font-bold text-stone-600">कोणी बनवलं: {madeBy(t)}</span>
                                        <span className="block text-[13px] font-bold text-stone-600">{SC.edMeta(t.totalDurationDays ?? null, t.stages.length)}</span>
                                        {/* spec: plr-d10 lane SCH-A - ShramSafal's check, from the server's record only */}
                                        <ScheduleCheckBadge template={t} testId={`library-check-${t.id}`} />
                                        {/* spec: plr-d10 lane L8b-1F (D-91 = 1) - a sample says it will go once its crop has a checked schedule */}
                                        {isSampleSchedule(t) && <span className="mt-1 block text-[13.5px] font-bold text-stone-600" data-testid={`library-sample-line-${t.id}`}>{SC.sampleWillHide(sampleCropName(t))}</span>}
                                        {adopted && <span className="mt-1 block"><Chip tone="green"><CheckCircle2 size={14} aria-hidden="true" />{words.inUse}</Chip></span>}
                                        {alreadyFollowed && <span className="mt-1 block"><Chip tone="green"><CheckCircle2 size={14} aria-hidden="true" />{plotAdd!.words.alreadyFollowed}</Chip></span>}
                                    </span>
                                </label>
                                <Tap onClick={() => setDetail(t)} data-testid={`library-view-${t.id}`} aria-label={`${scheduleNameMr(t.name)} — पाहा`}
                                    className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 self-end rounded-full bg-white px-3 text-[14.5px] font-extrabold text-stone-800 ring-1 ring-stone-300">
                                    {/* PROPOSED (Marathi) */}
                                    <Eye size={18} aria-hidden="true" />पाहा
                                </Tap>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="space-y-2" data-testid="library-step-confirm">
                <StepHead n={stepNo[2]} title={words.step3} testId="library-step-3" />
                <BigButton onClick={() => { if (effectivePick) onAdopt(effectivePick); }} testId="library-confirm" disabled={!effectivePick || full}>{confirmLabel}</BigButton>
                {/* spec: plr-d10 lane L8b-3 - while the three outside places are taken the button is disabled with the words that say why */}
                {full && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid="library-full">{plotAdd!.words.fullWhy}</p>}
                {!full && !effectivePick && shown.length > 0 && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid="library-confirm-hint">{words.confirmNeedsPick}</p>}
                {onMakeOwn && (
                    <button type="button" onClick={onMakeOwn} data-testid="library-make-own"
                        className="flex min-h-[56px] w-full flex-wrap items-center justify-center gap-x-2 rounded-full border-2 border-[#1448E6] bg-white px-4 py-1.5 text-[16px] font-extrabold text-[#1448E6] active:scale-[0.98]">
                        <Plus size={18} aria-hidden="true" />{words.makeNew}
                        <span className="text-[12.5px] font-bold">({words.makeNewHint})</span>
                    </button>
                )}
            </section>
            {detail && <StagesSheet template={detail} onClose={() => setDetail(null)} />}
        </div>
    );
};

export default ScheduleLibraryView;
