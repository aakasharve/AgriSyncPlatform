/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43, doctrine P5 / P11) — the calm "new version" card at the top
 * of आजची कामे, above "काय करायचं आहे?". Draws NOTHING unless the server named a version newer than
 * this build (`appUpdateState`).
 *
 * "अपडेट करा" goes to the allow-listed place for this build's channel (`updateChannel`). "नंतर" hides it
 * until the next day. Below the server's minimum version there is no "नंतर" and one line says the old
 * version may stop working soon — but the card never covers or blocks anything (P11): the rest of the
 * page stays usable.
 *
 * Language: the app's language (one language per screen); outside a `LanguageProvider` it falls back to
 * Marathi, the app's own fallback.
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { SANS, Tap } from '../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import type { Language } from '../../i18n/language';
import { appUpdateWords } from '../../i18n/appUpdateTranslations';
import { putOffAppUpdate, useAppUpdate } from './appUpdateState';
import { goToUpdate } from './updateChannel';

export const AppUpdateCard: React.FC<{ language?: Language }> = ({ language }) => {
    const context = useOptionalLanguage();
    const update = useAppUpdate();
    if (!update.showCard || !update.latestVersion) return null;
    const words = appUpdateWords(language ?? context?.language ?? 'mr');

    return (
        <section role="status" data-testid="app-update-card" style={{ fontFamily: SANS }}
            className="rounded-[28px] border border-emerald-200 bg-white/90 p-4 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)]">
            <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
                    <RefreshCw size={22} strokeWidth={2.4} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-[18px] font-extrabold leading-tight text-stone-900" data-testid="app-update-title">{words.cardTitle}</p>
                    <p className="m-0 mt-1 text-[14px] font-semibold leading-snug text-stone-600" data-testid="app-update-version">
                        {words.cardVersionLine(update.latestVersion, update.installedVersion)}
                    </p>
                    {update.belowMinimum && (
                        <p className="m-0 mt-1.5 text-[14px] font-bold leading-snug text-amber-800" data-testid="app-update-must">{words.cardMustUpdateLine}</p>
                    )}
                </div>
            </div>
            <div className="mt-3 flex gap-2">
                <Tap onClick={() => goToUpdate(update.release)} data-testid="app-update-go" rippleColor="rgba(255,255,255,0.35)"
                    className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-gradient-to-r from-emerald-700 to-emerald-500 px-4 text-[16px] font-extrabold text-white shadow">
                    {words.updateButton}
                </Tap>
                {!update.belowMinimum && (
                    <Tap onClick={putOffAppUpdate} data-testid="app-update-later"
                        className="min-h-[48px] shrink-0 rounded-full border border-stone-300 bg-white px-5 text-[16px] font-extrabold text-stone-700">
                        {words.laterButton}
                    </Tap>
                )}
            </div>
        </section>
    );
};

export default AppUpdateCard;
