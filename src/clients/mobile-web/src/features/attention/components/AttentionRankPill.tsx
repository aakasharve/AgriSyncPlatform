/**
 * spec: plr-d10 (I14, H14) — the card's rank in Marathi (was English "Critical / Needs Attention / Watch").
 * गंभीर / लक्ष द्या / नजर ठेवा are the words the app's own चेतावण्या page already uses for the same bands
 * (`ComplianceSignalsPage.tsx`); "ठीक" is PROPOSED (Marathi).
 *
 * The rank arrives as the server's ORDINAL NUMBER (`attentionWire.ts`); the name is accepted too. A rank we
 * cannot read draws NO pill — it is never shown as a band it may not be (it used to fall back to "Watch").
 */
import React from 'react';
import { attentionRankOf, type AttentionRankName } from '../attentionWire';

interface AttentionRankPillProps {
    /** As stored: the server's ordinal (0-3) or the rank's name. */
    rank: unknown;
}

const rankConfig: Record<AttentionRankName, { bg: string; text: string; dot: string; label: string }> = {
    Critical: { bg: 'bg-rose-100', text: 'text-rose-800', dot: 'bg-rose-500', label: 'गंभीर' },
    NeedsAttention: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500', label: 'लक्ष द्या' },
    Watch: { bg: 'bg-stone-100', text: 'text-stone-700', dot: 'bg-stone-400', label: 'नजर ठेवा' },
    // PROPOSED (Marathi)
    Healthy: { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500', label: 'ठीक' },
};

const AttentionRankPill: React.FC<AttentionRankPillProps> = ({ rank }) => {
    const name = attentionRankOf(rank);
    if (!name) return null;
    const config = rankConfig[name];
    return (
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-extrabold ${config.bg} ${config.text}`} data-testid="attention-rank" data-rank={name}>
            <span className={`h-2 w-2 rounded-full ${config.dot}`} aria-hidden="true" />
            {config.label}
        </span>
    );
};

export default AttentionRankPill;
