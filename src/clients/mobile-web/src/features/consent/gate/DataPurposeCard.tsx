// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// One data-purpose row: what we take, and what for, on a single line.
//
// It used to be an expandable card whose detail only appeared on tap. That is gone, and
// deliberately: a disclosure that needs an interaction to appear is a disclosure the
// farmer can miss, which is exactly what DPDP's "informed" test exists to catch. The
// compression pass (founder direction 2026-08-17) made the detail short enough that
// hiding it bought nothing — so everything the row has to say is now always on screen,
// and there is one fewer control between him and the acceptance at the bottom.
//
// `data` and `purpose` arrive as two fields and render as one line. They stay separate
// in the notice document because the Rules ask for an itemised description of the
// personal data next to the purpose of its use, and the hash has to see both.
//
// Nothing here gates the CTA. Nothing on this screen does except the 18+ declaration.

import React from 'react';
import type { PurposeCard } from './consentNotice';

interface Props {
    card: PurposeCard;
    /** Language-correct heading face: Marathi headings are serif, English is DM Sans. */
    headingFont: string;
    /** Lucide glyph for the emerald tile — the same tile idiom as the permissions screen. */
    icon: React.ReactNode;
}

const DataPurposeCard: React.FC<Props> = ({ card, headingFont, icon }) => (
    <li className="flex items-start gap-2.5" data-testid={`consent-purpose-card-${card.id}`}>
        <span
            aria-hidden="true"
            className="mt-px flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[9px] bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15"
        >
            {icon}
        </span>
        <p className="min-w-0 flex-1">
            <span className={`${headingFont} block text-[11.5px] font-bold leading-snug text-stone-800`}>
                {card.title}
            </span>
            <span className="mt-0.5 block font-sans text-[10.5px] leading-snug text-stone-600">
                {card.data} — {card.purpose}
            </span>
        </p>
    </li>
);

export default DataPurposeCard;
