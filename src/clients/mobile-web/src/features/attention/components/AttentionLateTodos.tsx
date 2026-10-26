/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H15 / T3)
 *
 * Founder, 2026-10-25 (PLR-D9 §7b): "reminders are the to-do list, and when their time passes they go to
 * Attention as well." So the to-dos whose day has passed — the SAME "वेळ उलटली" group `todoModel.ts` builds
 * for करायची कामे on पूर्ण शेतीचा आढावा — also show here. It is the same item in the same store (the
 * planned-task store of `useAppData`), not a copy: a tick here or there clears it on both pages.
 *
 * Limit: the store is this phone's own; other phones of the farm do not see it (PLR-D6 Step D / PENDING D-10).
 * Words are the approved preview's (`app/PlacePages.tsx`).
 */
import React from 'react';
import { AlarmClock } from 'lucide-react';
import { GlassCard, Tap } from '../../../shared/components/ui/placeUi';
import { TodoRow } from '../../reflect/overview/TodoSection';
import type { TodoItem } from '../../reflect/overview/todoModel';

interface Props {
    items: readonly TodoItem[];
    onToggle: (item: TodoItem) => void;
    /** "सगळी करायची कामं पाहा" → करायची कामे on पूर्ण शेतीचा आढावा. */
    onOpenTodos?: () => void;
}

export const AttentionLateTodos: React.FC<Props> = ({ items, onToggle, onOpenTodos }) => (
    <GlassCard className="border-l-4 border-l-rose-500" testId="attention-overdue">
        <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-rose-800">
            <AlarmClock size={20} aria-hidden="true" />वेळ उलटून गेलेली कामं ({items.length})
        </p>
        <p className="m-0 mt-0.5 text-[13px] font-semibold text-stone-600">झालं असेल तर गोल दाबा — करायच्या कामांतूनही निघून जाईल.</p>
        <div className="mt-2.5 space-y-2">
            {items.map(t => <TodoRow key={t.id} t={t} onToggle={() => onToggle(t)} />)}
        </div>
        {onOpenTodos && (
            <Tap onClick={onOpenTodos} data-testid="attention-open-todos"
                className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                सगळी करायची कामं पाहा
            </Tap>
        )}
    </GlassCard>
);
