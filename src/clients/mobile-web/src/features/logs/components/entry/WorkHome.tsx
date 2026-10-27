/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H08, H10 / H-13) — the आजची कामे tab opens
 * HERE (preview `postVoiceResult/WorkHome.tsx`, founder-approved look), on real data:
 *   - one big door "झालेले काम सांगा" (the founder's own words) -> crop, then plots, then the mic;
 *   - ONLY for someone who may manage labour (owner tier, or the owner's labour grant): a second
 *     door "आजची हजेरी" that opens the REAL हजेरी screen (route 'labour').
 * A worker gets exactly one door.
 *
 * NOT drawn, on purpose (doctrine P5): the plan door "कामांची जबाबदारी सोपवा / कामांचे नियोजन करा".
 * The founder ruled on 2026-10-26 that the log page has THREE sections (work done, plan, daily wage
 * and attendance), lifting the earlier two-door limit for owners (PENDING-DECISIONS "Answered";
 * defaults in D-24). The plan section is still left out because the server has no planned-work store
 * and no "may plan" permission yet (PLR-D6 §7 points A/B/D/E wait on the D-24 cards): a door to it
 * would promise what the server cannot keep. It comes when that model exists.
 *
 * Below the doors, the running-cost card that sat on the old log screen (re-homed, not dropped).
 */
import React from 'react';
import { ChevronRight, Hand, Mic } from 'lucide-react';
import { SANS, Tap } from '../../../../shared/components/ui/placeUi';
import { HOME_WORDS } from './entryWords';
import { RunningCostCard, type RunningCost } from './RunningCostCard';

export interface WorkHomeProps {
    onTell: () => void;
    /** Present only when this person may manage labour; absent = no हजेरी door at all. */
    onAttendance?: () => void;
    /** The running-cost card; absent = not shown to this person. */
    cost?: RunningCost;
}

export const WorkHome: React.FC<WorkHomeProps> = ({ onTell, onAttendance, cost }) => (
    <div className="space-y-3 px-3 pb-6 pt-3" style={{ fontFamily: SANS }} data-testid="work-home">
        <div className="relative flex min-h-[88px] items-center overflow-visible rounded-[28px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 pl-[26%] pr-3">
            <img src="/images/sathi/sathi-points-down-both.png" alt="" width={1086} height={1448}
                className="pointer-events-none absolute bottom-0 left-1 top-[-8px] h-[calc(100%+8px)] w-[24%] object-contain object-bottom" />
            <h2 className="m-0 py-3 text-[22px] font-extrabold leading-tight text-stone-900" data-testid="home-title">{HOME_WORDS.title}</h2>
        </div>

        <Tap onClick={onTell} data-testid="home-tell" rippleColor="rgba(255,255,255,0.35)"
            className="flex min-h-[132px] w-full items-center gap-4 rounded-[28px] bg-gradient-to-br from-emerald-600 to-emerald-800 p-4 text-left text-white shadow-[0_10px_26px_rgba(5,150,105,0.35)]">
            <span className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full bg-white text-emerald-700 shadow-md"><Mic size={42} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[26px] font-extrabold leading-tight">{HOME_WORDS.tell}</span>
                <span className="mt-1 block text-[16px] font-semibold leading-snug text-emerald-50">{HOME_WORDS.tellSub}</span>
            </span>
            <ChevronRight size={28} className="shrink-0" aria-hidden="true" />
        </Tap>

        {onAttendance && (
            <Tap onClick={onAttendance} data-testid="home-attendance"
                className="flex min-h-[96px] w-full items-center gap-4 rounded-[28px] border-2 border-amber-400 bg-amber-50 p-4 text-left text-stone-900 shadow-sm">
                <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-amber-400 text-white"><Hand size={32} strokeWidth={2.4} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[22px] font-extrabold leading-tight">{HOME_WORDS.attendance}</span>
                    <span className="mt-0.5 block text-[16px] font-semibold leading-snug text-stone-700">{HOME_WORDS.attendanceSub}</span>
                </span>
                <ChevronRight size={26} className="shrink-0 text-amber-700" aria-hidden="true" />
            </Tap>
        )}

        {cost && <RunningCostCard cost={cost} />}
    </div>
);

export default WorkHome;
