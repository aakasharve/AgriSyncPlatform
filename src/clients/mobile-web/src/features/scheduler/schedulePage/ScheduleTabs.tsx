/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S5) — the three big buttons झालं / आज / पुढे,
 * each with its count; only the chosen list is shown below; the page opens on आज (PLR-D8 §3a).
 *   झालं — parts done in this stage (one per day + part), and how many were left undone;
 *   आज   — today's expected tasks plus the work still owed from earlier days;
 *   पुढे — expected tasks in the next 8 days.
 */
import React from 'react';
import { SC } from './scheduleCopy';

export type ScheduleTab = 'done' | 'today' | 'ahead';

export interface TabCounts { done: number; missed: number; today: number; owed: number; ahead: number }

const TabBtn: React.FC<{ id: ScheduleTab; on: boolean; onClick: () => void; label: string; count: number; sub: string; tone: string }> = ({ id, on, onClick, label, count, sub, tone }) => (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} data-testid={`tab-${id}`}
        className={`flex min-h-[104px] flex-col items-center justify-center rounded-3xl border-2 px-1 py-2 text-center active:scale-[0.98] ${tone}`}>
        <span className="text-[17px] font-extrabold">{label}</span>
        <span className="text-[38px] font-black leading-none" data-testid={`count-${id}`}>{count}</span>
        <span className="mt-0.5 text-[14px] font-bold opacity-90">{sub}</span>
    </button>
);

export const ScheduleTabs: React.FC<{ tab: ScheduleTab; onTab: (t: ScheduleTab) => void; counts: TabCounts }> = ({ tab, onTab, counts }) => (
    <div className="grid grid-cols-3 gap-2.5" role="tablist" aria-label={SC.title} data-testid="sched-tabs">
        <TabBtn id="done" on={tab === 'done'} onClick={() => onTab('done')} label={`✓ ${SC.tabDone}`} count={counts.done} sub={SC.leftCount(counts.missed)}
            tone={tab === 'done' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-emerald-400 bg-white/80 text-emerald-900 backdrop-blur-sm'} />
        <TabBtn id="today" on={tab === 'today'} onClick={() => onTab('today')} label={`● ${SC.tabToday}`} count={counts.today + counts.owed} sub={SC.owedCount(counts.owed)}
            tone={tab === 'today' ? 'border-[#1448E6] bg-[#1448E6] text-white' : 'border-[#1448E6]/60 bg-white/80 text-[#1448E6] backdrop-blur-sm'} />
        <TabBtn id="ahead" on={tab === 'ahead'} onClick={() => onTab('ahead')} label={`→ ${SC.tabAhead}`} count={counts.ahead} sub={SC.in8}
            tone={tab === 'ahead' ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-500 bg-white/80 text-stone-800 backdrop-blur-sm'} />
    </div>
);
