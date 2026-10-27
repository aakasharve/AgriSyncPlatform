/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16, round-2 review WAIT-1) — what the first run
 * shows while it cannot yet tell its next step: the two once-only prefs are still being read from the
 * phone, or /farms/mine has not answered (bounded by `FARM_LIST_WAIT_MS`). It used to be an empty area
 * with no words, so on a slow connection a farmer who had just signed in looked at a blank screen.
 *
 * For a phone that passed the first run long ago the wait is a blink (the prefs read), so the spinner
 * and the words come only after `WAIT_WORDS_DELAY_MS`: a blink stays quiet (no flash of words on every
 * opening of the app); a real wait says the app is opening.
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { firstRunCopy } from './firstRunCopy';

export const WAIT_WORDS_DELAY_MS = 600;

const FirstRunWait: React.FC = () => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const [showWords, setShowWords] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setShowWords(true), WAIT_WORDS_DELAY_MS);
        return () => clearTimeout(t);
    }, []);
    return (
        <div role="status" aria-live="polite" data-testid="first-run-wait"
            className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
            {showWords && (
                <>
                    <Loader2 size={30} aria-hidden="true" className="text-emerald-600 motion-safe:animate-spin" />
                    <p className="m-0 text-[16px] font-extrabold text-stone-600" data-testid="first-run-wait-words">
                        {firstRunCopy(language).waiting}
                    </p>
                </>
            )}
        </div>
    );
};

export default FirstRunWait;
