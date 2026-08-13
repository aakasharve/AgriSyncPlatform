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
import { useSelector } from '@xstate/react';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { toMarathiNumber } from '../../services/disciplineRecognition';
import { useDayUnderstanding } from '../../hooks/useDayUnderstanding';
import { useLanguage } from '../../../../i18n/LanguageContext';
import { getRootStore } from '../../../../app/state/RootStore';
import UnderstandingBar from './UnderstandingBar';

// Marathi body text must render with Noto Sans Devanagari (incl. the Devanagari
// numerals ०-९) — never system-ui / generic fallbacks. See CHARTER §Font rules.
const SANS = "'Noto Sans Devanagari', sans-serif";

/** The Day Understanding Score is always out of 10 (rendered "X / १०"). */
const UNDERSTANDING_MAX = 10;

/**
 * The mark the farmer chases (founder, 2026-08-13: "the chase must not be 8 but
 * near to 10"). Set to 9 — near the top of the scale, but not 10.
 *
 * Not 10 deliberately: a target identical to the maximum makes every ordinary good
 * day a near-miss, and a mark you can only ever tie is a ceiling rather than
 * something to chase. 9 keeps the pull high while leaving 10 as the rare, real
 * "सगळं समजलं" day — which is also exactly where the top band already starts, so
 * hitting the mark and Sathi saying it understood everything are the same moment.
 *
 * DELIBERATELY a UI constant, NOT a DfesTuning value: this is a target on the
 * farmer-facing scale, and that scale is still uncalibrated (nobody has graded a
 * real farm day against it). Promoting it to DfesTuning would imply the engine
 * agrees, and it cannot until calibration happens. NOTE the score's monotonicity
 * defect (DayUnderstandingScore.From is a mean over APPLICABLE lenses, so telling
 * Sathi more can LOWER it) — a 9 target is only honestly chaseable once that is
 * fixed, because today the last stretch is the part most likely to move backwards.
 */
const UNDERSTANDING_TARGET = 9;

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

    // BUGFIX_2026-08-12 — savedLogId alone was NOT enough, and the score never
    // appeared at all. This app is offline-first: "Saved to Ledger" fires on the
    // LOCAL Dexie write, but the log only reaches the server on the next
    // BackgroundSyncWorker tick (observed: ~15 s). So the savedLogId-keyed fetch
    // fires while the server still has no such log, gets {"score":null}, renders
    // "अजून समजतंय…" — and then NOTHING re-runs it, because farmId/dayDate/
    // savedLogId are all unchanged by the sync that follows. Verified end-to-end:
    // the server had {"score":7} while the card sat on the pending state forever.
    //
    // The fix reuses the sync machine's EXISTING completion signal rather than
    // polling: BackgroundSyncWorker sends SYNC_DONE, syncMachine stamps
    // lastSyncAtMs (syncMachine.ts:71). Folding that into the refresh key means
    // exactly one extra fetch per completed sync — no loop, no new channel, and
    // no second sync path (which P1 / Global Constraint 3 forbid).
    const lastSyncAtMs = useSelector(
        getRootStore().sync,
        (state) => state.context.lastSyncAtMs,
    );
    const refreshKey = `${savedLogId ?? ''}:${lastSyncAtMs ?? ''}`;

    // Day Understanding Score (server /10). The hook self-gates on
    // understandingMeter, so with the flag OFF this issues ZERO network calls —
    // safe to call above the flag early-return below.
    const { score: dayUnderstandingScore } = useDayUnderstanding(farmId ?? null, dayDate, refreshKey);

    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    return (
        // `mb-6 text-left` only re-supplies the layout context this block used to
        // inherit from MeterDisplay's `p-4 text-left` container — the success card
        // it now lives in is `text-center`. The block's OWN markup/copy/colours
        // are unchanged from the founder-approved version.
        <div data-testid="meter-score" className="text-left" style={{ fontFamily: SANS }}>
            {dayUnderstandingScore != null ? (
                <div data-testid="day-understanding">
                    {/* REDESIGN 2026-08-13 — the number now leads and is immediately
                        explained. Before, "७ / १०" sat under a line of body copy with
                        nothing saying what it measured, so it read like a grade of the
                        farmer. The denominator is set small and grey against a large
                        numerator so the eye lands on the score, and the sentence under
                        the bar answers "what does this number mean" in one breath. */}
                    {/* SEMI-LITERATE REDESIGN 2026-08-13 (founder). A large bare
                        "७ / १०" is read as a SCHOOL MARK by a tier-3/4 farmer — the
                        instinct is "I lost three marks" — which inverts the whole
                        point of a companion reporting its OWN comprehension. Prose
                        framing underneath does not undo that: a fraction outranks a
                        sentence, and this reader may not read the sentence at all.

                        So the WORD leads and the fraction is demoted to a quiet
                        secondary that still keeps the number honest and auditable.
                        Bands are read, not computed: "बरंच समजलं" needs no numeracy. */}
                    <p
                        data-testid="day-understanding-band"
                        className="font-bold text-stone-900"
                        style={{ fontSize: 21, lineHeight: 1.2, margin: 0 }}
                    >
                        {t(
                            dayUnderstandingScore >= 9 ? 'dfes.graspBandFull'
                                : dayUnderstandingScore >= 7 ? 'dfes.graspBandGood'
                                    : dayUnderstandingScore >= 4 ? 'dfes.graspBandSome'
                                        : 'dfes.graspBandLow',
                        )}
                    </p>
                    <span
                        data-testid="day-understanding-value"
                        className="text-stone-400"
                        style={{ fontSize: 13, fontWeight: 700 }}
                    >
                        {`${toMarathiNumber(dayUnderstandingScore)} / ${toMarathiNumber(UNDERSTANDING_MAX)}`}
                    </span>
                    <div className="mt-3">
                        <UnderstandingBar
                            score={dayUnderstandingScore}
                            max={UNDERSTANDING_MAX}
                            target={UNDERSTANDING_TARGET}
                        />
                    </div>
                    {/* The chase, stated once. Either "reach ८" with the notch ahead
                        of him, or "you got there" when he has. Never a deficit
                        ("३ कमी"), which is the marks framing again in another shape. */}
                    <p
                        data-testid="day-understanding-target"
                        className="mt-2"
                        style={{ fontSize: 12.5, lineHeight: 1.5 }}
                    >
                        <span
                            className="font-bold"
                            style={{ color: dayUnderstandingScore >= UNDERSTANDING_TARGET ? '#047857' : '#1E56E6' }}
                        >
                            {dayUnderstandingScore >= UNDERSTANDING_TARGET
                                ? t('dfes.graspTargetHit')
                                : t('dfes.graspTarget').replace('{target}', toMarathiNumber(UNDERSTANDING_TARGET))}
                        </span>
                        <span className="text-stone-500">{` — ${t('dfes.dayUnderstandingMeaning')}`}</span>
                    </p>
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
