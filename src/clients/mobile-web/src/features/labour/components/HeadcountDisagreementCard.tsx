/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeadcountDisagreementCard - the ONE rendering of "what you said and what was
 * already understood disagree; both stay". Extracted from AttendanceResult
 * (the voice flow) so the manual door (journey fix D2) shows the very same
 * card in the very same words instead of a second copy: BOTH statements are
 * preserved (rule 1), nothing is overwritten, no total changes.
 *
 * `markedCount` is for the manual door, where the farmer stated people by
 * marking them rather than by speaking a count: it is printed in place of the
 * people list, so no machine id can ever reach the screen.
 */
import React from 'react';
import { attendanceCardCopy } from '../attendanceCopy';
import type { HeadcountDisagreement } from '../attendanceDisagreement';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

const HeadcountDisagreementCard: React.FC<{
    disagreement: HeadcountDisagreement;
    markedCount?: number;
}> = ({ disagreement, markedCount }) => {
    // Repair FIX-1 round 1 (Bug 5): one language at a time; the Marathi is exactly the words it always had.
    const COPY = attendanceCardCopy(useOptionalLanguage()?.language);
    return (
        <div data-testid="headcount-disagreement"
            className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-800">
            {/* Rendered from the ruled gate's own preserved fields, never
                re-derived: spoken.count is null when only names were spoken
                (B001's 0-with-names), and printing a fabricated number here
                would be the exact silent overwrite this card exists to prevent. */}
            <span className="font-extrabold">
                {disagreement.spoken.count == null && markedCount != null ? COPY.markedChip : COPY.youSaidChip}: {disagreement.spoken.count != null
                    ? <>{disagreement.spoken.count} {COPY.people}.</>
                    : markedCount != null
                        ? <>{markedCount} {COPY.people}.</>
                        : <>{disagreement.uniqueNames.join(', ')}.</>}
            </span>
            {disagreement.anchored != null && (
                <> {COPY.understoodBefore(disagreement.anchored.headcount)}</>
            )}
            {' '}{COPY.bothStay}
        </div>
    );
};

export default HeadcountDisagreementCard;
