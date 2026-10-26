/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-27) — the band shown while ONE part of a
 * log is said again (`recordingSegment`: from the हजेरी result's "speak more", or the quick-log sheet).
 * Same colours and icon as before (`getSegmentVisual`); the English "Recording <part>" /
 * "Speak count & duration..." and the "Cancel & Go Back" button are now plain Marathi (PROPOSED).
 */
import React from 'react';
import type { LogSegment } from '../../../../domain/types/log.types';
import { getSegmentVisual } from '../../../../shared/utils/uiUtils';
import { SANS } from '../../../../shared/components/ui/placeUi';
import { SEGMENT_WORDS } from './entryWords';

export const SegmentBanner: React.FC<{ segment: LogSegment }> = ({ segment }) => {
    const visual = getSegmentVisual(segment);
    return (
        <div data-testid="segment-banner" style={{ fontFamily: SANS }}
            className={`mb-4 flex items-center gap-3 rounded-3xl border-2 p-4 shadow-sm ${visual.color}`}>
            <div className="rounded-full bg-white/50 p-2 motion-safe:animate-pulse">{visual.icon}</div>
            <div className="min-w-0">
                <p className="m-0 text-[18px] font-extrabold leading-snug">{SEGMENT_WORDS.title(segment)}</p>
                <p className="m-0 mt-0.5 text-[16px] font-semibold opacity-90">{SEGMENT_WORDS.hint(segment)}</p>
            </div>
        </div>
    );
};

export const SegmentCancel: React.FC<{ onCancel: () => void }> = ({ onCancel }) => (
    <div className="mt-6 text-center">
        <button type="button" onClick={onCancel} data-testid="segment-cancel" style={{ fontFamily: SANS }}
            className="min-h-[56px] rounded-full bg-stone-100 px-6 text-[16px] font-bold text-stone-700 active:bg-stone-200">
            {SEGMENT_WORDS.cancel}
        </button>
    </div>
);
