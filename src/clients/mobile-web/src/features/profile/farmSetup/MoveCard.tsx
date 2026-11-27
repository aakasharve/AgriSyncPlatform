/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P10; contract §6, CTO Q2 = yes) - the question this phone asks its own person
 * about the water, motor, power and machine details it held before, on पाणी आणि वीज and यंत्रं once the server has sent the farm's set. Nothing is sent
 * by itself (rule 1). He may change the setup on:
 *   - ONE farm  -> the card for it, his items listed (ticked; UNTICKED when the farm already has a set on the server - rule 7), "हो, पाठवा" / "आत्ता नको";
 *   - SEVERAL   -> first "ही माहिती कोणत्या शेताची आहे?" with his farms and "कोणत्याही नाही", then the card for the one he picked (one farm only);
 *   - NONE      -> nothing is sent; the note says his details stay on this phone and who can send them.
 * "आत्ता नको" (and "कोणत्याही नाही") keep a small "या फोनवरची जुनी माहिती" row until he sends or dismisses it. The flag is kept per person. Every
 * Marathi line is PROPOSED (farmSetupWords); the page's font is inherited.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Check, Smartphone } from 'lucide-react';
import { GlassCard, Tap } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FarmerProfile } from '../../../domain/types/farm.types';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import { farmSetupWords } from './farmSetupWords';
import { useFarmSetup } from './useFarmSetup';
import type { LocalFarmSetup } from './farmSetupLocal';
import { allKeys, hasMovable, movableItems, readMoveFlag, sendMove, writeMoveFlag, type MoveFlag, type MoveState } from './moveModel';

export interface MoveFarm { farmId: string; name: string }

interface Props {
    profile: FarmerProfile;
    userId: string | null | undefined;
    /** The farms this person may change the setup of ("edit farm setup"), with their names. */
    editableFarms: readonly MoveFarm[];
}

/** Rule 7: the farm already has a set ON THE SERVER (this phone's own waiting changes are not "someone moved first"). */
const filledOnServer = (local: LocalFarmSetup | null): boolean => !!local?.received && (
    local.waterSources.some(s => s.item.revision > 0) || local.machines.some(m => m.item.revision > 0) || (local.powerTimes?.item.revision ?? 0) > 0);

