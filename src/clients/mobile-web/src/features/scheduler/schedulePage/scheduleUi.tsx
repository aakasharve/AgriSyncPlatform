/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15) — the small pieces every list on the शेड्यूल page
 * shares, in the look of the PLR-D8 preview (`schedule/scheduleUi.tsx`): one icon per part (the ring's own
 * icon set, so a part looks the same everywhere), the status chip, one expected task, tasks grouped by part.
 * Presentational only. The preview's schedule-source chips and the expert card are not here: one schedule
 * per plot today (S4/S13) and no expert suggestion exists (S14).
 */
import React from 'react';
import { Check, X } from 'lucide-react';
import { CategoryIcon } from '../../logs/components/shramsathi/understandingRing/CategoryIcon';
import type { IconName } from '../../logs/components/shramsathi/understandingRing/icons';
import { SC } from './scheduleCopy';
import { PART_LABEL, PARTS, type CellStatus, type ExpectedItem, type Part } from './scheduleModel';

export const PART_TINT: Readonly<Record<Part, string>> = { irrigation: '#cffafe', nutrition: '#ede9fe', spray: '#fee2e2', work: '#dcfce7' };
const PART_ICON: Readonly<Record<Part, IconName>> = { irrigation: 'water', nutrition: 'inputs', spray: 'inputs', work: 'work' };

export const PartIcon: React.FC<{ part: Part; size?: number }> = ({ part, size = 32 }) => (
    <span className="grid shrink-0 place-items-center rounded-lg" style={{ width: size, height: size, background: PART_TINT[part] }}>
        <CategoryIcon name={PART_ICON[part]} size={Math.round(size * 0.6)} />
    </span>
);

/** झालं / राहिलं / अपेक्षित / जास्तीचं — the word is always written; colour only repeats it. */
export const StatusChip: React.FC<{ status: CellStatus }> = ({ status }) => {
    if (status === 'done') return <span data-status="done" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[13px] font-extrabold text-white"><Check size={15} strokeWidth={4} aria-hidden="true" />{SC.doneWord}</span>;
    if (status === 'missed') return <span data-status="missed" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[13px] font-extrabold text-white"><X size={15} strokeWidth={4} aria-hidden="true" />{SC.missedWord}</span>;
    if (status === 'extra') return <span data-status="extra" className="inline-flex shrink-0 items-center rounded-full bg-sky-600 px-2.5 py-1 text-[13px] font-extrabold text-white">{SC.extraWord}</span>;
    return <span data-status="expected" className="shrink-0 rounded-full border-2 border-stone-300 px-2.5 py-0.5 text-[13px] font-extrabold text-stone-600">{SC.expectedWord}</span>;
};

export const ItemLine: React.FC<{ item: ExpectedItem; status: CellStatus }> = ({ item, status }) => (
    <li className="flex list-none items-start justify-between gap-2 rounded-2xl border border-white/60 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur-sm" data-testid={`item-${item.key}`}>
        <span className="min-w-0 flex-1 text-[18px] font-extrabold leading-snug text-stone-900">
            {item.title}
            {/* The old page's "Milestone" tag: a one-time task, not a routine. */}
            {item.once && <span className="ml-2 inline-block rounded-full bg-rose-50 px-2 py-0.5 align-middle text-[12.5px] font-extrabold text-rose-700 ring-1 ring-rose-200" data-testid="once-tag">{SC.once}</span>}
            {/* The schedule's own name for this task (the old "Today's Scheduled Tasks" showed it under each task). */}
            {item.detail && <span className="block text-[15px] font-bold leading-snug text-stone-700" data-testid="item-detail">{item.detail}</span>}
        </span>
        <StatusChip status={status} />
    </li>
);

/** A day's expected tasks grouped under the four parts; each task carries its part's status that day. */
export const PartGroup: React.FC<{ items: readonly ExpectedItem[]; statusOf: (part: Part) => CellStatus; testId: string }> = ({ items, statusOf, testId }) => (
    <div className="space-y-3" data-testid={testId}>
        {PARTS.filter(p => items.some(i => i.part === p)).map(p => (
            <div key={p} data-testid={`${testId}-${p}`}>
                <p className="m-0 mb-1.5 flex items-center gap-2 text-[16px] font-extrabold text-stone-800"><PartIcon part={p} />{PART_LABEL[p]}</p>
                <ul className="m-0 space-y-1.5 p-0">{items.filter(i => i.part === p).map(i => <ItemLine key={i.key} item={i} status={statusOf(p)} />)}</ul>
            </div>
        ))}
    </div>
);

export const GLASS = 'border border-white/60 bg-white/70 shadow-[0_8px_30px_rgba(28,25,23,0.08)] backdrop-blur-md';
