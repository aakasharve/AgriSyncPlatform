/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, H16) — every लक्ष द्या card button leads to where
 * the thing can be done; a button with nowhere to go is not drawn (P5).
 *
 * The server's `SuggestedActionKind` (`GetAttentionBoard/SuggestedActionKind.cs`) arrives as its ORDINAL
 * NUMBER, not its name (`attentionWire.ts` reads both):
 *   AssignTest          → चाचण्या (the test queue, filtered to this plot — the one wiring that existed)
 *   OpenStageCompare    → तुलना (the home tab; hidden for a person who may not open it, e.g. a worker)
 *   ReviewOverdueTasks  → शेड्यूल (the schedule, where the planned work and what is still owed live)
 *   OpenPlot            → पूर्ण शेतीचा आढावा, narrowed to THIS plot (`plotId`: its "प्लॉटनिहाय काम", to-dos
 *                         and notes are that plot's), so "तुकडा पहा" (see the plot) shows the plot.
 *   RetryFailedSync     → run the sync again, here (the board's own retry)
 *   ResolveDispute      → NO button: the app has no place that resolves a disputed log today (the review
 *                         inbox lost its approve/dispute controls because the server cannot back them —
 *                         `ReviewInboxSheet.tsx`). The card still shows what is wrong.
 *   anything else       → no button.
 *
 * A card raised by a compliance signal (`GetAttentionBoardHandler.cs`) carries the server label "अनुपालन सिग्नल
 * पहा" (see the compliance signal) WHATEVER action the signal maps to. Its page, चेतावण्या (`compliance`), is
 * still English ("Signals • N open", "Open / Seen / Done / All", "Resolve", doubled मराठी + English band
 * names), so it is NOT a destination from this Marathi page (I14 verifier MAJOR I14-V2F-01). Such a card goes
 * by its mapped action like any other, and its button says THAT place in the server's own words for that
 * action (`ACTION_LABEL_MR`) — never "see the signal" on a button that opens the tests or the schedule.
 */
import type { AppRoute, PageView } from '../../types';
import type { AttentionCardCacheRecord } from '../../infrastructure/storage/DexieDatabase';
import { suggestedActionOf, type SuggestedActionName } from './attentionWire';

export type AttentionTarget =
    | { kind: 'tests' }
    /** `plotId`: open the tab narrowed to this plot (the overview only). */
    | { kind: 'view'; view: PageView; plotId?: string }
    | { kind: 'route'; route: AppRoute }
    | { kind: 'sync' };

/** The server's label for a compliance-signal card (`GetAttentionBoardHandler.cs`, both languages). */
const COMPLIANCE_LABEL_EN = 'View compliance signal';
const COMPLIANCE_LABEL_MR = 'अनुपालन सिग्नल पहा';

/**
 * The server's OWN Marathi button label for each action (`GetAttentionBoardHandler.cs` `BuildCard`), used on a
 * compliance-signal card so its button names where it goes. No new Marathi.
 */
const ACTION_LABEL_MR: Partial<Record<SuggestedActionName, string>> = {
    OpenPlot: 'तुकडा पहा',
    OpenStageCompare: 'टप्पा तुलना पहा',
    AssignTest: 'चाचण्या नियुक्त करा',
    ReviewOverdueTasks: 'थकलेली कामे पहा',
};

type CardAction = Pick<AttentionCardCacheRecord, 'suggestedAction'> &
    Partial<Pick<AttentionCardCacheRecord, 'suggestedActionLabelEn' | 'suggestedActionLabelMr' | 'plotId'>>;

export function isComplianceSignalCard(card: CardAction): boolean {
    return card.suggestedActionLabelEn?.trim() === COMPLIANCE_LABEL_EN || card.suggestedActionLabelMr?.trim() === COMPLIANCE_LABEL_MR;
}

export function attentionTargetFor(card: CardAction, hiddenViews: readonly PageView[] = []): AttentionTarget | null {
    switch (suggestedActionOf(card.suggestedAction)) {
        case 'AssignTest':
            return { kind: 'tests' };
        case 'OpenStageCompare':
            return hiddenViews.includes('compare') ? null : { kind: 'view', view: 'compare' };
        case 'ReviewOverdueTasks':
            return { kind: 'route', route: 'schedule' };
        case 'OpenPlot':
            if (hiddenViews.includes('reflect')) return null;
            return card.plotId ? { kind: 'view', view: 'reflect', plotId: card.plotId } : { kind: 'view', view: 'reflect' };
        case 'RetryFailedSync':
            return { kind: 'sync' };
        default:
            return null;
    }
}

/**
 * The words on the card's button: the server's Marathi label — except on a compliance-signal card, whose
 * server label ("see the signal") does not say where the button goes; there, the server's own label for the
 * action the button really takes. `null` → no words to put on a button, so none is drawn.
 */
export function attentionButtonLabelMr(card: CardAction): string | null {
    if (isComplianceSignalCard(card)) {
        const action = suggestedActionOf(card.suggestedAction);
        return (action && ACTION_LABEL_MR[action]) ?? null;
    }
    return card.suggestedActionLabelMr?.trim() || null;
}
