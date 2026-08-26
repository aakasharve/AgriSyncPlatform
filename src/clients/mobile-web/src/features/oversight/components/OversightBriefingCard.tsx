/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * OversightBriefingCard — Task 5, Band 2 of `WaitingDrawer` (design doc §3,
 * "Band 2 · Since you last looked"). Split out of `WaitingDrawer.tsx` to
 * keep both files well under the 800-line cap (task-5 brief, binding
 * constraint 7) and because Band 2 is a genuinely separate concern from
 * Band 1's decision rows.
 *
 * Presentational only — props in, markup out. No Dexie, no storage reads,
 * no `infrastructure/` imports.
 *
 * PIN COLOUR (spec §3: "coloured pin, from the app's existing
 * `getUserColor`"): imports the SAME hash + palette `AppHeader.tsx` already
 * uses for the profile avatar, exported from there for exactly this reuse.
 * Never a second colour function — Rokade is the same colour everywhere.
 *
 * NO FABRICATED NUMBERS (spec §P-F): every count below (`people.length`,
 * `totalRecords`, `totalPlots`, each person's `recordCount` /
 * `plotNames.length`) is read straight off the `OversightModel` this
 * component receives — never a literal written here. The people tally is
 * `model.people.length`, which by `oversightSelectors.ts`'s own contract
 * NEVER includes `model.unattributed` — the unattributed row is rendered
 * separately, after the named rows, with its own grey pin (spec §3), so it
 * can never silently inflate the "how many people" count.
 *
 * ONE-LINE PERSON DESCRIPTION: spec §3 asks for "a one-line description of
 * what they did". The approved validation mock
 * (`G:\VALIDATION\owner-oversight-options.html`) illustrates this with
 * category-specific sentences ("पाणी, फवारणी आणि मजूर कामे नोंदवली") —  but
 * that wording is the mock's own illustrative prose, not a string reused
 * verbatim from an already-shipped, load-bearing source (spec §6.1's bar),
 * and composing it generically would mean inventing Marathi for six work
 * categories with no approved source, which the Hard Rule (spec §6)
 * forbids outright. `activitiesLogged` (dfesTranslations-sourced, spec
 * §6.1, reused verbatim) already exists for exactly this role — "N
 * activities logged" — so it is what renders here instead.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';

import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { getUserColor } from '../../context/components/AppHeader';
import type { OversightModel, OversightPerson } from '../oversightSelectors';
import { formatOversightTemplate } from '../formatOversightTemplate';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

// Spec §3: "the अज्ञात row, with a grey pin" — reuses AppHeader's own
// "no identity" fallback triple (its `activeOperator` branch below line 72)
// rather than a new literal, so "no identity" always reads the same grey
// everywhere in the app.
const UNATTRIBUTED_PIN_CLASS = 'border-stone-300 text-stone-500 bg-stone-100';

export interface OversightBriefingCardProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /** Read-only — every number rendered here is derived from this model. */
    model: OversightModel;
    /** Opens the existing filtered detail view (spec §3: "Approving happens
     * there. The drawer never approves."). Omit to render non-navigating
     * rows. */
    onOpenPerson?: (person: OversightPerson) => void;
}

function PersonRow({
    language,
    person,
    isUnattributed,
    onOpen,
}: {
    language: Language;
    person: OversightPerson;
    isUnattributed: boolean;
    onOpen?: (person: OversightPerson) => void;
}): React.ReactElement {
    const plotsUnitText = resolveOversightString(language, 'plotsUnit');
    const activitiesLoggedText = resolveOversightString(language, 'activitiesLogged');
    const unknownText = resolveOversightString(language, 'unknown');

    const displayName = isUnattributed ? unknownText : person.name;
    const pinClass = isUnattributed ? UNATTRIBUTED_PIN_CLASS : getUserColor(person.name);
    const initial = isUnattributed ? '?' : (person.name.charAt(0).toUpperCase() || '?');
    const tallyText = `${person.recordCount} \u00B7 ${person.plotNames.length} ${plotsUnitText}`;
    const descriptionText = `${person.recordCount} ${activitiesLoggedText}`;
    const testId = isUnattributed
        ? 'waiting-drawer-unattributed-row'
        : `waiting-drawer-person-row-${person.operatorId ?? 'unknown'}`;

    return (
        <button
            type="button"
            data-testid={testId}
            onClick={() => onOpen?.(person)}
            className="flex w-full items-start gap-2.5 border-t border-stone-100 px-3.5 py-2.5 text-left first:border-t-0"
        >
            <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${pinClass}`}
                style={ENGLISH_FONT}
            >
                {initial}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                    <span
                        className="truncate text-[14.5px] font-bold text-stone-800"
                        style={fontStyleFor(displayName)}
                    >
                        {displayName}
                    </span>
                    <span
                        className="shrink-0 whitespace-nowrap text-[11.5px] font-semibold text-stone-400"
                        style={ENGLISH_FONT}
                    >
                        {tallyText}
                    </span>
                </span>
                <span
                    className="mt-0.5 block text-[12.5px] leading-snug text-stone-600"
                    style={fontStyleFor(descriptionText)}
                >
                    {descriptionText}
                </span>
            </span>
            <ChevronRight size={16} className="mt-1.5 shrink-0 text-stone-300" />
        </button>
    );
}

const OversightBriefingCard: React.FC<OversightBriefingCardProps> = ({ language, model, onOpenPerson }) => {
    const headlineText = resolveOversightString(language, 'welcomeBack');
    const subText = resolveOversightString(language, 'weeklyReviewPrompt');
    const talliesPeopleUnitText = resolveOversightString(language, 'talliesPeopleUnit');
    const entriesText = resolveOversightString(language, 'entries');
    const plotsUnitText = resolveOversightString(language, 'plotsUnit');

    // FOUNDER DECISION 2026-08-26 — THE TAIL IS BACK, AND IT NO LONGER
    // CLAIMS PRECISION.
    //
    // Commit `aacdd16c` deleted this line outright. The founder overruled
    // that: he wants the day count visible, softened, in his own words —
    // *"we can't be always true for this too"*.
    //
    // WHAT THE OLD LINE CLAIMED: a confident N — that everything arriving in
    // the last N days is listed below it.
    //
    // WHY THE DATA CANNOT BACK A CONFIDENT N: the "unseen" boundary is
    // measured from each record's CREATION time, not from when the record
    // reached this phone — `oversightSelectors.ts`'s `effectiveArrivalISO()`
    // is `meta.createdAtISO`, because `DailyLog` carries no server-received
    // timestamp at all. A sathi's record written offline on Tuesday and
    // synced on Friday is therefore classified already-seen and never shown.
    //
    // THE SELECTOR HAS ALWAYS SAID SO, AND NOTHING LISTENED. It sets
    // `boundaryApproximate: true` on every model it builds
    // (`oversightSelectors.ts:316`), for exactly this reason, and until this
    // change no component read the flag. This is its first consumer — the
    // flag drives the wording rather than a literal, so the day a real
    // server-received timestamp makes the boundary exact, `false` renders
    // the founder's tail unmodified with no edit here.
    //
    // HOW THE SOFTENING IS DONE: `approximately` ('अंदाजे' / 'about') is
    // substituted INTO `sinceLastLookedTail`'s own `{days}` token, so the
    // word lands immediately before the number and not one word of the
    // founder's approved sentence is rewritten. No second tail string is
    // invented — the spec's §6 Hard Rule forbids exactly that.
    //
    // `model.sinceDays === null` (no checkpoint yet) still renders NOTHING.
    // "0 days since you last looked" would be a fabricated number, and an
    // approximation word does not make a fabricated number honest (P4).
    const sinceTailText = model.sinceDays === null
        ? null
        : formatOversightTemplate(resolveOversightString(language, 'sinceLastLookedTail'), {
            days: model.boundaryApproximate
                ? `${resolveOversightString(language, 'approximately')} ${model.sinceDays}`
                : `${model.sinceDays}`,
        });

    return (
        <div
            data-testid="waiting-drawer-briefing-card"
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
        >
            <div className="border-b border-stone-100 px-3.5 py-3">
                <div
                    className="text-[14px] font-medium leading-relaxed text-stone-700"
                    style={fontStyleFor(headlineText)}
                >
                    {headlineText}
                </div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-stone-400" style={fontStyleFor(subText)}>
                    {subText}
                    {sinceTailText && <span data-testid="waiting-drawer-since-tail"> · {sinceTailText}</span>}
                </div>

                <div className="mt-3 flex" data-testid="waiting-drawer-tallies">
                    <div className="flex-1 border-r border-stone-200 text-center first:border-l-0" data-testid="waiting-drawer-tally-people">
                        <div className="text-[23px] font-bold leading-none tabular-nums text-stone-800" style={ENGLISH_FONT}>
                            {model.people.length}
                        </div>
                        <div className="mt-1 text-[9.5px] font-bold uppercase tracking-wide text-stone-400" style={fontStyleFor(talliesPeopleUnitText)}>
                            {talliesPeopleUnitText}
                        </div>
                    </div>
                    <div className="flex-1 border-r border-stone-200 text-center" data-testid="waiting-drawer-tally-records">
                        <div className="text-[23px] font-bold leading-none tabular-nums text-stone-800" style={ENGLISH_FONT}>
                            {model.totalRecords}
                        </div>
                        <div className="mt-1 text-[9.5px] font-bold uppercase tracking-wide text-stone-400" style={fontStyleFor(entriesText)}>
                            {entriesText}
                        </div>
                    </div>
                    <div className="flex-1 text-center" data-testid="waiting-drawer-tally-plots">
                        <div className="text-[23px] font-bold leading-none tabular-nums text-stone-800" style={ENGLISH_FONT}>
                            {model.totalPlots}
                        </div>
                        <div className="mt-1 text-[9.5px] font-bold uppercase tracking-wide text-stone-400" style={fontStyleFor(plotsUnitText)}>
                            {plotsUnitText}
                        </div>
                    </div>
                </div>
            </div>

            {model.people.map((person) => (
                <PersonRow
                    key={person.operatorId ?? person.name}
                    language={language}
                    person={person}
                    isUnattributed={false}
                    onOpen={onOpenPerson}
                />
            ))}
            {model.unattributed && (
                <PersonRow
                    language={language}
                    person={model.unattributed}
                    isUnattributed
                    onOpen={onOpenPerson}
                />
            )}
        </div>
    );
};

export default OversightBriefingCard;
