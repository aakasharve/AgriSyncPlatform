// spec: data-principle-spine-2026-05-05/06.4
//
// Revoke-all button — confirms with the user, then calls onConfirm
// which `ConsentScreen` wires to `updateConsent({ all false })`.
// Confirmation copy is locale-specific and LEGAL_REVIEW_PENDING-tagged
// per OQ-7 i18n convention.

import React, { useState } from 'react';
import { type ConsentLocale, tConsent } from '../../i18n/consentTranslations';

interface Props {
    locale: ConsentLocale;
    onConfirm: () => void | Promise<void>;
    disabled?: boolean;
}

const RevokeAllButton: React.FC<Props> = ({ locale, onConfirm, disabled }) => {
    const [confirming, setConfirming] = useState(false);
    const buttonLabel = tConsent(locale, 'revoke.button');
    const confirmCopy = tConsent(locale, 'revoke.confirm');

    if (!confirming) {
        return (
            <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirming(true)}
                className="w-full py-3 px-4 rounded-xl bg-red-50 text-red-700 font-bold border-2 border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="consent-revoke-all-button"
            >
                {buttonLabel}
            </button>
        );
    }

    return (
        <div
            className="glass-panel p-4 border-2 border-red-300"
            data-testid="consent-revoke-confirm"
        >
            <p className="text-sm text-stone-800 mb-3">{confirmCopy}</p>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="flex-1 py-2 px-3 rounded-lg bg-stone-100 text-stone-700 font-bold hover:bg-stone-200"
                    data-testid="consent-revoke-cancel"
                >
                    ✕
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setConfirming(false);
                        void onConfirm();
                    }}
                    className="flex-1 py-2 px-3 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
                    data-testid="consent-revoke-confirm-button"
                >
                    ✓
                </button>
            </div>
        </div>
    );
};

export default RevokeAllButton;
