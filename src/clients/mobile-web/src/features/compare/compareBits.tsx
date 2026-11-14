/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4) - the small pictures of the तुलना screen: counted dots, the green
 * tick, the grey number, a part's icon and a reason kind's icon. Two colours only: green and grey (R33); a mark is never colour alone.
 */
import React from 'react';
import { Check, CloudRain, Droplets, Hammer, Leaf, Plus, SprayCan, User } from 'lucide-react';
import type { PartKey } from './compareWords';
import type { LogReasonKind } from '../../application/usecases/sync/SetLogReasonCommand';

export const SANS_FONT = "'Noto Sans Devanagari', sans-serif";

const PART_ICON: Record<PartKey, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>> = {
    irrigation: Droplets, work: Hammer, nutrition: Leaf, spray: SprayCan,
};

export const PartIcon: React.FC<{ part: PartKey | 'own'; size?: number }> = ({ part, size = 20 }) => {
    const Icon = part === 'own' ? User : PART_ICON[part];
    return (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-stone-100 text-emerald-800" data-part-icon={part}>
            <Icon size={size} aria-hidden="true" />
        </span>
    );
};

export const KIND_ICON: Record<LogReasonKind, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>> = {
    Practice: User, Extra: Plus, Weather: CloudRain,
};

type DotTone = 'asked' | 'done' | 'said' | 'none';
const DOT_CLASS: Record<DotTone, string> = {
    asked: 'bg-stone-300', // the schedule asked (grey)
    done: 'bg-emerald-600', // came to the record (green)
    said: 'border-2 border-dashed border-stone-500 bg-white', // the record says it was not done (hatched grey)
    none: 'bg-stone-300', // no record yet (grey)
};

/** `count` counted dots of one tone. Decorative: the numbers beside them carry the meaning. */
export const Dots: React.FC<{ tone: DotTone; count: number; testId?: string }> = ({ tone, count, testId }) => (
    <span className="inline-flex flex-wrap items-center gap-[3px]" aria-hidden="true" data-testid={testId} data-dots={count}>
        {Array.from({ length: Math.max(0, count) }, (_, i) => <i key={i} className={`inline-block h-3 w-3 rounded-full ${DOT_CLASS[tone]}`} />)}
    </span>
);

export const TickMark: React.FC<{ size?: number; label: string }> = ({ size = 26, label }) => (
    <span className="grid shrink-0 place-items-center rounded-full bg-emerald-600 text-white" style={{ width: size, height: size }} role="img" aria-label={label}>
        <Check size={Math.round(size * 0.62)} strokeWidth={3.5} aria-hidden="true" />
    </span>
);

/** The grey number of works with no record yet (never red). */
export const GreyNumber: React.FC<{ text: string; label: string; said?: boolean }> = ({ text, label, said }) => (
    <span
        className={`grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-full px-1 text-[14px] font-extrabold text-stone-700 ${said ? 'border-2 border-dashed border-stone-500 bg-white' : 'bg-stone-200'}`}
        role="img" aria-label={label}>
        {text}
    </span>
);
