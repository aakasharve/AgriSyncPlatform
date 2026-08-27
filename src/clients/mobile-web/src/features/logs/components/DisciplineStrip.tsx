/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DisciplineStrip — the farmer's consistency, and the reason he comes back.
 *
 * SEMI-LITERATE REDESIGN 2026-08-13 (founder: "psychologically backed… give him a
 * hook to log daily and an emotional uplift for the log he just made"). The old
 * strip put the streak number in a 2xl box beside two 12px stat lines
 * ("१० श्रम-गुण  ·  सर्वाधिक २  ·  2026-08-13") — three competing numbers, an ISO
 * date a tier-3/4 farmer does not read, and no invitation to return.
 *
 * What this is doing psychologically, deliberately:
 *
 *  - DON'T-BREAK-THE-CHAIN. The chain is now VISIBLE — one filled dot per day
 *    already earned, plus ONE hollow dot for tomorrow. An unfinished row is a far
 *    stronger pull than a bare count, because the gap is what the eye lands on.
 *  - ENDOWED PROGRESS. Tomorrow's slot is already drawn, so the next day reads as
 *    a chain he is part-way through rather than a new effort he must start.
 *  - LOSS AVERSION, kept kind. The invitation is "उद्या पुन्हा सांगा — मालिका चालू
 *    ठेवा", never a warning about losing anything. This is a companion, not a
 *    habit app that punishes.
 *  - EFFORT JUSTIFICATION. The recognition line names what he did, so the minute
 *    he spent speaking is immediately worth something.
 *
 * Numbers a semi-literate reader cannot use are cut: the ISO date is gone (it was
 * raw `lastAccountedDate`, unlocalised) and "सर्वाधिक" is demoted to a quiet
 * footnote. Devanagari numerals throughout, DM Sans for the digits per the charter.
 */
import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import { buildRecognitionLine, toMarathiNumber } from '../services/disciplineRecognition';

export interface DisciplineStripProps {
    engagement: FarmerEngagementDto | null;
    className?: string;
}

/** How many chain dots to draw at most before the row would start to crowd. */
const MAX_DOTS = 7;

export function DisciplineStrip({
    engagement,
    className = '',
}: DisciplineStripProps): React.ReactElement | null {
    const { t } = useLanguage();

    if (!FEATURE_FLAGS.disciplineSystem || !engagement) {
        return null;
    }

    const recognition = buildRecognitionLine(engagement);
    const streak = Math.max(0, engagement.currentStreak);
    // Show the most recent `MAX_DOTS - 1` earned days, then tomorrow's empty slot.
    const filled = Math.min(streak, MAX_DOTS - 1);

    return (
        <section
            data-testid="discipline-strip"
            className={className}
            aria-label="Shram discipline"
            style={{ textAlign: 'left' }}
        >
            {/* The number and its unit, read as one phrase: "२ दिवस सलग". */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span
                    data-testid="discipline-streak"
                    style={{
                        fontFamily: "'DM Sans', sans-serif", fontWeight: 900,
                        fontSize: 32, lineHeight: 1, color: '#047857',
                    }}
                >
                    {toMarathiNumber(streak)}
                </span>
                <span
                    style={{
                        fontFamily: "'Noto Sans Devanagari', sans-serif",
                        fontWeight: 800, fontSize: 15, color: '#047857',
                    }}
                >
                    {t('dfes.streakDaysUnit')}
                </span>

            {/* The chain. Filled = days already earned; the last, hollow one is
                tomorrow — drawn BEFORE it is earned, which is the whole point. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }} aria-hidden="true">
                {Array.from({ length: filled }).map((_, i) => (
                    <span
                        key={`on-${i}`}
                        style={{
                            width: 15, height: 15, borderRadius: 9999,
                            background: '#059669', boxShadow: '0 0 0 3px rgba(5,150,105,.14)',
                        }}
                    />
                ))}
                <span
                    data-testid="discipline-tomorrow"
                    style={{
                        width: 15, height: 15, borderRadius: 9999,
                        border: '2px dashed #7CC9A8', background: 'transparent',
                    }}
                />
            </div>
            </div>

            <p
                data-testid="discipline-tomorrow-line"
                style={{
                    margin: '8px 0 0', fontFamily: "'Noto Sans Devanagari', sans-serif",
                    fontWeight: 700, fontSize: 12.5, color: '#0F766E',
                }}
            >
                {t('dfes.streakTomorrow')}
            </p>

            <p
                data-testid="discipline-recognition"
                style={{
                    margin: '7px 0 0', fontFamily: "'Noto Sans Devanagari', sans-serif",
                    fontWeight: 700, fontSize: 13.5, lineHeight: 1.45, color: '#292524',
                }}
            >
                {recognition}
            </p>

            {/* Quiet footnote — the points total stays auditable without competing
                with the streak for attention. */}
            <p
                data-testid="discipline-points"
                style={{
                    margin: '5px 0 0', fontFamily: "'Noto Sans Devanagari', sans-serif",
                    fontWeight: 600, fontSize: 11, color: '#93A29B',
                }}
            >
                {toMarathiNumber(engagement.totalShramPoints)} श्रम-गुण
            </p>
        </section>
    );
}
