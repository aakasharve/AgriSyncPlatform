/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - repair R3, lane S1 (V3-D, approved by the founder on 27 Nov 2026).
 *
 * FarmHereCard - under the three big buttons, the open farm in its own colour (`farmColour.ts`): a 6 px strip on the left on a
 * light tint, the small label "तुम्ही इथे" in the farm's colour, then "‹भूमिका› · ‹प्लॉट›". With two or more farms a pill
 * "‹N› शेती ▾" in the farm's colour opens the existing farm switcher sheet; with one farm there is no pill (nothing to switch to).
 * It replaces the full-width role band ("तुम्ही: ‹नाव› · मालक · सर्व प्लॉट") and the nameboard's small word.
 *
 * FarmSwitchNote - after a switch, "आता: ‹शेत›" in the NEW farm's colour, for about 1.8 s (the header owns the timer). It is drawn
 * on `document.body`: the header is sticky and blurred (`backdrop-filter`), which makes it the box a fixed child is placed in, so
 * a note drawn inside it would sit inside the header instead of above the bottom bar.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { FarmColour } from './farmColour';
import { relationshipCopy, toRelationshipLanguage } from '../../relationships/relationshipCopy';

/** How long the "आता: ‹शेत›" note stays (the design's 1.8 s). */
export const FARM_SWITCH_NOTE_MS = 1800;

/** The project font rule: Marathi body text in Noto Sans Devanagari, English in DM Sans. */
const fontFor = (language: string | null | undefined): React.CSSProperties => (
    toRelationshipLanguage(language) === 'en'
        ? { fontFamily: "'DM Sans', sans-serif" }
        : { fontFamily: "'Noto Sans Devanagari', sans-serif" }
);

export interface FarmHereCardProps {
    /** "मालक · सर्व प्लॉट" (`hereLineFor`), or the role word alone before /me/context answers. */
    line: string;
    colour: FarmColour;
    /** The person's farms: the pill shows only with 2 or more. */
    farmCount: number;
    language: string | null | undefined;
    onOpenSwitcher: () => void;
    disabled?: boolean;
}

export const FarmHereCard: React.FC<FarmHereCardProps> = ({ line, colour, farmCount, language, onOpenSwitcher, disabled = false }) => {
    const copy = relationshipCopy(language);
    const font = fontFor(language);
    return (
        <div className="mx-auto w-full max-w-[480px] px-3 pb-3 md:max-w-[600px] xl:max-w-[640px]">
            <div
                data-testid="farm-here-card"
                data-farm-colour={colour.name}
                className="relative flex items-center gap-2.5 overflow-hidden rounded-[14px] py-[7px] pr-[7px] transition-colors duration-200 motion-reduce:transition-none"
                style={{ background: colour.tint, boxShadow: 'inset 0 0 0 1px rgba(28,25,23,.08)' }}
            >
                <span aria-hidden="true" data-testid="farm-here-bar" className="w-1.5 shrink-0 self-stretch" style={{ background: colour.ink }} />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span data-testid="farm-here-label" className="text-[11.5px] font-extrabold leading-[1.35]" style={{ color: colour.ink, ...font }}>
                        {copy.here.label}
                    </span>
                    <span data-testid="farm-here-line" className="text-[14.5px] font-extrabold leading-[1.3] text-stone-900 [overflow-wrap:anywhere]" style={font}>
                        {line}
                    </span>
                </span>
                {farmCount > 1 && (
                    <button
                        type="button"
                        data-testid="farm-here-switch"
                        onClick={onOpenSwitcher}
                        disabled={disabled}
                        aria-haspopup="dialog"
                        // The pill is drawn as small as the design; `before:` widens what a thumb can hit to about 44 px.
                        className="relative inline-flex shrink-0 items-center gap-0.5 rounded-full py-[5px] pl-3 pr-2.5 text-[13px] font-extrabold leading-[18px] before:absolute before:-inset-2 before:content-['']"
                        style={{ background: colour.ink, color: '#FFFFFF', boxShadow: '0 4px 10px -5px rgba(0,0,0,.4)', ...font }}
                    >
                        {copy.here.farmCount(farmCount)}
                        <ChevronDown size={12} strokeWidth={3} aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
};

export interface FarmSwitchNoteProps {
    /** The farm just opened. */
    farmName: string;
    /** That farm's colour. */
    colour: FarmColour;
    language: string | null | undefined;
}

export const FarmSwitchNote: React.FC<FarmSwitchNoteProps> = ({ farmName, colour, language }) => {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
            role="status"
            aria-live="polite"
            data-testid="farm-switch-note"
            className="pointer-events-none fixed left-1/2 z-[90] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-full px-3.5 py-2 text-center text-[14px] font-bold shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
            style={{
                bottom: 'calc(84px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
                background: colour.ink,
                color: '#FFFFFF',
                ...fontFor(language),
            }}
        >
            {relationshipCopy(language).here.now(farmName)}
        </div>,
        document.body,
    );
};
