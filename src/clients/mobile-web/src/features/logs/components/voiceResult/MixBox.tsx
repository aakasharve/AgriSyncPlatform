/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 3; founder 2026-11-06, D-96, P4) - the combination box and the
 * red banner of the result screen. The verdict is IT1's (`domain/inputs/mixVerdict`): this file adds no rule.
 *
 *   - A COMBINATION exists only where the record says the products shared a tank (the same `mix[]`, or the same non-empty
 *     `mixId`). Two inputs that are only on the same day form none.
 *   - RED needs a sourced rule that a person has reviewed (`isShippable`). The two red rules are unreviewed today (D-96), so in
 *     production nothing is red - the box is grey. The red path is proven with a test-only reviewed rule.
 *   - Red says why, what to do next time and the source, and "नोंद सांगितली तशीच राहील": the verdict is read from the record and
 *     NEVER written into it (P1, P7). A combination with a product the library does not know is never green.
 */
import React from 'react';
import { CircleHelp, OctagonAlert } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { inputWords } from '../../../../domain/inputs/inputWords';
import { matchProduct } from '../../../../domain/inputs/inputCatalog';
import { combinationsOf, judgeMix, SHIPPABLE_RULES, type Combination, type MixResult, type MixRule } from '../../../../domain/inputs/mixVerdict';
import type { DailyLog } from '../../../../domain/types/log.types';
import { resultCopy } from './resultCopy';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface TankVerdict {
    /** The first product's input event: the line of the day the box sits under (and the banner opens). */
    hostEventId: string;
    logId: string;
    combination: Combination;
    result: MixResult;
    /** A member the library does not know (or knows by a shared name): never green, and said so on a grey box. */
    unknownMember: boolean;
}

/** The tank verdicts of a record, derived on read; nothing is stored. Rules default to the shippable list (none red today). */
export function tankVerdictsOf(log: DailyLog | undefined, rules: readonly MixRule[] = SHIPPABLE_RULES): TankVerdict[] {
    if (!log) return [];
    return combinationsOf(log.inputs).map(combination => ({
        hostEventId: combination.items[0]?.inputEventId ?? '',
        logId: log.id,
        combination,
        result: judgeMix(combination, rules),
        unknownMember: combination.items.some(i => matchProduct(i.spokenName, i.npkGrade).state !== 'found'),
    }));
}

export const MixBox: React.FC<{ verdict: TankVerdict }> = ({ verdict }) => {
    const language = useOptionalLanguage()?.language;
    const lang = language === 'en' ? 'en' : 'mr';
    const words = inputWords(lang);
    const copy = resultCopy(language);
    const { result } = verdict;

    if (result.state === 'red') {
        return (
            <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-2.5" data-testid="vr-mixbox" data-state="red" style={{ fontFamily: SANS }}>
                <div className="flex items-center gap-1.5 text-[14.5px] font-extrabold text-rose-800">
                    <OctagonAlert size={20} aria-hidden="true" /><span data-testid="vr-mix-title">{words.mixRed}</span>
                </div>
                {result.why && <div className="mt-1 text-[13.5px] font-bold leading-snug text-stone-800" data-testid="vr-mix-why">{result.why[lang]}</div>}
                {result.nextTime && <div className="mt-1.5 text-[13px] font-extrabold text-rose-900" data-testid="vr-mix-next">{result.nextTime[lang]}</div>}
                <div className="mt-1 text-[11.5px] font-semibold text-stone-500" data-testid="vr-mix-source">
                    {[result.sources[0] ? copy.mixSource(result.sources[0].title) : '', words.recordUnchanged].filter(Boolean).join(' · ')}
                </div>
            </div>
        );
    }
    if (result.state === 'green') {
        return (
            <div className="rounded-xl bg-emerald-50 p-2.5 ring-1 ring-emerald-100" data-testid="vr-mixbox" data-state="green" style={{ fontFamily: SANS }}>
                <div className="text-[13.5px] font-extrabold text-emerald-900" data-testid="vr-mix-title">{words.mixGreen}</div>
            </div>
        );
    }
    return (
        <div className="flex items-start gap-1.5 rounded-xl bg-stone-100 p-2.5 text-[13.5px] font-bold text-stone-700" data-testid="vr-mixbox" data-state="grey" style={{ fontFamily: SANS }}>
            <CircleHelp size={18} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" />
            <span data-testid="vr-mix-title">{verdict.unknownMember ? words.mixUnknownMember : words.mixGrey}</span>
        </div>
    );
};

/** The red banner on top of the screen: one line, and one tap opens the line of the day that holds the wrong mix. */
export const MixBanner: React.FC<{ reds: readonly TankVerdict[]; hint: string; onOpen: (v: TankVerdict) => void }> = ({ reds, hint, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    if (reds.length === 0) return null;
    return (
        <button type="button" onClick={() => onOpen(reds[0])} data-testid="vr-mix-banner"
            className="flex w-full items-center gap-2 rounded-2xl bg-rose-600 px-3 py-2.5 text-left text-white" style={{ fontFamily: SANS }}>
            <OctagonAlert size={24} className="shrink-0" aria-hidden="true" />
            <span className="flex-1">
                <span className="block text-[15px] font-extrabold">{reds.length === 1 ? copy.mixBannerOne : copy.mixBannerMany(reds.length)}</span>
                <span className="block text-[12.5px] font-bold text-rose-100">{hint}</span>
            </span>
        </button>
    );
};
