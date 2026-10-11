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
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';
import type { HeadcountDisagreement } from '../attendanceDisagreement';

const HeadcountDisagreementCard: React.FC<{
    disagreement: HeadcountDisagreement;
    markedCount?: number;
}> = ({ disagreement, markedCount }) => (
    <div data-testid="headcount-disagreement"
        className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-800">
        {/* Rendered from the ruled gate's own preserved fields, never
            re-derived: spoken.count is null when only names were spoken
            (B001's 0-with-names), and printing a fabricated number here
            would be the exact silent overwrite this card exists to prevent. */}
        <span className="font-extrabold">
            {COPY.youSaidChip}: {disagreement.spoken.count != null
                ? <>{disagreement.spoken.count} जण.</>
                : markedCount != null
                    ? <>{markedCount} जण.</>
                    : <>{disagreement.uniqueNames.join(', ')}.</>}
        </span>
        {disagreement.anchored != null && (
            <> आजच्या कामात {disagreement.anchored.headcount} जण होते, असं आधी समजलं होतं.</>
        )}
        {' '}दोन्ही गोष्टी तशाच राहतील.
    </div>
);

export default HeadcountDisagreementCard;
