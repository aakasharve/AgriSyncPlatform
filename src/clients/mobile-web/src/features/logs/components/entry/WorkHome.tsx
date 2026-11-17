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
 *
 * Lane UI-6 (founder D-150, notes 1.2 and 2.4; the approved picture H1): the Home is TWO big doors and nothing louder. Top to
 * bottom: the update card; the question "काय करायचं आहे?" as one small line (the big Sathi banner is gone - the picture has none);
 * the solid green record door (the biggest block); the solid blue "नियोजन करा" door under it (`PlanDoor`); the हजेरी card, only
 * when a head count was said; the money as a full-width dark card.
 */
import React from 'react';
import { ChevronRight, Mic, Users } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { SANS, Tap } from '../../../../shared/components/ui/placeUi';
import { AppUpdateCard } from '../../../appUpdate/AppUpdateCard';
import { HOME_WORDS } from './entryWords';
import { RunningCostCard, type RunningCost } from './RunningCostCard';
import { TodayAttendanceCard } from './TodayAttendanceCard';
import { attendanceCardWords } from './attendanceCardWords';
import { homeAttendanceShape } from './homeAttendanceShape';
import { PlanDoor, type PlanDoorProps } from '../../../plannedWork/components/PlanDoor';
import type { TodayAttendance } from './todayAttendance';

export interface WorkHomeProps {
    onTell: () => void;
    /** Present only when this person may manage labour; absent = no हजेरी part at all. Opens the हजेरी place (its वही). */
    onAttendance?: () => void;
    /** Today's work and headcount as told (the हजेरी card's state). The big card is drawn only once a head count was said (lane UI-6). */
    attendance?: TodayAttendance;
    /** Both told: open the हजेरी screen's names. */
    onAttendanceNames?: () => void;
    /** The running-cost card; absent = not shown to this person. */
    cost?: RunningCost;
    /** Lane L8c-2 - the plan door (which kind, and its farm and person); absent = no door (no farm yet). */
    planDoor?: PlanDoorProps;
}

/** Lane UI-6: the one small quiet line that stands where the हजेरी card is not drawn (44 px high to tap, words as the card has them). */
const AttendanceLine: React.FC<{ shape: 'ask' | 'rest'; onTap: () => void }> = ({ shape, onTap }) => {
    const W = attendanceCardWords(useOptionalLanguage()?.language);
    return (
        <button type="button" onClick={onTap} data-testid={`home-attendance-${shape}`}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-[13.5px] font-bold leading-snug text-stone-600">
            <Users size={16} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{shape === 'ask' ? W.tellCount : W.restDay}</span>
            <ChevronRight size={16} className="shrink-0 text-stone-400" aria-hidden="true" />
        </button>
    );
};

export const WorkHome: React.FC<WorkHomeProps> = ({ onTell, onAttendance, attendance, onAttendanceNames, cost, planDoor }) => {
    const shape = onAttendance && attendance ? homeAttendanceShape(attendance) : 'none';
    return (
        <div className="space-y-3 px-3 pb-6 pt-3" style={{ fontFamily: SANS }} data-testid="work-home">
            <AppUpdateCard />
            <h2 className="m-0 px-1 text-[15px] font-bold leading-snug text-stone-600" data-testid="home-title">{HOME_WORDS.title}</h2>

            <Tap onClick={onTell} data-testid="home-tell" rippleColor="rgba(255,255,255,0.35)"
                className="flex min-h-[132px] w-full items-center gap-3 rounded-[20px] bg-emerald-700 px-4 py-5 text-left text-white shadow-[0_8px_20px_rgba(4,120,87,0.28)]">
                <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-white/20 text-white"><Mic size={28} strokeWidth={2.4} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[26px] font-extrabold leading-[1.15]" data-testid="home-tell-title">{HOME_WORDS.tell}</span>
                    <span className="mt-1 block text-[13px] font-semibold leading-snug text-emerald-50" data-testid="home-tell-sub">{HOME_WORDS.tellSub}</span>
                </span>
                <ChevronRight size={24} className="shrink-0" aria-hidden="true" />
            </Tap>

            {planDoor && <PlanDoor {...planDoor} />}

            {onAttendance && attendance && shape !== 'none' && (
                <div data-testid="home-attendance" data-shape={shape}>
                    {shape === 'card' && <TodayAttendanceCard state={attendance} onTell={onTell} onOpenNames={onAttendanceNames} onOpenRegister={onAttendance} />}
                    {shape === 'ask' && <AttendanceLine shape="ask" onTap={onTell} />}
                    {shape === 'rest' && <AttendanceLine shape="rest" onTap={onAttendance} />}
                </div>
            )}

            {cost && <RunningCostCard cost={cost} />}
        </div>
    );
};

export default WorkHome;
