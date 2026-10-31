/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43) — सेट-अप केंद्र → अ‍ॅप: "ॲपची आवृत्ती 1.0.18", always (the
 * installed version is always known). Only when a newer one exists does it become a row he can tap —
 * "नवीन 1.0.19 उपलब्ध — अपडेट करा", going where the home card's "अपडेट करा" goes. With nothing newer it
 * is a plain line, not a button: a button that does nothing is not drawn (P5).
 */
import React from 'react';
import { Smartphone } from 'lucide-react';
import { IconDot, RowLink } from '../../shared/components/ui/placeUi';
import type { Language } from '../../i18n/language';
import { appUpdateWords } from '../../i18n/appUpdateTranslations';
import { useAppUpdate } from './appUpdateState';
import { goToUpdate } from './updateChannel';

export const AppVersionRow: React.FC<{ language: Language }> = ({ language }) => {
    const update = useAppUpdate();
    const words = appUpdateWords(language);
    const icon = <Smartphone size={22} aria-hidden="true" />;
    const title = words.hubVersionTitle(update.installedVersion);

    if (update.updateAvailable && update.latestVersion) {
        return (
            <RowLink testId="hub-app-version" icon={icon} tone="green" title={title}
                line={words.hubNewVersionLine(update.latestVersion)} onClick={() => goToUpdate(update.release)} />
        );
    }
    return (
        <div data-testid="hub-app-version"
            className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.05)]">
            <IconDot tone="stone">{icon}</IconDot>
            <span className="min-w-0 flex-1 text-[16px] font-extrabold leading-tight text-stone-900">{title}</span>
        </div>
    );
};

export default AppVersionRow;
