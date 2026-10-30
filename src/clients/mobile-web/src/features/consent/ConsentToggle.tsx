// spec: data-principle-spine-2026-05-05/06.4
//
// Single consent toggle — checkbox + title
// + expandable body. Three independent instances live inside
// `ConsentScreen.tsx`, one per purpose (full-history journal,
// cross-farm aggregation, research/corpus export).
//
// All visible strings flow through `tConsent(locale, key)`.

import React, { useState } from 'react';
import {
    type ConsentLocale,
    tConsent,
} from '../../i18n/consentTranslations';

// plr-d10 I25: 'crossFarmAggregation' is no longer drawn (founder D-36 — the improvement
// permission has its own switch, features/consent/improvement).
export type ConsentToggleId =
    | 'fullHistoryJournal'
    | 'researchCorpusExport';

interface Props {
    toggleId: ConsentToggleId;
    value: boolean;
    onChange: (next: boolean) => void;
    locale: ConsentLocale;
    /** For test/automation: lets the test query by stable selector. */
    testId?: string;
    /** plr-d10 I25 (founder D-31): the switch's meaning, always shown under the title. */
    meaning?: string;
}

const ConsentToggle: React.FC<Props> = ({ toggleId, value, onChange, locale, testId, meaning }) => {
    const [expanded, setExpanded] = useState(false);

    const title = tConsent(locale, `toggles.${toggleId}.title`);
    const body = tConsent(locale, `toggles.${toggleId}.body`);
    const expandLabel = tConsent(locale, 'toggles.expand');

    return (
        <div className="glass-panel p-5" data-testid={testId ?? `consent-toggle-${toggleId}`}>
            <label className="flex items-start gap-4 cursor-pointer">
                <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-label={title}
                    data-testid={`consent-checkbox-${toggleId}`}
                    className="mt-1.5 h-5 w-5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="flex-1">
                    <div className="font-bold text-stone-800 text-base">{title}</div>
                    {meaning && (
                        <p className="mt-1 text-sm font-medium text-stone-700 leading-snug" data-testid={`consent-meaning-${toggleId}`}>
                            {meaning}
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            setExpanded((p) => !p);
                        }}
                        className="mt-2 text-xs font-bold text-emerald-700 hover:text-emerald-900"
                        data-testid={`consent-expand-${toggleId}`}
                    >
                        {expanded ? '−' : '+'} {expandLabel}
                    </button>
                    {expanded && (
                        <div className="mt-2 text-sm text-stone-600 leading-relaxed">
                            {body}
                        </div>
                    )}
                </div>
            </label>
        </div>
    );
};

export default ConsentToggle;
