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
 * No date is promised in either language: `saveToastMessages.ts:21-34` names
 * a promise no code path can keep as the same class of defect this whole
 * effort removes.
 *
 * The FIRST version of this copy said "anything you already noted down
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
 * COPY — FIX ROUND 2: IT IS NOW READABLE BY THE FARMER IT WAS WRITTEN FOR
 * -----------------------------------------------------------------------
 * The header above used to end "English placeholder only — the founder
 * authors the final Marathi", and both strings were hardcoded English
 * literals in the JSX below. Commit `d1c3837d` made Marathi the app default
 * (`i18n/LanguageContext.tsx`), which turned that placeholder into a defect
 * of exactly the kind this file exists to remove: the middle sentence — a
 * harvest sale recorded here would not be saved — is the only thing standing
 * between a Marathi-first smallholder and a lost sale record, and he could
 * not read it. An honest warning that does not land is not honest (`P5`).
 *
 * Both strings now resolve through `i18n/harvestAvailabilityTranslations.ts`,
 * the same shape `shared/components/ApprovalUnavailableNotice.tsx` uses for
 * the same problem. The ENGLISH IS UNCHANGED, character for character — it
 * moved file, it was not re-worded, so fix round 1's reviewed copy is intact
 * and this diff carries one change, not two. Every clause of the Marathi is
 * cited to an already-shipped source line in that module's header; the
 * load-bearing one (`शेतनोंदीत जाणार नाही`) is the app's own existing phrase
 * from `syncTranslations.ts:239`, pinned against it in the test.
 *
 * FONTS: set explicitly per string, chosen from the text itself, for the
 * reason `ApprovalUnavailableNotice` records — `OfflineEmptyState` declares
 * no `font-family` of its own, so its `h3`/`p` inherit whatever the cascade
 * hands them, and Devanagari must never be left to a generic fallback. That
 * is also why `OfflineEmptyState`'s `title`/`message` now accept a
 * `ReactNode`: the font has to be attached to the string, not to the box.
 *
 * `fontStyleFor` below is a second copy of `ApprovalUnavailableNotice`'s
 * three-line helper rather than a shared import. Deliberate, per the Rule of
 * Three: two call sites is where a premature abstraction costs more than the
 * duplication. The third one extracts it.
 *
 * @module features/logs/components/harvest/HarvestComingSoon
 */
import React from 'react';
import { Clock } from 'lucide-react';

import type { Language } from '../../../../i18n/language';
import { resolveHarvestAvailabilityString } from '../../../../i18n/harvestAvailabilityTranslations';
import OfflineEmptyState from '../../../../shared/components/ui/OfflineEmptyState';

const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

export interface HarvestComingSoonProps {
    /** Drives both strings via `resolveHarvestAvailabilityString`. */
    language: Language;
}

const HarvestComingSoon: React.FC<HarvestComingSoonProps> = ({ language }) => {
    const title = resolveHarvestAvailabilityString(language, 'harvestUnavailableTitle');
    const message = resolveHarvestAvailabilityString(language, 'harvestUnavailableBody');

    return (
        <div data-testid="harvest-coming-soon">
            <OfflineEmptyState
                icon={<Clock size={40} className="text-slate-300" />}
                title={<span style={fontStyleFor(title)}>{title}</span>}
                message={<span style={fontStyleFor(message)}>{message}</span>}
            />
        </div>
    );
};

export default HarvestComingSoon;
