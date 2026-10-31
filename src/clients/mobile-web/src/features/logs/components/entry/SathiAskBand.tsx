/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-02, H12) — Sathi asks ONE question on
 * each entry step, in the founder's own words (preview `postVoiceResult/SathiAskBand.tsx`).
 *
 * The standing figure (pointing down, hands breaking out of the card) beside the question (big) and
 * its one-line instruction (small). It is the `lead` of `CropPlotStepper`. It replaces the old
 * `SathiGuideCard` wording ("आज कोणत्या प्लॉटवर काम केलं?") on this screen.
 * Crop names are set in the SANS font on purpose: the serif drops the anusvara of "डाळिंब".
 *
 * `labour` (arrived from हजेरी): the plot step asks the founder's 2026-08-31 हजेरी question instead
 * (the old SathiGuideCard `forLabour` headline and its "take every name" line) — I12-V1-m1.
 */
import React from 'react';
import type { StepperStep } from '../../../context/components/CropPlotStepper';
import { CalendarDays } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { DATED_ASK, ENTRY_WORDS, FOUNDER_ASK, INCOME_ASK, LABOUR_ASK } from './entryWords';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface SathiAskBandProps {
    step: StepperStep; cropNames: string[]; global: boolean; labour?: boolean;
    /** Lane OF (D-60) — a past day he chose ("30 ऑक्टो"): the question names it, and a chip says it. */
    forDay?: string;
    /** Lane OF (CTX-1) — the same steps asking where an INCOME came from. */
    ask?: 'work' | 'income';
}

export const SathiAskBand: React.FC<SathiAskBandProps> = ({ step, cropNames, global, labour = false, forDay, ask = 'work' }) => {
    const language = useOptionalLanguage()?.language;
    const dated = language === 'en' ? DATED_ASK.en : DATED_ASK.mr;
    const income = language === 'en' ? INCOME_ASK.en : INCOME_ASK.mr;
    const labourPlot = labour && step === 'plot';
    const names = cropNames.join(', ');
    const question = global
        ? (ask === 'income' ? income.hint : ENTRY_WORDS.entireFarmHelp)
        : ask === 'income' ? (step === 'crop' ? income.cropQuestion : income.plotQuestion(names))
        : forDay ? (step === 'crop' ? dated.cropQuestion(forDay) : dated.plotQuestion(names, forDay))
        : step === 'crop' ? FOUNDER_ASK.cropQuestion
        : labourPlot ? LABOUR_ASK.plotQuestion : FOUNDER_ASK.plotQuestion(names);
    const hint = global ? '' : ask === 'income' ? (step === 'crop' ? income.hint : '')
        : step === 'crop' ? FOUNDER_ASK.cropHint : labourPlot ? LABOUR_ASK.plotHint : FOUNDER_ASK.plotHint;
    return (
        <div className="relative mb-4 [@media(max-height:720px)]:mb-3 flex min-h-[88px] [@media(max-height:720px)]:min-h-[70px] overflow-visible rounded-[28px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-lime-50 to-emerald-100/70 shadow-md" data-testid="flow-sathi" data-step={step} data-labour={labourPlot ? 'yes' : undefined}>
            <div className="relative z-[1] w-[26%] shrink-0 self-stretch">
                <img src="/images/sathi/sathi-points-down-both.png" alt="" width={1086} height={1448}
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(100%+14px)] w-full object-contain object-bottom motion-safe:animate-plr-bob" />
            </div>
            <div className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center py-2.5 [@media(max-height:720px)]:py-1.5 pl-1 pr-3.5" style={{ fontFamily: SANS }}>
                {forDay && ask === 'work' && (
                    <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full border border-emerald-300 bg-white px-2.5 py-0.5 text-[13px] font-extrabold text-emerald-800" data-testid="flow-sathi-day">
                        <CalendarDays size={14} aria-hidden="true" />{dated.dayChip(forDay)}
                    </span>
                )}
                <p className="m-0 text-[18px] [@media(max-height:720px)]:text-[16px] font-extrabold leading-snug text-stone-900" data-testid="flow-sathi-question">{question}</p>
                {hint && <p className="m-0 mt-1 text-[14px] [@media(max-height:720px)]:text-[13px] font-bold leading-snug text-emerald-800" data-testid="flow-sathi-hint">{hint}</p>}
            </div>
        </div>
    );
};

export default SathiAskBand;
