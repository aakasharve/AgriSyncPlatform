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
 * when a head count was said - and until then a small note that says when हजेरी works (work first, then the head count),
 * never nothing (founder follow-up 2026-11-19); the money as a full-width dark card.
 */
import React from 'react';
import { ChevronRight, Mic, Users } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { SANS, Tap } from '../../../../shared/components/ui/placeUi';
import { AppUpdateCard } from '../../../appUpdate/AppUpdateCard';
import { HOME_WORDS } from './entryWords';
import { RunningCostCard, type RunningCost } from './RunningCostCard';
import { TodayAttendanceCard, workText } from './TodayAttendanceCard';
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

/**
 * Lane UI-6 (founder D-150, and his follow-up of 2026-11-19: "do not remove the हजेरी part - say when it works"): where the big
 * हजेरी card is NOT drawn (no head count said yet) a small dashed note stands in its place and says the rule, so the feature is
 * never hidden:
 *   'rule' - nothing told yet: "झालेलं काम सांगितल्यानंतरच तुम्ही हजेरी घेऊ शकता ... आधी कोणत्या पिकावर, कोणत्या प्लॉटवर काम झालं ते सांगा."
 *            Plain text, no tap (the green door right above is the way in).
 *   'ask'  - the work is told, the head count is not: the same note, echoing what was told, and ONE tap ("किती जण होते ते सांगा")
 *            that opens the same crop -> plot -> mic step as the green door (the card's old button).
 * Words are the card's own file (`attendanceCardWords.ts`), one language at a time.
 */
const AttendanceNote: React.FC<{ shape: 'rule' | 'ask'; state: TodayAttendance; onTap: () => void }> = ({ shape, state, onTap }) => {
    const language = useOptionalLanguage()?.language;
    const W = attendanceCardWords(language);
    const look = 'block w-full rounded-[16px] border-2 border-dashed border-stone-300 bg-white px-3.5 py-3 text-left';
    const head = (
        <span className="flex items-center gap-2 text-[14px] font-extrabold leading-snug text-stone-700">
            <Users size={18} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />{W.title}
        </span>
    );
    if (shape === 'rule') {
        return (
            <div data-testid="home-attendance-rule" className={look}>
                {head}
                <span className="mt-1.5 block text-[13px] font-semibold leading-snug text-stone-700">{W.homeRuleWork}</span>
            </div>
        );
    }
    const what = state.work ? workText(state.work, language) : '';
    return (
        <button type="button" onClick={onTap} data-testid="home-attendance-ask" className={look}>
            {head}
            <span data-testid="home-attendance-told" className="mt-1.5 block text-[13px] font-bold leading-snug text-emerald-700">{W.workTold(what)}</span>
            <span className="mt-1 block text-[13px] font-semibold leading-snug text-stone-700">{W.homeRuleCount}</span>
            <span className="mt-1 flex min-h-[44px] items-center justify-between gap-2 text-[14.5px] font-extrabold leading-snug text-emerald-700">
                <span className="min-w-0">{W.tellCount}</span>
                <ChevronRight size={18} className="shrink-0" aria-hidden="true" />
            </span>
        </button>
    );
};

/** A declared rest day (D-62): the card's own one sentence as ONE small line, opening the हजेरी place (its वही). */
const RestDayLine: React.FC<{ onTap: () => void }> = ({ onTap }) => {
    const W = attendanceCardWords(useOptionalLanguage()?.language);
    return (
        <button type="button" onClick={onTap} data-testid="home-attendance-rest"
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-[13.5px] font-bold leading-snug text-stone-600">
            <Users size={16} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{W.restDay}</span>
            <ChevronRight size={16} className="shrink-0 text-stone-400" aria-hidden="true" />
        </button>
    );
};

export const WorkHome: React.FC<WorkHomeProps> = ({ onTell, onAttendance, attendance, onAttendanceNames, cost, planDoor }) => {
    // Only a person handed the हजेरी door (and its state) gets any हजेरी part; the others get none at all.
    const shape = onAttendance && attendance ? homeAttendanceShape(attendance) : null;
    return (
        <div className="space-y-3 px-3 pb-6 pt-3" style={{ fontFamily: SANS }} data-testid="work-home">
            <AppUpdateCard />
            <h2 className="m-0 px-1 text-[15px] font-bold leading-snug text-stone-600" data-testid="home-title">{HOME_WORDS.title}</h2>

            <Tap onClick={onTell} data-testid="home-tell" rippleColor="rgba(255,255,255,0.35)"
                className="flex min-h-[144px] w-full items-center gap-3 rounded-[20px] bg-emerald-700 px-4 py-5 text-left text-white shadow-[0_8px_20px_rgba(4,120,87,0.28)]">
                <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-white/20 text-white"><Mic size={28} strokeWidth={2.4} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[26px] font-extrabold leading-[1.15]" data-testid="home-tell-title">{HOME_WORDS.tell}</span>
                    <span className="mt-1 block text-[13px] font-semibold leading-snug text-emerald-50" data-testid="home-tell-sub">{HOME_WORDS.tellSub}</span>
                </span>
                <ChevronRight size={24} className="shrink-0" aria-hidden="true" />
            </Tap>

            {planDoor && <PlanDoor {...planDoor} />}

            {onAttendance && attendance && shape && (
                <div data-testid="home-attendance" data-shape={shape}>
                    {shape === 'card' && <TodayAttendanceCard state={attendance} onTell={onTell} onOpenNames={onAttendanceNames} onOpenRegister={onAttendance} />}
                    {(shape === 'rule' || shape === 'ask') && <AttendanceNote shape={shape} state={attendance} onTap={onTell} />}
                    {shape === 'rest' && <RestDayLine onTap={onAttendance} />}
                </div>
            )}

            {cost && <RunningCostCard cost={cost} />}
        </div>
    );
};

export default WorkHome;
