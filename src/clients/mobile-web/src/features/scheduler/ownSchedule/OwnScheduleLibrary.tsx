/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 4; founder D-132 Q7 = 1 with note, D-136, D-137 Q9 = 1) - "तुमचं स्वतःचं शेड्यूल": the
 * card under planning (v3 screen 2). One live "स्वतःचं शेड्यूल बनवा", then the library OF THE PERSON, grouped by CROP:
 *   - under each crop, one line per plot of this farm saying which of his own schedules it follows (a plot on a different schedule from its neighbour is
 *     visible), "स्वतःचं शेड्यूल नाही" for one that follows none;
 *   - each schedule (its newest version) is a card: its name, "आवृत्ती n · बनवलं: ‹नाव› · date · N कामं", "मालक: ‹नाव›" ONLY when the owner is not the person
 *     who typed the latest version, the "यासाठी बनवलं" line, and which plots of this farm follow it. A name nobody knows is not shown - never an id.
 * What is listed is what the pull carries: the server decides who sees which (every farm of one owner lists them); the phone just lists. Saves still on this
 * phone are listed too (waiting for the net, or refused - with the server's words), so a schedule made with no net is not invisible. Drawn only for a seat
 * that may make (the caller decides); a seat without the authority gets nothing of this - nothing greyed. No sentence about a sale: no transfer exists.
 */
import React, { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { cropNameIn } from '../../../shared/names/namesIn';
import { scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import { usePlotScheduleChoices } from '../schedulePage/usePlotScheduleChoices';
import { shortDateLabel } from './changeList';
import { MadeForPills, Sheet, usePeopleNames, versionLine } from './OwnScheduleBits';
import { derivedDays, type OwnChain } from './ownScheduleModel';
import { OWN_WORDS, ownScheduleRefusalWords, type OwnLanguage } from './ownScheduleWords';
import { useFarmOwnerUserId, useOwnSchedules, usePendingOwnSchedules } from './useOwnSchedules';

export interface OwnScheduleLibraryProps {
    /** The open farm (its owner decides which schedules its plots may follow). */
    farmId: string;
    language: OwnLanguage;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    onMake: () => void;
    onOpen: (chainId: string) => void;
}

/** Which plots of the crops this phone shows follow this chain (any of its versions), by the subscription's own place. */
export function useChainFollowers(chains: readonly OwnChain[], crops: readonly CropProfile[]) {
    const choices = usePlotScheduleChoices();
    return useMemo(() => {
        const versionToChain = new Map<string, string>();
        chains.forEach(c => c.versions.forEach(v => versionToChain.set(v.id, c.id)));
        const followers = new Map<string, string[]>();
        const ownOfPlot = new Map<string, { chainId: string; templateId: string; subscriptionId: string | null }>();
        for (const crop of crops) {
            for (const plot of crop.plots) {
                const own = choices.get(plot.id)?.followed?.find(f => f.origin === 'Own');
                const chainId = own ? versionToChain.get(own.templateId) : undefined;
                if (own && chainId) {
                    ownOfPlot.set(plot.id, { chainId, templateId: own.templateId, subscriptionId: own.subscriptionId ?? null });
                    followers.set(chainId, [...(followers.get(chainId) ?? []), plot.name]);
                }
            }
        }
        return { followers, ownOfPlot };
    }, [chains, crops, choices]);
}

export const OwnScheduleLibrary: React.FC<OwnScheduleLibraryProps> = ({ farmId, language, crops, farmerProfile, onMake, onOpen }) => {
    const words = OWN_WORDS[language];
    const { chains } = useOwnSchedules();
    const pending = usePendingOwnSchedules();
    const nameOf = usePeopleNames(farmerProfile);
    const { followers, ownOfPlot } = useChainFollowers(chains, crops);
    const [who, setWho] = useState(false);
    const farmOwner = useFarmOwnerUserId(farmId);

    const chainsByCrop = useMemo(() => {
        const out = new Map<string, OwnChain[]>();
        for (const chain of chains) {
            const code = scheduleCropCode(chain.cropType);
            out.set(code, [...(out.get(code) ?? []), chain]);
        }
        return out;
    }, [chains]);
    const farmCodes = new Set(crops.map(c => scheduleCropCode(c.name)));
    const otherCodes = [...chainsByCrop.keys()].filter(code => !farmCodes.has(code));
    const chainById = useMemo(() => new Map(chains.map(c => [c.id, c] as const)), [chains]);

    const card = (chain: OwnChain) => {
        const latest = chain.latest;
        const owner = latest.ownerUserId !== latest.madeByUserId ? nameOf(latest.ownerUserId) : null;
        const plots = followers.get(chain.id) ?? [];
        // P006: a schedule of ANOTHER owner than this farm's owner cannot be followed by this farm's plots (the server answers "not found"): said plainly.
        const foreign = farmOwner !== null && latest.ownerUserId !== farmOwner;
        return (
            <Tap key={chain.id} onClick={() => onOpen(chain.id)} data-testid={`own-lib-${chain.id}`}
                className="mt-2 block min-h-[64px] w-full rounded-2xl border border-stone-200 bg-white px-3 py-3 text-left shadow-sm">
                <strong className="block text-[17px] font-black leading-snug text-stone-900">{latest.name}</strong>
                <span className="mt-0.5 block text-[14px] font-bold leading-snug text-stone-600">
                    {versionLine({ version: latest.version ?? chain.versions.length, madeBy: nameOf(latest.madeByUserId), date: shortDateLabel(latest.madeAtUtc, language), works: latest.works.length, owner }, language)}
                </span>
                <MadeForPills testId="own-made-for" cropName={cropNameIn(chain.cropType, language)} days={derivedDays(latest.stages)} madeFor={latest.madeFor} language={language} />
                {foreign
                    ? <span className="mt-1.5 block text-[14px] font-bold text-stone-700" data-testid="own-other-owner-line">{words.cannotFollowHere}</span>
                    : (
                        <span className="mt-1.5 block text-[14px] font-bold text-stone-700" data-testid="own-followers">
                            {plots.length > 0 ? <>{words.followedBy} {plots.join(', ')}</> : words.noFollowers}
                        </span>
                    )}
            </Tap>
        );
    };

    return (
        <section className="space-y-2 rounded-3xl border-2 border-amber-300 bg-amber-50/50 p-3.5" data-testid="own-card">
            <h4 className="m-0 text-[19px] font-extrabold text-stone-900">{words.cardTitle}</h4>
            <p className="m-0 text-[14px] font-bold text-stone-700">{words.ownIntro}</p>
            <Tap onClick={onMake} data-testid="own-make"
                className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 px-4 text-[18px] font-extrabold text-white active:scale-[0.98]">
                <Pencil size={20} aria-hidden="true" />{words.make}
            </Tap>

            {pending.map(p => {
                const refused = p.kind === 'refused';
                const bad = refused || p.kind === 'stuck';
                // The reason, when the phone has words for it: the parked row's own code, or - for a stuck row, which keeps only the server's last
                // message - the code found in that message. Never the server's English.
                const reason = ownScheduleRefusalWords(p.errorCode ?? p.lastError, language);
                return (
                    <div key={p.clientRequestId} data-testid={`own-pending-${p.clientRequestId}`} data-kind={p.kind} role="status"
                        className={`rounded-2xl px-3 py-2.5 ring-1 ${bad ? 'bg-rose-50 ring-rose-200' : 'bg-white ring-stone-200'}`}>
                        <strong className="block text-[16px] font-black text-stone-900">{p.name ?? words.cardTitle}</strong>
                        {refused && <span className="block text-[14px] font-bold text-rose-900">{words.refusedHead}{reason ? ` — ${reason}` : ''}</span>}
                        {p.kind === 'stuck' && <span className="block text-[14px] font-bold text-rose-900">{words.stuck(reason)}</span>}
                        {p.kind === 'held' && <span className="block text-[14px] font-bold text-stone-700">{words.heldByPlan}</span>}
                        {p.kind === 'waiting' && <span className="block text-[14px] font-bold text-stone-600">{words.waiting}</span>}
                    </div>
                );
            })}

            <div className="pt-1">
                <div className="text-[15px] font-extrabold text-stone-900">{words.libTitle}</div>
                <div className="text-[13.5px] font-bold text-stone-600">{words.allFarms}</div>
            </div>

            {crops.map(crop => {
                const code = scheduleCropCode(crop.name);
                const list = chainsByCrop.get(code) ?? [];
                return (
                    <div key={crop.id} data-testid={`own-group-${crop.id}`} className="pt-1">
                        <div className="text-[16px] font-extrabold text-stone-900">{cropNameIn(crop.name, language, crop.masterId)}</div>
                        {crop.plots.map(plot => {
                            const own = ownOfPlot.get(plot.id);
                            const chain = own ? chainById.get(own.chainId) : undefined;
                            return (
                                <div key={plot.id} data-testid={`own-plot-line-${plot.id}`} className="flex gap-2 text-[14.5px] font-bold text-stone-700">
                                    {chain ? words.plotFollows(plot.name, chain.latest.name) : <><b className="font-extrabold">{plot.name}</b><span className="text-stone-500">{words.noOwnPlot}</span></>}
                                </div>
                            );
                        })}
                        {list.length === 0
                            ? <p className="m-0 mt-1 text-[14px] font-bold text-stone-600">{words.noneInCrop}</p>
                            : list.map(card)}
                    </div>
                );
            })}
            {otherCodes.map(code => (
                <div key={code} data-testid={`own-group-other-${code}`} className="pt-1">
                    <div className="text-[16px] font-extrabold text-stone-900">{cropNameIn(chainsByCrop.get(code)?.[0].cropType ?? code, language)}</div>
                    {(chainsByCrop.get(code) ?? []).map(card)}
                </div>
            ))}

            <Tap onClick={() => setWho(true)} data-testid="own-who-link" className="min-h-[48px] rounded-full px-2 text-[15px] font-extrabold text-sky-800 underline underline-offset-2">{words.whoLink}</Tap>
            {who && (
                <Sheet testId="own-who-sheet" title={words.whoTitle} closeLabel={words.close} onClose={() => setWho(false)} closeTestId="own-who-close">
                    <p className="m-0 text-[16px] font-bold leading-snug text-stone-800">{words.whoRuleMake}</p>
                    <p className="m-0 text-[16px] font-bold leading-snug text-stone-800">{words.whoRuleNoCheck}</p>
                </Sheet>
            )}
        </section>
    );
};

export default OwnScheduleLibrary;
