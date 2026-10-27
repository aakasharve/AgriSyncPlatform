// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-1). The language chosen on स्वागत,
 * BEFORE login, must still be the language AFTER sign-in.
 *
 * Why it used to be lost (verified in the code, not assumed): the choice was stored only in Dexie
 * `uiPrefs`. Before login the open database is the pre-login one (`AgriLogDB_unidentified`); signing
 * in opens the farmer's own database (`activateDatabaseForUser`) and `DataSourceProvider` remounts the
 * whole tree, so `LanguageProvider` re-read `agrilog_language` from a database that never had it →
 * Marathi. And `LanguageSyncFromServer` then set the server's value, which the app never writes
 * (always 'mr' for a new account).
 *
 * The stub below is a faithful small model of that: one `uiPrefs` map PER DATABASE, and the provider
 * is unmounted and mounted again when the database switches, exactly as on sign-in.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
    dbs: {} as Record<string, Record<string, unknown>>,
    activeDb: 'AgriLogDB_unidentified',
    serverPref: undefined as string | undefined,
}));

vi.mock('../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const db = h.activeDb;
            const [v, setV] = R.useState<T>(() => (key in (h.dbs[db] ?? {}) ? (h.dbs[db][key] as T) : fallback));
            const set = (next: T) => {
                h.dbs[db] = { ...(h.dbs[db] ?? {}), [key]: next };
                setV(next);
            };
            return [v, set, true] as const;
        },
    };
});
vi.mock('../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ meContext: h.serverPref ? { me: { preferredLanguage: h.serverPref } } : null }),
}));

import { LanguageProvider, useLanguage } from '../LanguageContext';

const Probe: React.FC = () => {
    const { language, setLanguage } = useLanguage();
    return (
        <div>
            <span data-testid="lang">{language}</span>
            <button type="button" onClick={() => setLanguage('en')}>choose-en</button>
        </div>
    );
};

/** Sign in: the farmer's database opens and the provider tree mounts again. */
function signIn(serverPref: string) {
    cleanup();
    h.activeDb = 'AgriLogDB_u_farmer1';
    h.serverPref = serverPref;
    render(<LanguageProvider><Probe /></LanguageProvider>);
}

beforeEach(() => {
    window.localStorage.clear();
    h.dbs = {};
    h.activeDb = 'AgriLogDB_unidentified';
    h.serverPref = undefined;
});
afterEach(cleanup);

describe('the language chosen before login survives sign-in', () => {
    it('English chosen on स्वागत is still English after sign-in, even though the server says Marathi', async () => {
        render(<LanguageProvider><Probe /></LanguageProvider>);
        expect(screen.getByTestId('lang')).toHaveTextContent('mr');
        fireEvent.click(screen.getByText('choose-en'));
        expect(screen.getByTestId('lang')).toHaveTextContent('en');

        // The choice landed in the PRE-LOGIN database only — the farmer's database has no row.
        expect(h.dbs.AgriLogDB_unidentified.agrilog_language).toBe('en');

        await act(async () => { signIn('mr'); });
        expect(h.dbs.AgriLogDB_u_farmer1?.agrilog_language).toBeUndefined();
        expect(screen.getByTestId('lang')).toHaveTextContent('en');
    });

    it('the carrier is the phone-level choice: without it the same sign-in falls back to Marathi (the old defect)', async () => {
        render(<LanguageProvider><Probe /></LanguageProvider>);
        fireEvent.click(screen.getByText('choose-en'));
        window.localStorage.clear(); // as if only the per-database row existed (before this change)
        await act(async () => { signIn('mr'); });
        expect(screen.getByTestId('lang')).toHaveTextContent('mr');
    });

    it('with no choice made on this phone, the server preference still applies (unchanged behaviour)', async () => {
        await act(async () => { signIn('en'); });
        expect(screen.getByTestId('lang')).toHaveTextContent('en');
        // …and it is NOT recorded as the phone's choice.
        expect(window.localStorage.getItem('shramsafal_device_language_v1')).toBeNull();
    });

    it('with no choice and a Marathi server, the app is Marathi', async () => {
        await act(async () => { signIn('mr'); });
        expect(screen.getByTestId('lang')).toHaveTextContent('mr');
    });

    it('the choice belongs to the PHONE (founder decision to confirm): a second account on this phone opens in it, and its server preference is not applied', async () => {
        // Person A chooses English on this phone, signs in, signs out.
        render(<LanguageProvider><Probe /></LanguageProvider>);
        fireEvent.click(screen.getByText('choose-en'));
        await act(async () => { signIn('en'); });
        // Person B signs in on the same phone: a database of his own, his server says Marathi.
        await act(async () => {
            cleanup();
            h.activeDb = 'AgriLogDB_u_farmer2';
            h.serverPref = 'mr';
            render(<LanguageProvider><Probe /></LanguageProvider>);
        });
        expect(h.dbs.AgriLogDB_u_farmer2?.agrilog_language).toBeUndefined();
        expect(screen.getByTestId('lang')).toHaveTextContent('en');
    });
});
