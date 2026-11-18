/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - the picture place of a schedule's maker.
 * Until a picture is specified (lane SCH-ID: a person's picture is personal data and needs its own rules) it shows the first letter of the
 * creator's name, or a leaf when there is no name. `imageUrl` is accepted so a later lane can pass a picture without redoing the layout, but
 * NOTHING passes it today, so no real photo is ever drawn here.
 *
 * Lane UI-8 (founder D-148 layout C, D-150): the same badge now also sits on a WHITE card (`tone="light"`) and is SQUARE for an institution's
 * logo (`shape="square"`; a person's picture stays round). A picture, when one comes, fills the same place in either shape.
 *
 * Lane SCH-ID-P (D-146, D-148): the real picture now arrives (`features/scheduler/pictures/ScheduleMakerBadge`). A picture the screen cannot draw (a
 * file that fails to decode) drops back to the letter or leaf, never a broken-image mark.
 */
import React, { useState } from 'react';
import { Leaf } from 'lucide-react';
import type { CropScheduleTemplate } from '../scheduler.types';

export interface ScheduleCreatorBadgeProps {
    imageUrl?: string | null;
    name?: string | null;
    /** Pixel size of the badge. */
    size?: number;
    /** Round for a person, square for an institution's logo. */
    shape?: 'round' | 'square';
    /** `dark` = on the old dark card (kept), `light` = on a white card. */
    tone?: 'dark' | 'light';
    testId?: string;
    /**
     * Size as Tailwind classes instead of `size` (the owner bar is 92 px, and 72 px under 360 px width): the width, height and letter size.
     * When given, `size` only sizes the leaf.
     */
    sizeClass?: string;
}

/** The catalog's own author tags: not a person's or a body's name, never shown as one. */
export const INTERNAL_AUTHORS: ReadonlySet<string> = new Set(['ShramSafal Reference Data', 'System Fallback']);

/** The creator's real name as the app holds it, or null (never an invented one). */
export function realCreatorName(template: Pick<CropScheduleTemplate, 'createdBy'>): string | null {
    const name = (template.createdBy ?? '').trim();
    return name && !INTERNAL_AUTHORS.has(name) ? name : null;
}

/** The shape of the maker's picture place: an institution's logo is square; a person's picture (and the leaf) is round. */
export const ownerPictureShape = (ownerType: CropScheduleTemplate['ownerType']): 'round' | 'square' => (ownerType === 'INSTITUTION' ? 'square' : 'round');

/** The first character of the name (first code point), or null when there is no name. */
export function creatorLetter(name: string | null | undefined): string | null {
    const first = Array.from((name ?? '').trim())[0];
    return first ? first.toLocaleUpperCase() : null;
}

export const ScheduleCreatorBadge: React.FC<ScheduleCreatorBadgeProps> = ({ imageUrl = null, name = null, size = 56, shape = 'round', tone = 'dark', testId = 'sched-badge', sizeClass }) => {
    const letter = creatorLetter(name);
    const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
    const picture = imageUrl && imageUrl !== brokenUrl ? imageUrl : null;
    const look = tone === 'light' ? 'bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200' : 'bg-emerald-500/25 text-emerald-200 ring-2 ring-white/30';
    return (
        <span data-testid={testId} data-kind={picture ? 'image' : letter ? 'letter' : 'leaf'} data-shape={shape} aria-hidden="true"
            style={sizeClass ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.46) }}
            className={`grid shrink-0 place-items-center overflow-hidden font-black ${sizeClass ?? ''} ${shape === 'square' ? 'rounded-xl' : 'rounded-full'} ${look}`}>
            {picture
                ? <img src={picture} alt="" className="h-full w-full object-cover" onError={() => setBrokenUrl(picture)} />
                : letter ?? <Leaf size={Math.round(size * 0.5)} aria-hidden="true" />}
        </span>
    );
};

export default ScheduleCreatorBadge;
