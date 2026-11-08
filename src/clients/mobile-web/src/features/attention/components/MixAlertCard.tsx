/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1; founders D-92, D-96; preview DFES-simple-day-preview) - one
 * "आधी हे पाहा" card: a wrong mix in one tank. The server's own words for what is wrong, then two big buttons:
 *   - "काय करायचं" opens what to do now and next time, and the source (only when the reviewed rule for this card is known -
 *     otherwise nothing is invented and the button is not drawn, P4);
 *   - "पाहिलं" (only for a seat that holds the confirm-records authority - the server refuses everyone else) queues the
 *     acknowledgement of the alert and the card leaves the list (`acknowledgeMixAlert`). It changes nothing
 *     in the saved record: "नोंद सांगितली तशीच राहील" (P7). Never blocks anything else (P9).
 * Marathi only, like the page it sits on. Nothing red is shown in production until the founder's agronomist reviews the rules.
 */
import React, { useState } from 'react';
import { Check, OctagonAlert } from 'lucide-react';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { GlassCard, IconDot, Tap } from '../../../shared/components/ui/placeUi';
import { inputWords } from '../../../domain/inputs/inputWords';
import type { MixRule } from '../../../domain/inputs/mixVerdict';
import { acknowledgeMixAlert } from '../data/acknowledgeMixAlert';
import { mixAdviceOf } from '../mixAdvice';
import { toMarathiDigits } from '../../labour/marathiDate';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import { AUTHORITY, holdsAuthority } from '../../../core/session/farmAuthorities';

// The preview's own words (DFES-simple-day-preview): the badge, the heading and the close word.
const BADGE_MR = 'चुकीचं मिश्रण';
const NOW_DO_MR = 'आता काय करायचं';
const CLOSE_MR = 'बंद करा';
// PROPOSED (Marathi) - said when the tap could not be queued; the card stays.
const SEEN_FAILED_MR = 'पाहिलं नोंदवता आलं नाही. पुन्हा दाबा.';

interface MixAlertCardProps {
    card: AttentionCardCacheRecord;
    /** The reviewed rules in force; defaults to the shippable rules (none today). A test hands in its own reviewed rule. */
    rules?: readonly MixRule[];
}

const MixAlertCard: React.FC<MixAlertCardProps> = ({ card, rules }) => {
    const words = inputWords('mr');
    const [open, setOpen] = useState(false);
    const [failed, setFailed] = useState(false);
    const advice = mixAdviceOf(card.descriptionMr, rules);
    const place = [card.plotName, card.farmName].filter(Boolean).join(' · ');
    // The server refuses an acknowledge from anyone without the confirm-records authority on the farm, so only that seat is offered the
    // button (read from the server's list, never the label; with no farm context nobody is offered it on a guess). The card and its
    // words stay for everyone who is shown it.
    const mayAcknowledge = holdsAuthority(useOptionalFarmContext()?.currentFarm, AUTHORITY.confirmRecords);
    const canSee = mayAcknowledge && Boolean(card.topSignalId);
    const why = advice?.why ?? card.descriptionMr;

    const seen = async () => {
        setFailed(false);
        try {
            await acknowledgeMixAlert(card.topSignalId);
        } catch {
            setFailed(true);
        }
    };

    return (
        <GlassCard className="border-l-4 border-l-rose-500 ring-1 ring-rose-100" testId={`attention-card-${card.cardId}`}>
            <div className="flex items-start gap-3">
                <IconDot tone="rose"><OctagonAlert size={22} aria-hidden="true" /></IconDot>
                <div className="min-w-0 flex-1">
                    <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[12px] font-extrabold text-white" data-testid="attention-first-badge">{BADGE_MR}</span>
                    <p className="m-0 mt-1.5 text-[16px] font-extrabold leading-snug text-stone-900">{card.titleMr}</p>
                    {why && <p className="m-0 mt-0.5 text-[13.5px] font-semibold leading-snug text-stone-600" data-testid={`attention-first-why-${card.cardId}`}>{why}</p>}
                    {place && <p className="m-0 mt-1 text-[12.5px] font-bold text-stone-500">{place}</p>}
                </div>
            </div>

            {open && advice && (
                <div className="mt-2.5 rounded-2xl bg-rose-50 p-2.5 text-[14px] font-bold leading-snug text-stone-800" data-testid={`attention-first-advice-${card.cardId}`}>
                    <div className="text-[13px] font-extrabold text-rose-900">{NOW_DO_MR}</div>
                    <div className="mt-1" data-testid="attention-first-now">{toMarathiDigits(1)}. {advice.nowDo}</div>
                    <div data-testid="attention-first-next">{toMarathiDigits(2)}. {advice.nextTime}</div>
                    <div className="mt-1 text-[11.5px] font-semibold text-stone-500" data-testid="attention-first-source">
                        {[advice.sourceTitle ? `स्रोत: ${advice.sourceTitle}` : '', words.recordUnchanged].filter(Boolean).join(' · ')}
                    </div>
                </div>
            )}

            <div className="mt-2.5 flex gap-2">
                {advice && (
                    <Tap onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`attention-first-what-${card.cardId}`}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-emerald-700 px-3 text-[14.5px] font-extrabold text-white">
                        {open ? CLOSE_MR : words.whatToDo}
                    </Tap>
                )}
                {canSee && (
                    <Tap onClick={() => { void seen(); }} data-testid={`attention-first-seen-${card.cardId}`}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-emerald-600 bg-white px-3 text-[14.5px] font-extrabold text-emerald-800">
                        <Check size={16} aria-hidden="true" />{words.seen}
                    </Tap>
                )}
            </div>
            {failed && <p className="m-0 mt-1.5 text-[12.5px] font-bold text-rose-700" role="status" data-testid="attention-first-seen-failed">{SEEN_FAILED_MR}</p>}
        </GlassCard>
    );
};

export default MixAlertCard;
