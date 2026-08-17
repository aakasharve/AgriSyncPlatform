// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// One data-purpose entry, printed the way a clause in a legal document is printed: a
// bold term, then its text underneath. No tile, no icon, no border, no background.
//
// It used to be an expandable card whose detail only appeared on tap. That is gone, and
// deliberately: a disclosure that needs an interaction to appear is a disclosure the
// farmer can miss, which is exactly what DPDP's "informed" test exists to catch. The
// emerald icon tile went the same way on 2026-08-17 — the founder asked for a plain
// document, and a decorative glyph next to a legal clause carries no disclosure. The
// row's own words are the whole of it, and nothing here is hashed via the icon.
//
// `data` and `purpose` arrive as two fields and render as one line. They stay separate
// in the notice document because the Rules ask for an itemised description of the
// personal data next to the purpose of its use, and the hash has to see both.
//
// Nothing here gates the CTA. Nothing on this screen does except the 18+ declaration.
//
// The list marker is suppressed (`list-none`) rather than the <ul>/<li> being dropped:
// the semantics of "these are five separate purposes" belong in the markup for a screen
// reader even when the printed page shows them as plain stacked paragraphs.

import React from 'react';
import type { PurposeCard } from './consentNotice';

interface Props {
    card: PurposeCard;
    /** Language-correct heading face: Marathi headings are serif, English is DM Sans. */
    headingFont: string;
}

const DataPurposeCard: React.FC<Props> = ({ card, headingFont }) => (
    <li data-testid={`consent-purpose-card-${card.id}`}>
        <p className={`${headingFont} text-[10px] font-bold leading-snug text-stone-800`}>
            {card.title}
        </p>
        <p className="font-sans text-[9.5px] leading-relaxed text-stone-600">
            {card.data} — {card.purpose}
        </p>
    </li>
);

export default DataPurposeCard;
