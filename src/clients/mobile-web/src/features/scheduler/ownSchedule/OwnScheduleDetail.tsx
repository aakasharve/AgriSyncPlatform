/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Tasks 5, 6, 7; founder D-132 Q4 = 1 with note, Q6 = 1, Q8 = 1, D-137 Q9 = 1, Q10 = 1) - ONE
 * own schedule (v3 screen 7): what it was made for, who follows it, and what changed.
 *   - each plot of this crop has its OWN tap "हे पाळा" through the EXISTING adopt (`saveScheduleChoice`, this plot only; no new write kind); saving never
 *     made a plot follow. A plot on an older version says so and taps again to take the newer one (a migrate from its own row); a plot on another of his
 *     own schedules switches the same way; one already on the newest says so and offers "हे सोडा";
 *   - the QUIET variety line under a plot whose own variety differs from the schedule's - grey, never blocks, "हे पाळा" still works. Soil, region, climate:
 *     tags only, no line (the phone knows nothing of a plot's values);
 *   - no check, no badge: no check applies to his own schedule (D-82 = 3);
 *   - "बदलांची यादी": one line per change - what, date, name - worked out from the versions (`changeList.ts`), not old versions to open;
 *   - a schedule with no works answers "आधी कामं जोडा" instead of being followed.
 * The server decides what a follow is worth (3 + 1, ids, authority); the phone sends the tap and shows the server's refusal in words (P9, P10).
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { cropNameIn } from '../../../shared/names/namesIn';
import { scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import { plannedWorkWords } from '../../plannedWork/plannedWorkWords';
import { saveScheduleAbandon, saveScheduleChoice } from '../schedulePage/saveScheduleChoice';
import { THREE_PLUS_ONE_WORDS } from '../schedulePage/threePlusOneCopy';
import { changeEntries, shortDateLabel } from './changeList';
import { MadeForPills, Sheet, usePeopleNames, versionLine } from './OwnScheduleBits';
import { useChainFollowers } from './OwnScheduleLibrary';
import { derivedDays } from './ownScheduleModel';
import { OWN_WORDS, type OwnLanguage } from './ownScheduleWords';
import { useFarmOwnerUserId, useOwnSchedules } from './useOwnSchedules';
import { varietyMismatch } from './varietyLine';

export interface OwnScheduleDetailProps {
    /** The open farm (its owner decides whether its plots may follow this schedule). */
    farmId: string;
    chainId: string;
    language: OwnLanguage;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    onBack: () => void;
    /** Opens the maker on the newest version (a change writes a NEW version). */
    onEdit: () => void;
}

export const OwnScheduleDetail: React.FC<OwnScheduleDetailProps> = ({ farmId, chainId, language, crops, farmerProfile, onBack, onEdit }) => {
    const words = OWN_WORDS[language];
    const { chains } = useOwnSchedules();
    const nameOf = usePeopleNames(farmerProfile);
    const { ownOfPlot } = useChainFollowers(chains, crops);
    const [emptySheet, setEmptySheet] = useState(false);
    const [who, setWho] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const farmOwner = useFarmOwnerUserId(farmId);

    const chain = chains.find(c => c.id === chainId);
    const chainById = useMemo(() => new Map(chains.map(c => [c.id, c] as const)), [chains]);
    if (!chain) return <div data-testid="own-detail-loading" />;

    const latest = chain.latest;
    const code = scheduleCropCode(chain.cropType);
    const farmCrops = crops.filter(c => scheduleCropCode(c.name) === code);
    const entries = changeEntries(chain, { nameOf, language });
    const owner = latest.ownerUserId !== latest.madeByUserId ? nameOf(latest.ownerUserId) : null;
    const notSent = THREE_PLUS_ONE_WORDS[language].notSent;
    // P006: only where this schedule's owner is the owner of this farm. When the phone does not know the farm's owner the offer stays (the server decides).
    const foreign = farmOwner !== null && latest.ownerUserId !== farmOwner;

    const follow = async (plotId: string) => {
        if (latest.works.length === 0) { setEmptySheet(true); return; }
        const own = ownOfPlot.get(plotId);
        const result = await saveScheduleChoice([{ plotId, templateId: latest.id, own: true, ...(own?.subscriptionId ? { replaces: own.subscriptionId } : { add: true }) }]);
        setToast(result.missing.length > 0 ? words.followMissing : result.notSent.length > 0 ? notSent : words.toastFollowing);
    };
    const leave = async (subscriptionId: string) => {
        const result = await saveScheduleAbandon(subscriptionId);
        if (result.done) setToast(words.toastLeft);
    };

    return (
        <div className="space-y-3" data-testid="own-detail">
            <div className="flex items-center gap-2">
                <Tap onClick={onBack} data-testid="own-back" aria-label={plannedWorkWords(language).back}
                    className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-md">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} aria-hidden="true" /></span>
                </Tap>
                <h3 className="m-0 min-w-0 flex-1 text-[20px] font-extrabold leading-tight text-stone-900" data-testid="own-detail-title">{latest.name}</h3>
            </div>

            <section className="rounded-3xl border border-stone-200 bg-white p-3.5">
                <p className="m-0 text-[14.5px] font-bold text-stone-700" data-testid="own-detail-line">
                    {versionLine({ version: latest.version ?? chain.versions.length, madeBy: nameOf(latest.madeByUserId), date: shortDateLabel(latest.madeAtUtc, language), works: latest.works.length, owner }, language)}
                </p>
                <MadeForPills testId="own-detail-made-for" cropName={cropNameIn(chain.cropType, language)} days={derivedDays(latest.stages)} madeFor={latest.madeFor} language={language} />
                <p className="m-0 mt-2 text-[14px] font-bold text-stone-600">{words.noCheckNeeded}</p>
                <Tap onClick={onEdit} data-testid="own-edit" className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 text-[17px] font-extrabold text-white">
                    <Pencil size={18} aria-hidden="true" />{words.change}
                </Tap>
                <Tap onClick={() => setWho(true)} data-testid="own-who-link" className="mt-1 min-h-[48px] rounded-full px-2 text-[15px] font-extrabold text-sky-800 underline underline-offset-2">{words.whoLink}</Tap>
            </section>

            {latest.works.length === 0 && (
                <p className="m-0 rounded-2xl bg-stone-100 px-3 py-3 text-[15px] font-extrabold text-stone-800" data-testid="own-detail-empty">{words.emptyHead}</p>
            )}

            <section className="rounded-3xl border border-stone-200 bg-white p-3.5">
                <h4 className="m-0 text-[16px] font-extrabold text-stone-900">{words.plotsTitle}</h4>
                {foreign && <p className="m-0 mt-1 text-[14px] font-bold text-stone-700" data-testid="own-detail-other-owner">{words.cannotFollowHere}</p>}
                {!foreign && farmCrops.flatMap(c => c.plots).length === 0 && <p className="m-0 mt-1 text-[14px] font-bold text-stone-600">{words.noPlotsHere}</p>}
                {!foreign && farmCrops.map(c => c.plots.map(plot => {
                    const own = ownOfPlot.get(plot.id);
                    const sameChain = own?.chainId === chain.id;
                    const otherChain = own && !sameChain ? chainById.get(own.chainId) : undefined;
                    const heldVersion = own && sameChain ? chain.versions.find(v => v.id === own.templateId) : undefined;
                    const onNewest = sameChain && own?.templateId === latest.id;
                    const soft = varietyMismatch(latest.madeFor.variety, plot, c.name);
                    return (
                        <div key={plot.id} data-testid={`own-plot-${plot.id}`} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2">
                            <div className="min-w-0 flex-1">
                                <strong className="block text-[16px] font-black text-stone-900">{plot.name}</strong>
                                <span className="block text-[14px] font-bold text-stone-700">
                                    {onNewest ? words.followsThis
                                        : sameChain ? words.followsOld(heldVersion?.version ?? 0, latest.version ?? chain.versions.length)
                                            : otherChain ? words.followsOther(otherChain.latest.name)
                                                : words.notFollow}
                                </span>
                                {soft && (
                                    <span className="mt-0.5 block text-[13.5px] font-semibold text-stone-500" data-testid={`own-soft-variety-${plot.id}`}>
                                        {words.softVariety(soft.schedule, soft.plot)}
                                    </span>
                                )}
                            </div>
                            {onNewest
                                ? own?.subscriptionId && <Tap onClick={() => { void leave(own.subscriptionId as string); }} data-testid={`own-leave-${plot.id}`} className="min-h-[48px] rounded-full px-3 text-[16px] font-extrabold text-rose-700 underline underline-offset-2">{words.leave}</Tap>
                                : <Tap onClick={() => { void follow(plot.id); }} data-testid={`own-follow-${plot.id}`} className="min-h-[48px] rounded-full bg-emerald-700 px-5 text-[16px] font-extrabold text-white">{words.follow}</Tap>}
                        </div>
                    );
                }))}
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-3.5">
                <h4 className="m-0 text-[16px] font-extrabold text-stone-900">{words.changesTitle}</h4>
                <ul className="m-0 mt-2 list-none space-y-2 p-0" data-testid="own-changes-list">
                    {entries.map((e, i) => (
                        <li key={`${e.versionId}-${i}`} className="border-l-4 border-amber-300 pl-2.5">
                            <div className="text-[15px] font-bold text-stone-900">{e.text}</div>
                            <div className="text-[13px] font-bold text-stone-500">
                                {[e.dateLabel, e.byName, e.showVersion ? words.versionN(e.version) : null].filter((p): p is string => !!p).join(' · ')}
                            </div>
                        </li>
                    ))}
                </ul>
                <p className="m-0 mt-2 text-[13.5px] font-bold text-stone-600">{words.saveNote}</p>
            </section>

            {toast && <p role="status" className="m-0 rounded-2xl bg-stone-900 px-4 py-3 text-[15px] font-extrabold text-white" data-testid="own-toast">{toast}</p>}

            {emptySheet && (
                <Sheet testId="own-empty-sheet" title={words.emptyHead} closeLabel={words.close} onClose={() => setEmptySheet(false)} closeTestId="own-empty-close">
                    <p className="m-0 text-[16px] font-bold text-stone-800">{words.emptyBody}</p>
                    <Tap onClick={() => { setEmptySheet(false); onEdit(); }} data-testid="own-empty-add" className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-700 text-[17px] font-extrabold text-white">{words.addWork}</Tap>
                </Sheet>
            )}
            {who && (
                <Sheet testId="own-who-sheet" title={words.whoTitle} closeLabel={words.close} onClose={() => setWho(false)} closeTestId="own-who-close">
                    <p className="m-0 text-[16px] font-bold leading-snug text-stone-800">{words.whoRuleMake}</p>
                    <p className="m-0 text-[16px] font-bold leading-snug text-stone-800">{words.whoRuleNoCheck}</p>
                </Sheet>
            )}
        </div>
    );
};

export default OwnScheduleDetail;
