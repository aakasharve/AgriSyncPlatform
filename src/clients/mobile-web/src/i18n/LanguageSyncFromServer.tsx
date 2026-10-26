/**
 * LanguageSyncFromServer — once per session, pulls the caller's
 * `preferredLanguage` from /me/context and sets the app language.
 *
 * Why server-first: the target user is a semi-literate Marathi farmer. If
 * a helper logs them in on a shared phone that was last used in English,
 * Marathi should load first — not whatever localStorage remembers.
 *
 * We sync once per authenticated session so that a user who manually flips
 * language in Settings later in the same session isn't stomped on refresh.
 *
 * Mount this inside <LanguageProvider> AND inside <FarmContextProvider>
 * (it hooks both). Renders nothing.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-1): a language CHOSEN on this
 * phone (on स्वागत, before login, or in सेट-अप केंद्र) wins — `skip`. The server's value is never
 * written by the app, so without this it turned every choice back into Marathi on each start.
 * `apply` lets the provider store the server value without recording it as the phone's choice.
 */
import { useEffect, useRef } from 'react';
import { useFarmContext } from '../core/session/FarmContext';
import { useLanguage } from './LanguageContext';
import type { Language } from './translations';

export const LanguageSyncFromServer: React.FC<{ apply?: (lang: Language) => void; skip?: boolean }> = ({ apply, skip = false }) => {
    const { meContext } = useFarmContext();
    const { setLanguage } = useLanguage();
    const syncedRef = useRef(false);
    const applyLanguage = apply ?? setLanguage;

    useEffect(() => {
        if (syncedRef.current || skip) return;
        const pref = meContext?.me?.preferredLanguage;
        if (!pref) return;
        // Backend may hold 'mr' | 'hi' | 'en' in historical rows. The app offers
        // 'mr' | 'en' only: an old 'hi' (or anything else) becomes Marathi.
        const mapped: Language = pref === 'en' ? 'en' : 'mr';
        applyLanguage(mapped);
        syncedRef.current = true;
    }, [meContext, applyLanguage, skip]);

    return null;
};
