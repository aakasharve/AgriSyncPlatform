// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// One expandable data-purpose card. Collapsed it still says what it takes and why, in
// one line — expanding adds detail, it never reveals a surprise. That is the whole
// reason the summary is mandatory: a card whose meaning only appears on expansion is a
// disclosure the farmer can miss, which is exactly the pattern DPDP's "informed" test
// exists to catch.
//
// Expanding is NOT a precondition for the CTA. Nothing on this screen requires reading
// or scrolling to unlock the button — the only gate is the 18+ declaration.
//
// Visual vocabulary is borrowed wholesale from OnboardingPermissionsPage — the screen
// this gate sits in the same flow as: emerald icon tile (h-11 w-11, rounded-[14px],
// bg-emerald-50, ring-1 ring-emerald-600/15), white/85 card on a stone-200/70 hairline,
// the emerald-tinted lift shadow, and a lucide chevron rather than a text glyph.

import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { PurposeCard } from './consentNotice';

interface Props {
    card: PurposeCard;
    expanded: boolean;
    onToggle: () => void;
    /** Language-correct heading face: Marathi headings are serif, English is DM Sans. */
    headingFont: string;
    expandLabel: string;
    collapseLabel: string;
    /** Lucide glyph for the emerald tile — same tile idiom as the permissions screen. */
    icon: React.ReactNode;
}

const DataPurposeCard: React.FC<Props> = ({
    card, expanded, onToggle, headingFont, expandLabel, collapseLabel, icon,
}) => {
    const bodyId = `consent-card-body-${card.id}`;

    return (
        <div
            className="overflow-hidden rounded-3xl border border-stone-200/70 bg-white/85 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
            data-testid={`consent-purpose-card-${card.id}`}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={bodyId}
                aria-label={expanded ? collapseLabel : expandLabel}
                // 20px padding, 48px minimum target.
                className="flex w-full min-h-[48px] items-start gap-3.5 p-5 text-left transition-colors active:bg-emerald-50/40"
            >
                <span
                    aria-hidden="true"
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15"
                >
                    {icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={`${headingFont} text-lg font-bold text-stone-800`}>
                        {card.title}
                    </span>
                    <span className="font-sans text-base leading-relaxed text-stone-600">
                        {card.summary}
                    </span>
                </span>
                <ChevronDown
                    size={20}
                    aria-hidden="true"
                    className={`mt-2.5 shrink-0 text-stone-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            {expanded && (
                <div id={bodyId} className="flex flex-col gap-4 border-t border-stone-100 px-5 pb-5 pt-4">
                    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-emerald-500">
                        {card.collects.map((line) => (
                            <li key={line} className="font-sans text-base leading-relaxed text-stone-800">
                                {line}
                            </li>
                        ))}
                    </ul>
                    <p className="font-sans text-base leading-relaxed text-stone-700">{card.why}</p>
                </div>
            )}
        </div>
    );
};

export default DataPurposeCard;
