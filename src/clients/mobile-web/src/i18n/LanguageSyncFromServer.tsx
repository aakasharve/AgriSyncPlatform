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
 */
import { useEffect, useRef } from 'react';
import { useFarmContext } from '../core/session/FarmContext';
import { useLanguage } from './LanguageContext';
import type { Language } from './translations';

export const LanguageSyncFromServer: React.FC = () => {
    const { meContext } = useFarmContext();
    const { setLanguage } = useLanguage();
    const syncedRef = useRef(false);

    useEffect(() => {
        if (syncedRef.current) return;
        const pref = meContext?.me?.preferredLanguage;
        if (!pref) return;
        // Backend: 'mr' | 'hi' | 'en'. Frontend today supports 'mr' | 'en'.
        // Hindi speakers get Marathi (Devanagari script, target audience).
        const mapped: Language = pref === 'en' ? 'en' : 'mr';
        setLanguage(mapped);
        syncedRef.current = true;
    }, [meContext, setLanguage]);

    return null;
};
