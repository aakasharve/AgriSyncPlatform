/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — the आढावा strip: लक्ष द्या's preview.
 * "Shows the most urgent issue and the total count: '२ कामे उशिराची · १ आठवण आज'. Tapping opens लक्ष द्या."
 *
 * It reads the SAME list as the page and the bottom-bar count (`useAttentionModel`), so a reminder marked झाले
 * anywhere leaves all three at once. Drawn only when that list has something: an empty strip would be one more
 * thing to read, and an "all fine" line here could not be proven (D-1). It sits above the folded sections, so
 * the urgent items stay in sight whatever is folded (founder D-4). Every Marathi string is PROPOSED.
 */
import React from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';
import type { CropProfile, PlannedTask } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { attentionSummaryMr, mostUrgentLineMr } from '../attentionItems';
import { useAttentionModel } from '../hooks/useAttentionModel';

export const AttentionStrip: React.FC<{
    tasks?: readonly PlannedTask[];
    crops?: readonly CropProfile[];
    onOpen?: () => void;
}> = ({ tasks, crops, onOpen }) => {
    const model = useAttentionModel(tasks, crops);
    if (!onOpen || model.total === 0) return null;
    const urgent = model.counts.lateSteps + model.counts.lateReminders + (model.counts.firstAlerts ?? 0) > 0;
    const first = mostUrgentLineMr(model);
    return (
        <Tap onClick={onOpen} data-testid="attention-strip" aria-label={`लक्ष द्या: ${attentionSummaryMr(model.counts)}`}
            className={`flex min-h-[60px] w-full items-center gap-3 rounded-[22px] px-3.5 py-2.5 text-left ring-1 ${urgent ? 'bg-rose-50 ring-rose-200' : 'bg-amber-50 ring-amber-200'}`}>
            <CircleAlert size={24} aria-hidden="true" className={`shrink-0 ${urgent ? 'text-rose-700' : 'text-amber-700'}`} />
            <span className="min-w-0 flex-1">
                {first && <span className="block truncate text-[15.5px] font-extrabold leading-snug text-stone-900" data-testid="attention-strip-first">{first}</span>}
                <span className="block text-[13px] font-bold leading-snug text-stone-600" data-testid="attention-strip-summary">{attentionSummaryMr(model.counts)}</span>
            </span>
            <span className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-full px-2 text-[14px] font-extrabold text-white ${urgent ? 'bg-rose-600' : 'bg-amber-600'}`}
                style={{ fontFamily: "'DM Sans', sans-serif" }} data-testid="attention-strip-total">{model.total}</span>
            <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-stone-400" />
        </Tap>
    );
};
