/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148 layout C) - the maker's badge of a schedule with the real
 * picture in it when the phone holds one, and the letter or leaf badge (`ScheduleCreatorBadge`, unchanged) when it does not.
 *
 * The shape follows the picture: a PERSON's photo is round; a schedule's own picture and an institution's logo are square. With no picture the shape is
 * what it always was (an institution's badge square, anything else round). The letter or leaf is always the fallback: no picture, a picture still on its
 * way, one refused by the server, or a file the screen cannot draw.
 */
import React from 'react';
import type { CropScheduleTemplate } from '../scheduler.types';
import { ScheduleCreatorBadge, ownerPictureShape, realCreatorName, type ScheduleCreatorBadgeProps } from '../schedulePage/ScheduleCreatorBadge';
import { useSchedulePictureUrl } from './useSchedulePictureUrl';

export type MakerBadgeTemplate = Pick<CropScheduleTemplate, 'createdBy' | 'ownerType' | 'pictureId' | 'pictureSha256' | 'pictureKind'>;

/** Round for a person's photo, square for a schedule's picture or a logo; with no picture, the shape the badge always had. */
export function pictureShapeFor(template: Pick<CropScheduleTemplate, 'ownerType' | 'pictureKind'>, hasPicture: boolean): 'round' | 'square' {
    if (hasPicture && template.pictureKind) return template.pictureKind === 'PERSON' ? 'round' : 'square';
    return ownerPictureShape(template.ownerType);
}

export const ScheduleMakerBadge: React.FC<{
    template: MakerBadgeTemplate;
    /** A picture given by the caller wins over the stored one (tests, previews). */
    imageUrl?: string | null;
} & Omit<ScheduleCreatorBadgeProps, 'imageUrl' | 'name' | 'shape'>> = ({ template, imageUrl = null, ...badge }) => {
    const stored = useSchedulePictureUrl(template);
    const shown = imageUrl ?? stored;
    return <ScheduleCreatorBadge {...badge} name={realCreatorName(template)} imageUrl={shown} shape={pictureShapeFor(template, shown !== null)} />;
};

export default ScheduleMakerBadge;
