/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1b (founder Q5, 27 Nov; CTO ruling 3). On the
 * FIRST record's "जतन झालं" screen, right under the saved card: his line "तुमच्या शेताची माहिती पूर्ण करा. म्हणजे पुढील
 * कामांच्या नोंदी अधिक अचूक होतील.", "शेताची माहिती भरा" (the setup hub) and "नंतर". Offered as the natural next step and
 * never forced: it blocks nothing on the screen (the mic, "बदला", his voice all stay). Presentational; the container decides
 * when it shows (`useFirstRecordOffer`) and holds the screen's self-close while it does.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { firstRecordWords } from '../../../onboarding/firstRun/firstRecordWords';
import { SANS } from './savedBits';

export const FirstRecordOffer: React.FC<{ onFill: () => void; onLater: () => void }> = ({ onFill, onLater }) => {
    const words = firstRecordWords(useOptionalLanguage()?.language).offer;
    return (
        <section className="rounded-[18px] border-[1.5px] border-[#B7E4C7] bg-[#F0FDF4] p-3" style={{ fontFamily: SANS }} data-testid="vr2-first-record-offer">
            <p className="m-0 text-[15px] font-bold leading-snug text-[#14532D] [overflow-wrap:anywhere]" data-testid="vr2-first-record-line">{words.line}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={onFill} data-testid="vr2-first-record-fill"
                    className="min-h-[44px] flex-1 rounded-full bg-[#0F6B3A] px-4 text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(15,107,58,0.25)] active:scale-95">
                    {words.fill}
                </button>
                <button type="button" onClick={onLater} data-testid="vr2-first-record-later"
                    className="min-h-[44px] rounded-full border border-[#DDE3DA] bg-white px-4 text-[15px] font-extrabold text-[#44403C] active:scale-95">
                    {words.later}
                </button>
            </div>
        </section>
    );
};

export default FirstRecordOffer;
