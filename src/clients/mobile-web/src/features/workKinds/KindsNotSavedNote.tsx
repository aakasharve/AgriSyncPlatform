/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.2; CTO ruling Q3 A) - the saved screen's one line for a recording
 * whose part he may not record was taken out before it was saved: "‹kind› नोंदवण्याची परवानगी नाही — मालकाला सांगा", then that the rest was saved
 * and his voice is kept with the record. Small and on its own: the result screen is redesigned soon (Part 03). Nothing when nothing was taken out.
 */
import React from 'react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import type { WorkKind } from '../../core/session/workKinds';
import { workKindWords } from './workKindWords';

export const KindsNotSavedNote: React.FC<{ kinds: readonly WorkKind[]; testId?: string }> = ({ kinds, testId = 'kinds-not-saved' }) => {
    const w = workKindWords(useOptionalLanguage()?.language);
    if (kinds.length === 0) return null;
    return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] font-bold leading-snug text-amber-950" data-testid={testId} role="status">
            <p className="m-0 font-extrabold" data-testid={`${testId}-line`}>{w.notAllowedLine(kinds)}</p>
            <p className="m-0 mt-0.5 text-[14px] font-semibold">{w.restSavedLine}</p>
        </div>
    );
};

export default KindsNotSavedNote;
