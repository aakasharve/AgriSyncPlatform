/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1; verifier I14-V3-06) — "आतापर्यंतची यादी"
 * (was "This Phase Checklist"): the checklist of EVERY stage that has begun — what the data always held — so
 * an older open item the plot card counts can be found here.
 *
 * On an old plot that is 200+ items ("ठिबकने पाणी · ठरलेला दिवस N · अजून नोंद नाही" again and again), the
 * long wall PLR-D9 T7 called overwhelming. So, the way the plot card already groups its open work, each kind
 * of work is ONE row with its count ("ठिबकने पाणी — झालं 30 · बाकी 12"); nothing is dropped: tapping the
 * row unfolds every item of that kind with its planned day and what was recorded, exactly as before.
 * Rows with open work come first (the items arrive most-delayed-open first, `buildCompareReport`).
 * Every Marathi string here is PROPOSED (Marathi) and reused from the old checklist.
 */
import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import { GlassCard, Tap } from '../../shared/components/ui/placeUi';
import {
    CATEGORY_META,
    CATEGORY_ORDER,
    getCategoryIcon,
    type CompareCategory,
    type MustDoItem,
} from './comparePageHelpers';

export interface ChecklistGroup {
    name: string;
    items: MustDoItem[];
    done: number;
    open: number;
}

/** One category's items, one group per kind of work, in the order the items arrive. */
export function groupChecklist(items: readonly MustDoItem[]): ChecklistGroup[] {
    const byName = new Map<string, MustDoItem[]>();
    for (const item of items) {
        const list = byName.get(item.name);
        if (list) list.push(item);
        else byName.set(item.name, [item]);
    }
    return [...byName].map(([name, list]) => {
        const done = list.filter(item => item.isDone).length;
        return { name, items: list, done, open: list.length - done };
    });
}

const ItemRow: React.FC<{ item: MustDoItem }> = ({ item }) => (
    <div className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${item.isDone ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`}>
        {item.isDone
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />}
        <p className="m-0 min-w-0 flex-1 text-[12.5px] font-semibold text-stone-600">{item.plannedText} · {item.actualText}</p>
    </div>
);

const Category: React.FC<{ category: CompareCategory; items: MustDoItem[]; plotId: string }> = ({ category, items, plotId }) => {
    const groups = useMemo(() => groupChecklist(items), [items]);
    const [openNames, setOpenNames] = useState<ReadonlySet<string>>(() => new Set());
    const toggle = (name: string) => setOpenNames(prev => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name); else next.add(name);
        return next;
    });
    const done = items.filter(item => item.isDone).length;
    return (
        <div className="overflow-hidden rounded-2xl border border-stone-200" data-testid={`compare-checklist-${plotId}-${category}`}>
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-2">
                <p className="m-0 flex items-center gap-2 text-[14px] font-extrabold text-stone-900">{getCategoryIcon(category, 15, 'text-stone-700')}{CATEGORY_META[category].label}</p>
                <p className="m-0 text-[12.5px] font-bold text-stone-700">झालं {done} · बाकी {items.length - done}</p>
            </div>
            <div className="space-y-1.5 p-2">
                {groups.map((group, i) => {
                    const isOpen = openNames.has(group.name);
                    const testId = `compare-checklist-group-${plotId}-${category}-${i}`;
                    return (
                        <div key={group.name} data-testid={testId}>
                            <Tap onClick={() => toggle(group.name)} aria-expanded={isOpen} data-testid={`${testId}-toggle`}
                                className={`flex min-h-[48px] w-full items-center gap-2.5 rounded-xl border p-2.5 text-left ${group.open > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
                                {group.open > 0
                                    ? <Circle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                                    : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />}
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[14px] font-extrabold text-stone-900">{group.name}</span>
                                    <span className="block text-[12.5px] font-bold text-stone-700" data-testid={`${testId}-count`}>झालं {group.done} · बाकी {group.open}</span>
                                </span>
                                {isOpen
                                    ? <ChevronUp size={18} className="shrink-0 text-stone-600" aria-hidden="true" />
                                    : <ChevronDown size={18} className="shrink-0 text-stone-600" aria-hidden="true" />}
                            </Tap>
                            {isOpen && (
                                <div className="mt-1.5 space-y-1.5 pl-3" data-testid={`${testId}-items`}>
                                    {group.items.map(item => <ItemRow key={item.id} item={item} />)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const CompareChecklist: React.FC<{ items: readonly MustDoItem[]; plotId: string }> = ({ items, plotId }) => (
    <GlassCard testId={`compare-checklist-${plotId}`}>
        <div className="mb-2">
            {/* PROPOSED (Marathi) — every stage that has begun, not this one alone (`buildCompareReport` →
                `stagesForAnalysis`), so the card's "त्याआधीची N कामं … पूर्ण तपशीलात पाहा" points at a list
                that really shows them. */}
            <h3 className="m-0 text-[16px] font-extrabold text-stone-900">आतापर्यंतची यादी</h3>
            <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">सुरू झालेल्या सगळ्या टप्प्यांची कामं · हिरवी खूण = झालं · रिकामं वर्तुळ = अजून नोंद नाही</p>
        </div>
        <div className="space-y-3">
            {CATEGORY_ORDER.map(category => {
                const list = items.filter(item => item.category === category);
                return list.length === 0 ? null : <Category key={category} category={category} items={list} plotId={plotId} />;
            })}
        </div>
    </GlassCard>
);
