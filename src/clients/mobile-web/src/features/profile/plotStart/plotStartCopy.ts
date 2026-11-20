/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
 *
 * The words of the add-plot wizard's date question, Marathi first and an English twin. Every Marathi line here is PROPOSED (Marathi) until
 * the founder's reviewer reads it; the English twin is PROPOSED too. The date's own name per crop ("छाटणीची तारीख" ...) is the schedule
 * editor's own (`DAY_ZERO_LABEL`), reused so the two screens call the same day by the same name.
 */
import { DAY_ZERO_LABEL } from '../../scheduler/schedulePage/scheduleCopy';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import type { PlantingDateProblem, PlantingWordKey } from './plotStartChoice';
import { MAX_YEARS_BACK } from './plotStartChoice';

export type PlotStartLanguage = 'mr' | 'en';

/** The act, as the crop's own word: "ही छाटणी केव्हा केली?" */
const ACT_WORD: Readonly<Record<PlantingWordKey, Readonly<Record<PlotStartLanguage, string>>>> = {
    PLANTING: { mr: 'लागवड', en: 'planting' }, // PROPOSED
    PRUNING: { mr: 'छाटणी', en: 'pruning' }, // PROPOSED
    SOWING: { mr: 'पेरणी', en: 'sowing' }, // PROPOSED
    TRANSPLANTING: { mr: 'पुनर्लागवड', en: 'replanting' }, // PROPOSED
};

const DATE_LABEL_EN: Readonly<Record<PlantingWordKey, string>> = {
    PLANTING: 'Planting date', // PROPOSED
    PRUNING: 'Pruning date', // PROPOSED
    SOWING: 'Sowing date', // PROPOSED
    TRANSPLANTING: 'Replanting date', // PROPOSED
};

export interface PlotStartWords {
    question: string;
    dateLabel: string;
    today: string;
    earlier: string;
    dayToday: (n: number) => string;
    problem: (kind: PlantingDateProblem) => string;
    scheduleTitle: string;
    checkedBy: string;
    changeLater: string;
    noChecked: string;
}

export function plotStartWords(language: string | null | undefined, word: PlantingWordKey): PlotStartWords {
    const en = language === 'en';
    const lang: PlotStartLanguage = en ? 'en' : 'mr';
    const act = ACT_WORD[word][lang];
    return {
        question: en ? `When was this ${act} done?` : `ही ${act} केव्हा केली?`,
        dateLabel: en ? DATE_LABEL_EN[word] : DAY_ZERO_LABEL[word] ?? DAY_ZERO_LABEL.PLANTING,
        today: en ? 'Today' : 'आज',
        earlier: en ? 'Earlier' : 'आधी केली',
        // The same count the schedule tab shows; digits follow the screen's language (Devanagari in Marathi).
        dayToday: n => (en ? `Day ${n} today` : `आज दिवस ${digitsFor(n, language)}`),
        problem: kind => {
            if (kind === 'future') return en ? 'Pick a date up to today' : 'आजपर्यंतची तारीख निवडा';
            if (kind === 'too-old') {
                return en ? `A date older than ${MAX_YEARS_BACK} years is not accepted` : `${digitsFor(MAX_YEARS_BACK, language)} वर्षांपेक्षा जुनी तारीख चालत नाही`;
            }
            return en ? 'Pick a complete date' : 'पूर्ण तारीख निवडा';
        },
        scheduleTitle: en ? 'Schedule will start by itself' : 'शेड्यूल आपोआप लागेल',
        checkedBy: en ? 'Checked by ShramSafal' : 'ShramSafal ने तपासलेलं',
        changeLater: en ? 'To change it, use the Schedule tab later' : 'बदलायचं असेल तर नंतर शेड्यूल टॅबमध्ये',
        noChecked: en
            ? 'No checked schedule for this crop yet; the plot will be made without a schedule'
            : 'या पिकासाठी अजून तपासलेलं शेड्यूल नाही, प्लॉट शेड्यूलशिवाय बनेल',
    };
}
