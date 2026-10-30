// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
//
// The optional improvement switch, "माझ्या अनुभवातून श्रमसफल अधिक सक्षम होऊ द्या". Drawn in
// two places — the गोपनीयता व संमती page and the one-time notice-change sheet — and owning no
// state: the caller decides what is stored and when it is sent.
//
// Rules it is built to:
//   • OFF unless the caller says ON. Never pre-ticked.
//   • The founder's supporting text is ALWAYS visible — what the permission covers, that it is
//     optional, and that turning it off keeps logging and replay working. A disclosure behind
//     a tap is a disclosure a farmer can miss.
//   • One language at a time.

import React from 'react';
import { IMPROVEMENT_COPY, type SwitchLanguage } from './improvementPermissionCopy';

interface Props {
    language: SwitchLanguage;
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Held while saving, or while the stored choice could not be read (we cannot show it). */
    disabled?: boolean;
    /** Show the "not saved" line under the switch. */
    saveFailed?: boolean;
}

const ImprovementPermissionToggle: React.FC<Props> = ({ language, checked, onChange, disabled = false, saveFailed = false }) => {
    const copy = IMPROVEMENT_COPY[language];
    return (
        <div className="glass-panel p-5" data-testid="improvement-permission-toggle">
            <label className={`flex items-start gap-4 ${disabled ? 'cursor-default opacity-80' : 'cursor-pointer'}`}>
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-labelledby="improvement-permission-title"
                    aria-describedby="improvement-permission-body"
                    data-testid="improvement-permission-checkbox"
                    className="mt-1.5 h-5 w-5 shrink-0 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="flex-1 min-w-0">
                    <div id="improvement-permission-title" className="font-bold text-stone-800 text-base">
                        {copy.title}
                    </div>
                    <p id="improvement-permission-body" className="mt-2 text-sm text-stone-600 leading-relaxed">
                        {copy.body}
                    </p>
                    {saveFailed && (
                        <p className="mt-2 text-sm font-medium text-red-600" data-testid="improvement-permission-save-failed">
                            {copy.saveFailed}
                        </p>
                    )}
                </div>
            </label>
        </div>
    );
};

export default ImprovementPermissionToggle;