export const MoveCard: React.FC<Props> = ({ profile, userId, editableFarms }) => {
    const language = useOptionalLanguage()?.language;
    const w = farmSetupWords(language).move;
    const items = useMemo(() => movableItems(profile), [profile]);
    const [flag, setFlag] = useState<MoveFlag | null | undefined>(undefined);
    const [picked, setPicked] = useState<string | null>(null);
    const [reopened, setReopened] = useState(false);
    const [ticks, setTicks] = useState<Set<string> | null>(null);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const chosenFarmId = editableFarms.length === 1 ? editableFarms[0].farmId : picked;
    const chosen = editableFarms.find(f => f.farmId === chosenFarmId) ?? null;
    const local = useFarmSetup(chosenFarmId);
    const filled = filledOnServer(local);

    useEffect(() => {
        if (!userId) return;
        let alive = true;
        void readMoveFlag(getDatabase(), userId).then(f => { if (alive) setFlag(f); }, () => { if (alive) setFlag(null); });
        return () => { alive = false; };
    }, [userId]);

    // the ticks start when the chosen farm's set is known: all ticked, or none when the farm already has a set (rule 7)
    useEffect(() => { setTicks(null); }, [chosenFarmId]);
    useEffect(() => {
        if (ticks === null && local && chosenFarmId) setTicks(new Set(filled ? [] : allKeys(items)));
    }, [ticks, local, chosenFarmId, filled, items]);

    const remember = async (state: MoveState, farmId?: string) => {
        if (!userId) return;
        const next: MoveFlag = { state, ...(farmId ? { farmId } : {}), at: systemClock.nowISO() };
        await writeMoveFlag(getDatabase(), userId, next);
        setFlag(next);
        setReopened(false);
    };

    if (sentTo) {
        return <p data-testid="move-sent" className="m-0 rounded-2xl bg-emerald-50 px-3 py-2 text-[13.5px] font-bold text-emerald-900 ring-1 ring-emerald-200">{w.sent(sentTo)}</p>;
    }
    if (!userId || flag === undefined || !hasMovable(items) || flag?.state === 'sent' || flag?.state === 'dismissed') return null;

    if (flag?.state === 'later' && !reopened) {
        return (
            <div data-testid="move-old-row" className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-200">
                <Smartphone size={17} className="shrink-0 text-stone-500" aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1 basis-[8rem] text-[14px] font-extrabold text-stone-800">{w.oldRow}</p>
                <Tap onClick={() => { setReopened(true); setPicked(null); }} data-testid="move-old-open" className="min-h-[44px] rounded-full bg-blue-700 px-3.5 text-[13.5px] font-extrabold text-white">{w.oldRowOpen}</Tap>
                <Tap onClick={() => { void remember('dismissed'); }} data-testid="move-old-dismiss" className="min-h-[44px] rounded-full bg-white px-3.5 text-[13.5px] font-extrabold text-stone-700 ring-1 ring-stone-300">{w.oldRowDismiss}</Tap>
            </div>
        );
    }

    if (editableFarms.length === 0) {
        return <p data-testid="move-phone-only" className="m-0 rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200">{w.phoneOnlyNote}</p>;
    }

    if (!chosen) {
        return (
            <GlassCard testId="move-which-farm">
                <p className="m-0 text-[15.5px] font-extrabold text-stone-900">{w.whichFarm}</p>
                <div className="mt-2 space-y-1.5">
                    {editableFarms.map(f => (
                        <Tap key={f.farmId} onClick={() => setPicked(f.farmId)} data-testid={`move-farm-${f.farmId}`}
                            className="flex min-h-[48px] w-full items-center rounded-xl bg-white px-3 text-left text-[15px] font-extrabold text-stone-900 ring-1 ring-stone-300 [overflow-wrap:anywhere]">{f.name}</Tap>
                    ))}
                    <Tap onClick={() => { void remember('later'); }} data-testid="move-no-farm"
                        className="flex min-h-[48px] w-full items-center rounded-xl bg-stone-50 px-3 text-left text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-200">{w.noFarm}</Tap>
                </div>
            </GlassCard>
        );
    }

    // the card waits for its ticks (the chosen farm's set read first), so a tap never sends with the wrong ticks
    if (ticks === null) return null;

    const lines = [
        ...items.sources.map(s => ({ key: s.key, label: w.itemSource(s.source.name, s.motors.length) })),
        ...(items.power ? [{ key: items.power.key, label: w.itemPower }] : []),
        ...items.machines.map(m => ({ key: m.key, label: w.itemMachine(m.machine.name) })),
    ];
    const toggle = (key: string) => setTicks(prev => {
        const next = new Set(prev ?? []);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const send = async () => {
        if (ticks.size === 0) return;
        const ticked = ticks;
        const failed = await sendMove(chosen.farmId, items, ticked);
        if (failed.length === 0) {
            await remember('sent', chosen.farmId);
            setSentTo(chosen.name);
        } else {
            setTicks(new Set(failed));
        }
    };

    return (
        <GlassCard testId="move-card" className="ring-2 ring-blue-200">
            <p className="m-0 text-[15.5px] font-extrabold leading-snug text-stone-900 [overflow-wrap:anywhere]">{w.sendAsk(chosen.name)}</p>
            {filled && <p className="m-0 mt-1.5 text-[13.5px] font-bold text-amber-800" data-testid="move-already-filled">{w.alreadyFilled}</p>}
            <div className="mt-2 space-y-1.5">
                {lines.map(line => {
                    const on = ticks.has(line.key);
                    return (
                        <Tap key={line.key} onClick={() => toggle(line.key)} aria-pressed={on} data-testid={`move-item-${line.key}`}
                            className={`flex min-h-[46px] w-full items-center gap-2 rounded-xl px-3 text-left text-[14.5px] font-extrabold [overflow-wrap:anywhere] ${on ? 'bg-blue-50 text-blue-900 ring-2 ring-blue-500' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${on ? 'bg-blue-700 text-white' : 'ring-1 ring-stone-300'}`}>{on && <Check size={15} aria-hidden="true" />}</span>
                            {line.label}
                        </Tap>
                    );
                })}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
                <Tap onClick={() => { void remember('later'); }} data-testid="move-not-now" className="min-h-[48px] rounded-full bg-white text-[14.5px] font-extrabold text-stone-700 ring-1 ring-stone-300">{w.notNow}</Tap>
                <Tap onClick={() => { void send(); }} data-testid="move-send" className="min-h-[48px] rounded-full bg-blue-700 text-[14.5px] font-extrabold text-white">{w.yesSend}</Tap>
            </div>
        </GlassCard>
    );
};
