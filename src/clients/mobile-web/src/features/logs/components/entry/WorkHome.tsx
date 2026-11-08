/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H08, H10 / H-13) — the आजची कामे tab opens
 * HERE (preview `postVoiceResult/WorkHome.tsx`, founder-approved look), on real data:
 *   - one big door "झालेले काम सांगा" (the founder's own words) -> crop, then plots, then the mic;
 *   - ONLY for someone who may manage labour (owner tier, or the owner's labour grant): a second
 *     door "आजची हजेरी" that opens the REAL हजेरी screen (route 'labour').
 * A worker gets the one door to tell work, and his own plan door (lane L8c-2).
 *
 * Lane L8c-2 (founder 2026-10-26: the log page has THREE sections - work done, plan, daily wage and attendance): the plan door
 * is drawn now that the server keeps the tasks and the authorities (L8c-1), so it promises only what the server keeps (P5).
 * For the primary owner or a holder of PlanWork or AssignWork it reads "कामांची जबाबदारी सोपवा / कामांचे नियोजन करा" with
 * "N कामे चालू"; for everyone else "तुमच्यावर सोपवलेली कामे" with his own count (`planDoor.kind`, decided by the caller from the
 * server's authorities, never from a label). It opens the route 'plan-work'.
 *
 * Below the doors, the running-cost card that sat on the old log screen (re-homed, not dropped).
 *
 * Lane UPD-1 (D-53): above the title, the calm "नवीन आवृत्ती आली आहे" card — drawn only when the server
 * names a newer app version than this one (`features/appUpdate`); otherwise nothing at all.
 *
 * Lane FX-1 (founder ATT-LOG, 2026-10-31): the "आजची हजेरी" door became the हजेरी CARD (`TodayAttendanceCard`) — empty,
 * with the rule in big text, until today's work and the headcount are both told; its button is this page's own
 * "झालेले काम सांगा" step (crop → plot → mic, rule CTX-1). Once both are told it opens the names. The old door's way to
 * the हजेरी place (वही, आढावा, people) stays as the card's small "हजेरी वही बघा" link. Same people as before.
 */
import React from 'react';
import { ChevronRight, Mic } from 'lucide-react';
import { SANS, Tap } from '../../../../shared/components/ui/placeUi';
import { AppUpdateCard } from '../../../appUpdate/AppUpdateCard';
import { HOME_WORDS } from './entryWords';
import { RunningCostCard, type RunningCost } from './RunningCostCard';
import { TodayAttendanceCard } from './TodayAttendanceCard';
import { PlanDoor, type PlanDoorProps } from '../../../plannedWork/components/PlanDoor';
import type { TodayAttendance } from './todayAttendance';

export interface WorkHomeProps {
    onTell: () => void;
    /** Present only when this person may manage labour; absent = no हजेरी card at all. Opens the हजेरी place (its वही). */
    onAttendance?: () => void;
    /** Today's work and headcount as told (the हजेरी card's state). The card is drawn only with it. */
    attendance?: TodayAttendance;
    /** Both told: open the हजेरी screen's names. */
    onAttendanceNames?: () => void;
    /** The running-cost card; absent = not shown to this person. */
    cost?: RunningCost;
    /** Lane L8c-2 - the plan door (which kind, and its farm and person); absent = no door (no farm yet). */
    planDoor?: PlanDoorProps;
}

export const WorkHome: React.FC<WorkHomeProps> = ({ onTell, onAttendance, attendance, onAttendanceNames, cost, planDoor }) => (
    <div className="space-y-3 px-3 pb-6 pt-3" style={{ fontFamily: SANS }} data-testid="work-home">
        <AppUpdateCard />
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

        {planDoor && <PlanDoor {...planDoor} />}

        {onAttendance && attendance && (
            <div data-testid="home-attendance">
                <TodayAttendanceCard state={attendance} onTell={onTell} onOpenNames={onAttendanceNames} onOpenRegister={onAttendance} />
            </div>
        )}

        {cost && <RunningCostCard cost={cost} />}
    </div>
);

export default WorkHome;
