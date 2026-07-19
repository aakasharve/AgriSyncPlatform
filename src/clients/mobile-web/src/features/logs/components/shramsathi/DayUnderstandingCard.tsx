/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DayUnderstandingCard — the farmer-facing **Day Understanding Score X/१०** +
 * UnderstandingBar, extracted VERBATIM from MeterDisplay (2026-07-19 founder
 * request) so the score can lead the post-save success surface instead of
 * sitting below the clarity line, the fact line and the crop summary.
 *
 * The framing is the ASSISTANT's understanding of the farmer's day
 * ("मी तुमचा आजचा दिवस समजून घेतला — X/१०"), NOT a grade of the farmer. The
 * number is fetched server-side via useDayUnderstanding
 * (GET /shramsafal/day-understanding) for the active farm + day; the 3 internal
 * lenses that produce it NEVER reach the client and are NEVER rendered here.
 *
 * On a null score OR an offline/failed fetch we show NO number (a gentle
 * "अजून समजतंय…") — never a 0, never shame, and never a fall back to the client
 * scoreVlog /100 (which diverges from the server /10).
 *
 * THIS COMPONENT IS THE SINGLE OWNER of the useDayUnderstanding fetch. MeterDisplay
 * no longer calls it — do not re-add a second call anywhere.
 *
 * Still gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert
 * and network-silent in production.
 *
 * spec: ai-intelligence-plan-2026-06-25 · dfes-companion-2026-07-11
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { toMarathiNumber } from '../../services/disciplineRecognition';
import { useDayUnderstanding } from '../../hooks/useDayUnderstanding';
import { useLanguage } from '../../../../i18n/LanguageContext';
import UnderstandingBar from './UnderstandingBar';

// Marathi body text must render with Noto Sans Devanagari (incl. the Devanagari
// numerals ०-९) — never system-ui / generic fallbacks. See CHARTER §Font rules.
const SANS = "'Noto Sans Devanagari', sans-serif";

/** The Day Understanding Score is always out of 10 (rendered "X / १०"). */
const UNDERSTANDING_MAX = 10;

export interface DayUnderstandingCardProps {
    /** Active farm — drives the Day Understanding Score fetch. */
    farmId: string | null;
    /** Local date ('YYYY-MM-DD') the score is for; omitted → server defaults to today. */
    dayDate?: string;
    /**
     * BUGFIX_2026-07-19 (spec: dfes-companion-2026-07-11) — the just-saved
     * log's id. The server computes the Day Understanding Score as part of
     * saving the log, so a fetch fired at mount can race that save and land
     * on a stale/absent score with nothing to retrigger it. Passing the
     * saved log's id here forces useDayUnderstanding to refetch whenever a
     * NEW log is saved, even when farmId/dayDate are unchanged (same day).
     */
    savedLogId?: string | null;
}

export function DayUnderstandingCard({
    farmId,
    dayDate,
    savedLogId,
}: DayUnderstandingCardProps): React.ReactElement | null {
    const { t } = useLanguage();
    // Day Understanding Score (server /10). The hook self-gates on
    // understandingMeter, so with the flag OFF this issues ZERO network calls —
    // safe to call above the flag early-return below. savedLogId (BUGFIX_2026-07-19)
    // forces a refetch whenever a NEW log is saved, so the score/bar actually
    // appear instead of racing the save and never retrying.
    const { score: dayUnderstandingScore } = useDayUnderstanding(farmId ?? null, dayDate, savedLogId);

    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    return (
        // `mb-6 text-left` only re-supplies the layout context this block used to
        // inherit from MeterDisplay's `p-4 text-left` container — the success card
        // it now lives in is `text-center`. The block's OWN markup/copy/colours
        // are unchanged from the founder-approved version.
        <div data-testid="meter-score" className="mb-6 text-left" style={{ fontFamily: SANS }}>
            {dayUnderstandingScore != null ? (
                <div data-testid="day-understanding">
                    <p data-testid="day-understanding-intro" className="text-sm text-stone-600">
                        {t('dfes.dayUnderstandingIntro')}
                    </p>
                    <p data-testid="day-understanding-value" className="mt-1 text-3xl font-bold text-stone-800">
                        {`${toMarathiNumber(dayUnderstandingScore)} / ${toMarathiNumber(UNDERSTANDING_MAX)}`}
                    </p>
                    {/* Simple green→blue bar (colour borrowed from the waveform) under the number. */}
                    <div className="mt-3">
                        <UnderstandingBar score={dayUnderstandingScore} max={UNDERSTANDING_MAX} />
                    </div>
                </div>
            ) : (
                // score null OR fetch failed/offline → NO number, gentle pending.
                // Never a 0, never shame, never the client /100 fallback.
                <p data-testid="day-understanding-pending" className="text-sm text-stone-500">
                    {t('dfes.dayUnderstandingPending')}
                </p>
            )}
        </div>
    );
}

export default DayUnderstandingCard;
