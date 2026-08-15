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
 * COPY — FIX ROUND 1 CORRECTION
 * ------------------------------
 * English placeholder only — the founder authors the final Marathi (Global
 * Constraint). No date is promised: `saveToastMessages.ts:21-34` names a
 * promise no code path can keep as the same class of defect this whole
 * effort removes.
 *
 * The FIRST version of this copy also said "anything you already noted down
 * here is still on your phone; it has not been deleted." Independent review
 * (fix round 1) caught that this is FALSE for the one thing the task exists
 * to fix. Tracing what actually persisted, by field:
 *   - harvest config (pattern/unit)         -> saved (saveHarvestConfig)
 *   - "Log New Harvest" empty session shell -> saved (startHarvestSession)
 *   - patti number / OCR-extracted data     -> memory only, never written
 *   - grade-wise sale: quantities, grades,
 *     prices, income, payment status        -> NEVER WRITTEN, ever
 * There is no code path that ever saved a sale, so there was no evidence for
 * a claim that a farmer's past sale is "still there" — a farmer who read that
 * line and had genuinely lost three sales in June would conclude in August
 * that his records were fine, and could throw away the patti slips that were
 * his only remaining proof. Restating "no date" discipline while smuggling in
 * a different unevidenced promise is the same defect in different clothes.
 *
 * The message now claims only what THIS CHANGE can prove: it reads, writes
 * and deletes nothing (true and evidenced), and it makes no claim about what
 * any past entry currently contains. Ruling (fix round 1): do NOT build a
 * read-only history view to make a stronger claim true — a history view is
 * product scope for the founder to decide, not a containment task's call.
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
            message="This part of the app isn't built yet — a harvest sale recorded here would not be saved to your farm records. Nothing on your phone has been deleted."
        />
    </div>
);

export default HarvestComingSoon;
