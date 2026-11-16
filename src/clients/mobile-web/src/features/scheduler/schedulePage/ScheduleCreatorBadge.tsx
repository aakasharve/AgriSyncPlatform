/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - the round picture place in the schedule header.
 * Until a picture is specified (lane SCH-ID: a person's picture is personal data and needs its own rules) it shows the first letter of the
 * creator's name, or a leaf when there is no name. `imageUrl` is accepted so a later lane can pass a picture without redoing the layout, but
 * NOTHING passes it today, so no real photo is ever drawn here.
 */
import React from 'react';
import { Leaf } from 'lucide-react';

export interface ScheduleCreatorBadgeProps {
    imageUrl?: string | null;
    name?: string | null;
    /** Pixel size of the circle. */
    size?: number;
}

/** The first character of the name (first code point), or null when there is no name. */
export function creatorLetter(name: string | null | undefined): string | null {
    const first = Array.from((name ?? '').trim())[0];
    return first ? first.toLocaleUpperCase() : null;
}

export const ScheduleCreatorBadge: React.FC<ScheduleCreatorBadgeProps> = ({ imageUrl = null, name = null, size = 56 }) => {
    const letter = creatorLetter(name);
    return (
        <span data-testid="sched-badge" data-kind={imageUrl ? 'image' : letter ? 'letter' : 'leaf'} aria-hidden="true"
            style={{ width: size, height: size }}
            className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-500/25 text-[26px] font-black text-emerald-200 ring-2 ring-white/30">
            {imageUrl
                ? <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                : letter ?? <Leaf size={Math.round(size * 0.5)} aria-hidden="true" />}
        </span>
    );
};

export default ScheduleCreatorBadge;
