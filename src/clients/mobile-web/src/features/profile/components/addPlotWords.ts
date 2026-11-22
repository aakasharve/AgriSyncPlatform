/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 10; founder 2026-11-21) - the words of the add-plot wizard's steps 1
 * and 2 (the plot, its area, its variety, what was planted) that were English on a Marathi screen: the placeholders, the errors, the hint under the
 * variety and the seed units (the variety chips' own two words, "अन्य" and the typing box, live in `VarietySelector`). Marathi first, English twin (English mode keeps the English it always had). Step 3 (the date question) has its own
 * words in `plotStart/plotStartCopy.ts` and is not touched.
 *
 * Every Marathi line below is PROPOSED (draft Marathi - needs review); the five the founder approved are marked "approved".
 *
 * Also `nextPlotName`: the optional placeholder that shows the next plot's name in the farmer's OWN pattern ("G16" after G15). It is only ever a grey
 * placeholder, never a value: plot names remain his free text, and with no number at the end of his names there is no pattern and no guess.
 */
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import { toLatinDigits } from '../../context/components/plotSelectorRules';

export interface PlotWizardWords {
    /** The plot-name placeholder; `next` is the name in his own pattern (or null: the plain example). */
    plotNameExample: (next: string | null) => string;
    plotNameNeeded: string;
    areaNeeded: string;
    varietyNeeded: string;
    varietyOrNext: string;
    seedQtyNeeded: string;
    plantAgeNeeded: string;
    seedCompanyExample: string;
    nurseryExample: string;
    plantAgeExample: string;
    /** The seed quantity's units, by the value that is stored ("Packets" stays "Packets"). */
    units: { kg: string; gm: string; Packets: string };
}

export const PLOT_WIZARD_WORDS: Record<'mr' | 'en', PlotWizardWords> = {
    mr: {
        plotNameExample: next => `उदा. ${next ?? 'G16'}`, // approved ("उदा. G16")
        plotNameNeeded: 'प्लॉटचं नाव लिहा', // approved
        areaNeeded: 'क्षेत्र लिहा', // the app's own first half of the old "क्षेत्र लिहा · Enter the area"
        varietyNeeded: 'वाणाचं नाव किंवा बियाणं / रोपवाटिकेचं नाव लिहा', // approved
        varietyOrNext: 'किंवा पुढच्या पायरीत बियाणं / रोपवाटिकेचं नाव लिहा', // draft Marathi - needs review
        seedQtyNeeded: 'बियाण्याचं प्रमाण लिहा', // draft Marathi - needs review
        plantAgeNeeded: 'रोपाचं वय लिहा', // draft Marathi - needs review
        seedCompanyExample: 'उदा. महाबीज', // draft Marathi - needs review
        nurseryExample: 'उदा. नाशिक रोपवाटिका', // draft Marathi - needs review
        plantAgeExample: 'रोप किती दिवसांचं होतं', // draft Marathi - needs review
        units: { kg: 'किलो', gm: 'ग्रॅम', Packets: 'पाकीट' }, // approved ("किलो / ग्रॅम / पाकीट")
    },
    en: {
        plotNameExample: next => `e.g. ${next ?? 'Riverside Plot'}`,
        plotNameNeeded: 'Plot name is required',
        areaNeeded: 'Enter the area',
        varietyNeeded: 'Enter Variety name or Seed/Nursery name (at least one required)',
        varietyOrNext: 'Or provide seed/nursery name in next step',
        seedQtyNeeded: 'Seed quantity is required',
        plantAgeNeeded: 'Plant age is required',
        seedCompanyExample: 'e.g. Mahabeej',
        nurseryExample: 'e.g. Nashik Grapes',
        plantAgeExample: 'Days old when planted',
        units: { kg: 'kg', gm: 'gm', Packets: 'Pkt' },
    },
};

export const plotWizardWords = (language: string | null | undefined): PlotWizardWords => PLOT_WIZARD_WORDS[language === 'en' ? 'en' : 'mr'];

// ── the next plot's name, in his own pattern ──────────────────────────────────────────────────────────

/** A name that ends in a number: its text before the number, then the number's digits (Latin or Devanagari). */
const NUMBERED = /^(.*?)([0-9०-९]+)$/u;
/** More digits than this at the end of a name is a survey or gat number, not a counter: no pattern is read from it. */
const MAX_COUNTER_DIGITS = 4;

const DEVANAGARI = /[०-९]/;

/**
 * The name the NEXT plot would carry in the farmer's own pattern: the text and the number style of the last of his names that ends in a number,
 * with the highest number of that same text plus one ("G15" -> "G16"; "ऊस २" -> "ऊस ३"; "G09" -> "G10"). `null` when none of the names ends in a
 * number (no pattern, so nothing is suggested). Names are read as they are stored, never rewritten.
 */
export function nextPlotName(names: readonly string[]): string | null {
    const numbered = names
        .map(n => NUMBERED.exec(n.trim()))
        .filter((m): m is RegExpExecArray => m !== null && m[2].length <= MAX_COUNTER_DIGITS);
    const last = numbered[numbered.length - 1];
    if (!last) return null;
    const prefix = last[1];
    const sameText = numbered.filter(m => m[1].toLowerCase() === prefix.toLowerCase());
    const highest = Math.max(...sameText.map(m => Number(toLatinDigits(m[2]))));
    const run = last[2];
    let next = String(highest + 1);
    // "G09" -> "G10": keep the width of a zero-padded counter.
    if (run.length > 1 && toLatinDigits(run).startsWith('0')) next = next.padStart(run.length, '0');
    return `${prefix}${DEVANAGARI.test(run) ? toDevanagariDigits(next) : next}`;
}
