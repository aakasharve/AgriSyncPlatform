/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The variety list of the add-plot wizard (step 1).
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 10; founder 2026-11-21): the chips are 48 px high (they were about
 * 30 px, under the 44 px thumb rule) in the ONE chosen look every plot and crop picker uses - dark green (emerald-800), white letters, a white tick
 * (a shape, so it reads in sunlight); not chosen: white with a grey border. The last chip, "Other", reads "अन्य" in Marathi mode and the typing box's
 * placeholder is Marathi there too (draft Marathi - needs review). The variety names themselves are the farmer's crop's own names and are shown as
 * stored; the stored value of the last chip stays "Other".
 */
import React from 'react';
import { Check } from 'lucide-react';
import { getVarietiesForCrop } from '../data/varietyCatalog';

/** The two words this list says in the screen's language (draft Marathi - needs review, except "अन्य", approved 2026-11-21). */
const VARIETY_WORDS = {
    mr: { other: 'अन्य', typed: 'वाणाचं नाव लिहा' },
    en: { other: 'Other', typed: 'Enter variety name' },
} as const;

interface VarietySelectorProps {
    cropName: string;
    value: string;
    onChange: (variety: string) => void;
    error?: string;
    /** The screen's language (the wizard passes its own); Marathi when not given, as everywhere in the app. */
    language?: string | null;
}

export const VarietySelector: React.FC<VarietySelectorProps> = ({ cropName, value, onChange, error, language }) => {
    const varieties = getVarietiesForCrop(cropName);
    const isCustom = !varieties.includes(value) && value !== '';
    const w = VARIETY_WORDS[language === 'en' ? 'en' : 'mr'];

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {varieties.map(v => {
                    const on = value === v || (v === 'Other' && isCustom);
                    return (
                        <button
                            key={v}
                            type="button"
                            data-testid={`variety-chip-${v}`}
                            aria-pressed={on}
                            onClick={() => onChange(v === 'Other' ? '' : v)}
                            className={`inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border-2 px-4 text-[15px] font-bold transition-colors active:scale-95 ${
                                on
                                    ? 'border-emerald-800 bg-emerald-800 text-white'
                                    : 'border-stone-400 bg-white text-stone-800'
                            }`}
                        >
                            {on && <Check size={16} strokeWidth={3} className="shrink-0 text-white" aria-hidden="true" data-part="tick" />}
                            <span>{v === 'Other' ? w.other : v}</span>
                        </button>
                    );
                })}
            </div>

            {(value === 'Other' || isCustom) && (
                <input
                    type="text"
                    placeholder={w.typed}
                    value={value === 'Other' ? '' : value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 mt-2 ${
                        error ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                />
            )}

            {error && (
                <p className="text-red-500 text-xs mt-1">{error}</p>
            )}
        </div>
    );
};
