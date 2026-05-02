/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { Language, translations, t as translate } from './translations';
import { LanguageSyncFromServer } from './LanguageSyncFromServer';
import { useUiPref } from '../shared/hooks/useUiPref';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Sub-plan 04 Task 3 — language preference now lives in Dexie's uiPrefs
    // (via useUiPref). Initial render returns the 'en' fallback; the
    // persisted value swaps in once Dexie load resolves, matching the
    // previous useEffect-on-mount behaviour byte-for-byte.
    const [storedLanguage, setStoredLanguage] = useUiPref<Language>('agrilog_language', 'en');
    const language: Language = storedLanguage === 'en' || storedLanguage === 'mr' ? storedLanguage : 'en';

    const setLanguage = (lang: Language) => {
        setStoredLanguage(lang);
    };

    const t = (key: string) => translate(key, language);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            <LanguageSyncFromServer />
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within LanguageProvider');
    }
    return context;
};
