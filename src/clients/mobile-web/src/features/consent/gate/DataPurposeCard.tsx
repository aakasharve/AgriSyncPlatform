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

import React from 'react';
import type { PurposeCard } from './consentNotice';

interface Props {
    card: PurposeCard;
    expanded: boolean;
    onToggle: () => void;
    /** Language-correct heading face: Marathi headings are serif, English is DM Sans. */
    headingFont: string;
    expandLabel: string;
    collapseLabel: string;
}

const DataPurposeCard: React.FC<Props> = ({
    card, expanded, onToggle, headingFont, expandLabel, collapseLabel,
}) => {
    const bodyId = `consent-card-body-${card.id}`;

    return (
        <div
            className="rounded-2xl border border-stone-200 bg-white shadow-soft"
            data-testid={`consent-purpose-card-${card.id}`}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={bodyId}
                aria-label={expanded ? collapseLabel : expandLabel}
                // 20px padding, 48px minimum target.
                className="flex w-full min-h-[48px] items-start justify-between gap-4 p-5 text-left"
            >
                <span className="flex flex-col gap-1">
                    <span className={`${headingFont} text-lg font-bold text-stone-900`}>
                        {card.title}
                    </span>
                    <span className="text-base leading-relaxed text-stone-600">
                        {card.summary}
                    </span>
                </span>
                <span
                    aria-hidden="true"
                    className={`mt-1 shrink-0 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                >
                    ▾
                </span>
            </button>

            {expanded && (
                <div id={bodyId} className="flex flex-col gap-4 border-t border-stone-100 px-5 pb-5 pt-4">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        {card.collects.map((line) => (
                            <li key={line} className="text-base leading-relaxed text-stone-800">
                                {line}
                            </li>
                        ))}
                    </ul>
                    <p className="text-base leading-relaxed text-stone-700">{card.why}</p>
                </div>
            )}
        </div>
    );
};

export default DataPurposeCard;
