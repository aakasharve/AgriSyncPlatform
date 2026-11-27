/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S4) - the second name box on "माझी ओळख": a full name in English letters gets a
 * "मराठीत नाव" box, one in Marathi letters an "इंग्रजीत नाव" box, one in neither (or both) no box. The suggestion for it, when there is one, is only
 * ever shown greyed to the person himself until he taps "बरोबर" (P1: an inferred spelling never impersonates a stated one).
 */
import { englishToMarathi, type MarathiWordIndex } from './englishToMarathi';
import { marathiToEnglish } from './marathiToEnglish';
import { isEnglishName, nameScriptOf } from './nameScript';

/** Which script the second box holds: 'mr' (मराठीत नाव) or 'en' (इंग्रजीत नाव). */
export type OtherScript = 'mr' | 'en';

/** The second box for this full name, or null when there is none. */
export function otherScriptOf(fullName: string): OtherScript | null {
    const script = nameScriptOf(fullName.trim());
    if (script === 'latn') return 'mr';
    if (script === 'deva') return 'en';
    return null;
}

/**
 * The second box and its suggestion: Marathi -> English always by the rules; English -> Marathi only when the word list is sure (null index = the
 * list is not loaded yet: no suggestion, never a guess).
 */
export function suggestOtherScriptName(
    fullName: string,
    index: MarathiWordIndex | null,
): { target: OtherScript; suggestion: string | null } | null {
    const target = otherScriptOf(fullName);
    if (!target) return null;
    if (target === 'en') {
        const english = marathiToEnglish(fullName);
        return { target, suggestion: english && isEnglishName(english) ? english : null };
    }
    return { target, suggestion: index ? englishToMarathi(fullName, index) : null };
}
