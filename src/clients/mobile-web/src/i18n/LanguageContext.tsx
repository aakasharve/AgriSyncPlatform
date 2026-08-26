/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, ReactNode } from 'react';
// `Language` is re-exported by `translations.ts` from the `language.ts` leaf, so
// it is a TYPE here and must be imported as one — `isolatedModules` is on and a
// value-shaped import of a type-only re-export is the kind of thing that
// compiles today and breaks the day a bundler stops guessing.
// `translations` was imported here and never used — a pre-existing dead import
// this file's lint debt had never surfaced, because the file had never been
// staged (the pre-commit gate runs `--max-warnings 0` on STAGED files only).
// Dropped rather than suppressed. Zero rendered-output change: nothing read it.
import { t as translate, type Language } from './translations';
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
    // (via useUiPref). Initial render returns the fallback; the persisted value
    // swaps in once Dexie load resolves.
    //
    // The fallback is MARATHI. It used to be English, which meant a Marathi
    // voice-first app for Marathi smallholders opened in English on every first
    // launch and every fresh install — the one moment a farmer decides whether
    // this app is for him. `LanguageSyncFromServer` right below already states
    // the rule ("Marathi should load first — not whatever localStorage
    // remembers"); the fallback simply contradicted it, and the server
    // preference it relies on arrives too late to cover the first paint.
    //
    // A farmer who chooses English still keeps English: the stored uiPref wins
    // as soon as Dexie resolves, and the server sync only maps an explicit 'en'
    // back to English.
    //
    // evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 4
    const [storedLanguage, setStoredLanguage] = useUiPref<Language>('agrilog_language', 'mr');
    const language: Language = storedLanguage === 'en' || storedLanguage === 'mr' ? storedLanguage : 'mr';

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

/**
 * The same read, WITHOUT the throw — for a component that must keep working
 * outside `LanguageProvider`.
 *
 * spec: owner-oversight-loop, finding F5. `CropSelector` began calling
 * `useLanguage()` unconditionally for the founder-approved Marathi on the log
 * screen. That call throws for every consumer rendered outside this provider,
 * so a component that previously had no provider dependency at all silently
 * acquired a hard one. This hook lets such a component ask for the language
 * and handle "there is none" itself, instead of the whole subtree failing to
 * render.
 *
 * DELIBERATELY returns `undefined` rather than a synthesised default context:
 * a fabricated `{ language: 'en', setLanguage: noop, t }` would let a caller
 * silently render English to a Marathi farmer AND swallow a genuinely missing
 * provider. The caller must decide what "no provider" means for it, in the
 * open. `useLanguage` is unchanged and stays the right hook everywhere a
 * provider is guaranteed.
 */
export const useOptionalLanguage = (): LanguageContextType | undefined => {
    return useContext(LanguageContext);
};
