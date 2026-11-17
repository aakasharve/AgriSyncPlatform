/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; founder D-24, D-26, P5) - the plan door on the work home.
 *   kind 'plan'  (the primary owner, or a holder of PlanWork or AssignWork): "नियोजन करा" (lane UI-6, founder D-150: the old long title is
 *                gone) with a small "N कामे चालू" pill - the tasks and reminders this phone may show him that are not cancelled and not done.
 *   kind 'mine'  (everyone else): "तुमच्यावर सोपवलेली कामे" with his own count - the work handed to him, not cancelled, not done.
 * Who gets which kind is decided by the caller from the server's authorities (`holdsAuthority`), never from a label.
 *
 * Lane UI-6 (picture H1): the second of the two big doors on the Home - solid blue, a little smaller than the green record door above
 * it (title 24 px against its 26 px, 52 px icon circle, the count a small pill under the line). Both kinds are the same size.
 */
import React from 'react';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { SANS, Tap } from '../../../shared/components/ui/placeUi';
import { planDoorWords } from '../../logs/components/entry/entryWords';
import { usePlannedWork } from '../data/usePlannedWork';
import { isOpenTask, isReminderTask } from '../planCardModel';
import { fontFor } from './PlanCard';

export interface PlanDoorProps {
    kind: 'plan' | 'mine';
    farmId: string | null;
    userId: string | null;
    onOpen: () => void;
}

export const PlanDoor: React.FC<PlanDoorProps> = ({ kind, farmId, userId, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const words = planDoorWords(language);
    const { items, loaded } = usePlannedWork(farmId);
    const open = items.filter(isOpenTask);
    const count = kind === 'plan'
        ? open.length
        : open.filter(t => userId !== null && t.assigneeUserId === userId && !isReminderTask(t, userId)).length;
    return (
        <Tap onClick={onOpen} data-testid="home-plan" data-kind={kind} rippleColor="rgba(255,255,255,0.35)"
            style={{ fontFamily: language === 'en' ? fontFor(language) : SANS }}
            className="flex min-h-[96px] w-full items-center gap-3 rounded-[20px] bg-[#1448E6] px-4 py-4 text-left text-white shadow-[0_6px_16px_rgba(20,72,230,0.28)]">
            <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-white/20 text-white"><ClipboardList size={28} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[24px] font-extrabold leading-[1.15] text-white" data-testid="home-plan-title">{kind === 'plan' ? words.plan : words.mine}</span>
                <span className="mt-0.5 block text-[12.5px] font-semibold leading-snug text-white/90" data-testid="home-plan-sub">{kind === 'plan' ? words.planSub : words.mineSub}</span>
                {loaded && <span className="mt-1.5 inline-block rounded-full bg-white px-2.5 py-0.5 text-[12px] font-extrabold text-[#1448E6]" data-testid="home-plan-count" data-count={count}>{words.openCount(count)}</span>}
            </span>
            <ChevronRight size={24} className="shrink-0 text-white" aria-hidden="true" />
        </Tap>
    );
};

export default PlanDoor;
