/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { LabourEvent } from '../../../../../types';
import { t as translateForced } from '../../../../../i18n/translations';
import { useLanguage } from '../../../../../i18n/LanguageContext';
import { toMarathiNumber } from '../../../services/disciplineRecognition';

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari. The
// "not certain I heard this" flag is Marathi copy shown inline with the
// farmer's own transcript quote, so it must set this explicitly.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

interface LabourReviewProps {
    labourEntries: LabourEvent[];
    totalWorkerCount: number;
}

const LabourReview: React.FC<LabourReviewProps> = ({ labourEntries, totalWorkerCount }) => {
    const { language, t } = useLanguage();
    if (labourEntries.length === 0) return null;

    // Task 21 (Labour V2 R1) — Devanagari digits, gated on language, exactly
    // the `DailySummaryCard.tsx` precedent. Do not hand-roll a converter.
    const formatCount = (value: number): string =>
        language === 'mr' ? toMarathiNumber(value) : String(value);

    // Task 27 (spec: 2026-08-28-labour-v2-release-1) — mirrors the server's
    // `LabourHeadcount.Resolve` (ShramSafal.Domain/Farms/LabourHeadcount.cs):
    // `undefined` ONLY when count/maleCount/femaleCount are ALL unstated —
    // "we were not told" (P4), never a fabricated 0. A genuinely stated 0
    // passes through unchanged; a stated count > 0 wins outright over the
    // gender split (the parser emits count=5 AND femaleCount=5 for "५ बायका" —
    // adding them would double-count). The old
    // `entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))`
    // could not distinguish "farmer said 0" / "farmer said nothing" from
    // each other, so an unstated headcount rendered as "० मजूर".
    const resolveCount = (entry: LabourEvent): number | undefined => {
        if (entry.count == null && entry.maleCount == null && entry.femaleCount == null) {
            return undefined;
        }
        return typeof entry.count === 'number' && entry.count > 0
            ? entry.count
            : (entry.maleCount || 0) + (entry.femaleCount || 0);
    };

    // The codebase's one mark for "we were not told" (P4/R6) — the same
    // literal `ReviewSheet.tsx`'s `ReviewFacts` already renders for an
    // unknown fact. Reused verbatim, not invented a second time.
    const UNKNOWN = '—';

    return (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    {/* Task 21 — the "Total workers: N (breakdown)" line below
                        has NO founder-approved Marathi equivalent anywhere in the
                        codebase (searched i18n/oversightTranslations.ts,
                        i18n/translations.ts, LabourUiKit.tsx, LabourHub.tsx,
                        WeeklyDashboard.tsx). Still left in English rather than
                        inventing copy — `workers` / `मजूर` is exactly the
                        ambiguous human noun the founder's 2026-09-03 rule says to
                        FLAG, not to replace. The eyebrow above it is no longer
                        part of that PENDING list: it said "Labour Review", which
                        the same rule bans outright, and it had an already-shipped
                        replacement to move to. */}
                    {/* FOUNDER VOCABULARY RULE (2026-09-03) — was the English
                        eyebrow "Labour Review". Replaced with the ALREADY-SHIPPED,
                        founder-approved `workSummary.workBreakdown`
                        ('कामाचा तपशील' / 'Work Breakdown'), reused as-is exactly
                        like `workSummary.labour` below — nothing invented, and it
                        is work-centred rather than a class of person. The
                        "Total workers: N" line beneath is LEFT AS IS: `workers` /
                        `मजूर` is the ambiguous human noun the rule says to flag,
                        not to replace. */}
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">{t('workSummary.workBreakdown')}</p>
                    <p className="mt-1 text-sm font-semibold text-stone-700">
                        Total workers: {totalWorkerCount} ({labourEntries.map(entry => {
                            const c = resolveCount(entry);
                            return c != null ? formatCount(c) : UNKNOWN;
                        }).join(' + ')})
                    </p>
                </div>
            </div>

            <div className="mt-3 space-y-2">
                {labourEntries.map((entry, index) => {
                    const count = resolveCount(entry);
                    return (
                    <div key={`${entry.id}-${index}`} className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* `workSummary.labour` is already-shipped, founder-approved
                                copy — reused as-is from QuickLogSheet.tsx/ReviewInboxSheet.tsx
                                (mr: 'कामगार', en: 'Labour'), never invented here. */}
                            <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                                {entry.activity || t('workSummary.labour')}
                            </span>
                            {/* "{N} मजूर" is LabourHub.tsx's own already-shipped convention
                                for a worker-count line (see `toMr(labour.headcount)} मजूर`) —
                                reused as-is, not invented. */}
                            <span className="text-sm font-bold text-stone-800">
                                {language === 'mr'
                                    ? `${count != null ? formatCount(count) : UNKNOWN} मजूर`
                                    : `${count != null ? count : UNKNOWN} workers`}
                            </span>
                        </div>

                        {/* FOUNDER RULING 2026-08-31 — "names marked here means
                            attendance + identity recorded". A count alone is a
                            headcount; the names are what make it हजेरी. Each is
                            rendered EXACTLY as spoken — never normalised,
                            title-cased or reordered, because the farmer has to
                            recognise his own words to confirm them.

                            Absent when nobody was named, which is a complete
                            record and not a gap (P9): "चार लोक आले" states four
                            people and no identities, and an empty row here would
                            invite one to be invented. Names are NEVER a
                            headcount either — two names beside `count: 8` means
                            eight worked, two of whom were named. */}
                        {(entry.workerNames?.length ?? 0) > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="labour-review-worker-names">
                                {entry.workerNames!.map((workerName, nameIndex) => (
                                    <span
                                        key={`${workerName}-${nameIndex}`}
                                        className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[13px] font-bold text-stone-800"
                                        style={{ fontFamily: MARATHI_BODY }}
                                    >
                                        {workerName}
                                    </span>
                                ))}
                            </div>
                        )}
                        {entry.provenanceVerified === false && (entry.sourceText || entry.systemInterpretation) && (
                            <div
                                data-testid="provenance-unverified-flag"
                                className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5"
                            >
                                <HelpCircle size={13} className="mt-0.5 flex-shrink-0 text-amber-500" />
                                <span
                                    className="text-[11px] font-semibold leading-snug text-amber-700"
                                    style={{ fontFamily: MARATHI_BODY }}
                                >
                                    {translateForced('voice.unverifiedSourceLabel', 'mr')}
                                </span>
                            </div>
                        )}
                        {entry.sourceText && (
                            <p className="mt-2 text-xs italic text-stone-500">"{entry.sourceText}"</p>
                        )}
                        {entry.systemInterpretation && (
                            <p className="mt-1 text-[11px] font-medium text-stone-600">{entry.systemInterpretation}</p>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LabourReview;
