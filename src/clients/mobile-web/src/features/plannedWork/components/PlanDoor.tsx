/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; founder D-24, D-26, P5) - the plan door on the work home.
 *   kind 'plan'  (the primary owner, or a holder of PlanWork or AssignWork): "कामांची जबाबदारी सोपवा / कामांचे नियोजन करा" with
 *                "N कामे चालू" - the tasks and reminders this phone may show him that are not cancelled and not done.
 *   kind 'mine'  (everyone else): "तुमच्यावर सोपवलेली कामे" with his own count - the work handed to him, not cancelled, not done.
 * Who gets which kind is decided by the caller from the server's authorities (`holdsAuthority`), never from a label.
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
        <Tap onClick={onOpen} data-testid="home-plan" data-kind={kind} rippleColor="rgba(20,72,230,0.18)"
            style={{ fontFamily: language === 'en' ? fontFor(language) : SANS }}
            className="flex min-h-[96px] w-full items-center gap-4 rounded-[28px] border-2 border-[#1448E6]/40 bg-white p-4 text-left shadow-sm">
            <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-[#1448E6]/10 text-[#1448E6]"><ClipboardList size={32} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[20px] font-extrabold leading-tight text-stone-900" data-testid="home-plan-title">{kind === 'plan' ? words.plan : words.mine}</span>
                <span className="mt-0.5 block text-[14px] font-semibold leading-snug text-stone-700">{kind === 'plan' ? words.planSub : words.mineSub}</span>
                {loaded && <span className="mt-1 inline-block rounded-full bg-[#1448E6]/10 px-2.5 py-0.5 text-[13px] font-extrabold text-[#1448E6]" data-testid="home-plan-count" data-count={count}>{words.openCount(count)}</span>}
            </span>
            <ChevronRight size={26} className="shrink-0 text-[#1448E6]" aria-hidden="true" />
        </Tap>
    );
};

export default PlanDoor;
