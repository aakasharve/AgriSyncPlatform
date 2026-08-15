/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one honest "coming soon" surface for harvest (spec D4).
 *
 * WHY THIS EXISTS
 * ----------------
 * `GradeWiseEntrySheet`'s "Save Entry" only ever reached
 * `HarvestIncomePage.handleEntrySaved`, which called `setSessions(...)` —
 * React state — and never `updateHarvestSession` (`services/harvestService.ts`),
 * the function that actually persists a grade-wise sale, patti number, income
 * and payment status. That function has zero callers. A farmer who recorded a
 * harvest sale watched it appear on screen and lost it the moment he
 * navigated away — screen memory, not a record. The backend has no harvest
 * type to receive it either way (D4), so this is not a quick wiring fix like
 * the app's other launch-blockers; it is weeks of real construction.
 *
 * Every route that used to open the harvest sale/config flow
 * (`HarvestIncomePage`'s "Log New Harvest", the Pending Harvest Banner,
 * tapping a session, and `SettingsPage`'s "Harvest Configuration" editor)
 * renders this component now instead of a form that silently discards.
 *
 * WHAT THIS DOES NOT COVER
 * -------------------------
 * "Other Income" (scrap, subsidies, rent…) is a different, working feature —
 * `addOtherIncomeEntry` persists to storage and enqueues a real finance
 * mutation — and is unaffected. D4: "Nothing else hidden, because nothing
 * else needs to be."
 *
 * COPY
 * ----
 * English placeholder only — the founder authors the final Marathi (Global
 * Constraint). No date is promised: `saveToastMessages.ts` names a promise no
 * code path can keep as the same class of defect this whole effort removes.
 * The one factual claim made — that anything already recorded is kept — is
 * true unconditionally: nothing in this change reads, writes, or deletes
 * `HarvestLegacyStore` data, so whatever a farmer already saved before this
 * shipped is untouched, whether that is zero records or several.
 *
 * @module features/logs/components/harvest/HarvestComingSoon
 */
import React from 'react';
import { Clock } from 'lucide-react';
import OfflineEmptyState from '../../../../shared/components/ui/OfflineEmptyState';

const HarvestComingSoon: React.FC = () => (
    <div data-testid="harvest-coming-soon">
        <OfflineEmptyState
            icon={<Clock size={40} className="text-slate-300" />}
            title="Harvest tracking is coming soon"
            message="This part of the app isn't built yet — recording a harvest sale here would not be saved to your farm records. Anything you already noted down here is still on your phone; it has not been deleted."
        />
    </div>
);

export default HarvestComingSoon;
