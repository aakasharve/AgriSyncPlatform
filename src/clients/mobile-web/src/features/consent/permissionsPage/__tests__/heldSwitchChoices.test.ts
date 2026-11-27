// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// After sign-in the page's two switches are written as he left them - and never over an earlier choice of his. Real Dexie
// (fake-indexeddb) and the real store; the server is a fake with the four calls.

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetHeldSwitchChoicesForTests,
    applyHeldSwitchChoices,
    playbackNeverChosen,
    type SwitchApi,
} from '../heldSwitchChoices';
import { readHeldSwitchChoices, saveHeldSwitchChoices } from '../../../../infrastructure/storage/HeldSwitchChoicesStore';
import { resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME, perUserDatabaseName } from '../../../../infrastructure/storage/userDatabaseName';
import type { ConsentStateDto, ImprovementPermissionDto } from '../../../../infrastructure/api/consentDtos';
import { IMPROVEMENT_WORDING_VERSION, VOICE_RETENTION_WORDING_VERSION } from '../../improvement/improvementPermissionCopy';

const FARMER = 'user-1';

const untouchedConsent = (): ConsentStateDto => ({
    fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
    version: 3, acceptedAtUtc: null, revokedAtUtc: null,
});
const neverChoseImprovement = (): ImprovementPermissionDto => ({
    allowed: false, wordingVersion: null, chosenAtUtc: null,
    currentWordingVersion: IMPROVEMENT_WORDING_VERSION, allowedUnderCurrentWording: false,
});

function fakeApi(consent = untouchedConsent(), improvement = neverChoseImprovement()) {
    const api = {
        getConsent: vi.fn(async () => consent),
        updateConsent: vi.fn(async () => ({ ...consent, fullHistoryJournal: true })),
        getImprovementPermission: vi.fn(async () => improvement),
        setImprovementPermission: vi.fn(async () => improvement),
    };
    return api as typeof api & SwitchApi;
}

async function wipe() {
    try { await resetDatabase(); } catch { /* nothing open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
    await Dexie.delete(perUserDatabaseName(FARMER));
    await resetDatabase();
}

beforeEach(async () => {
    __resetHeldSwitchChoicesForTests();
    await wipe();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME); // held on the number screen, before sign-in
});
afterEach(wipe);

async function holdOnNumberScreen(voicePlayback = true, improvement = true) {
    await saveHeldSwitchChoices({ voicePlayback, improvement, language: 'mr', preRegistrationSessionId: 'session-1' });
    setActiveDatabaseName(perUserDatabaseName(FARMER)); // ...then he signs in: his own database is active
    await resetDatabase();
}

describe('a new account: the page is his first choice', () => {
    it('writes both ON switches against the words in force, then forgets them', async () => {
        await holdOnNumberScreen(true, true);
        const api = fakeApi();
        const granted = vi.fn();
        await expect(applyHeldSwitchChoices(FARMER, api, granted)).resolves.toBe('applied');
        expect(api.setImprovementPermission).toHaveBeenCalledWith({ allowed: true, wordingVersion: IMPROVEMENT_WORDING_VERSION, languageShown: 'mr' });
        expect(api.updateConsent).toHaveBeenCalledWith(expect.objectContaining({
            fullHistoryJournal: true, languageShown: 'mr-IN', consentTextVersion: 3,
            fullHistoryJournalWordingVersion: VOICE_RETENTION_WORDING_VERSION,
        }));
        expect(granted).toHaveBeenCalledTimes(1);
        expect(await readHeldSwitchChoices()).toBeNull();
    });

    it('a switch he turned off: improvement is recorded OFF, playback is not turned on', async () => {
        await holdOnNumberScreen(false, false);
        const api = fakeApi();
        await expect(applyHeldSwitchChoices(FARMER, api)).resolves.toBe('applied');
        expect(api.setImprovementPermission).toHaveBeenCalledWith(expect.objectContaining({ allowed: false }));
        expect(api.updateConsent).not.toHaveBeenCalled();
    });
});

describe('an existing account: an earlier choice stays as it is', () => {
    it('improvement chosen before (even OFF) and playback touched before: nothing is written', async () => {
        await holdOnNumberScreen(true, true);
        const api = fakeApi(
            { ...untouchedConsent(), revokedAtUtc: '2026-11-01T00:00:00Z', fullHistoryJournalWordingVersion: 'voice-keep-2026-11-06.1' },
            { ...neverChoseImprovement(), chosenAtUtc: '2026-11-01T00:00:00Z' },
        );
        await expect(applyHeldSwitchChoices(FARMER, api)).resolves.toBe('applied');
        expect(api.setImprovementPermission).not.toHaveBeenCalled();
        expect(api.updateConsent).not.toHaveBeenCalled();
        expect(await readHeldSwitchChoices()).toBeNull();
    });

    it('playbackNeverChosen is false for any trace of a choice', () => {
        expect(playbackNeverChosen(untouchedConsent())).toBe(true);
        expect(playbackNeverChosen({ ...untouchedConsent(), fullHistoryJournal: true })).toBe(false);
        expect(playbackNeverChosen({ ...untouchedConsent(), acceptedAtUtc: '2026-10-01T00:00:00Z' })).toBe(false);
        expect(playbackNeverChosen({ ...untouchedConsent(), revokedAtUtc: '2026-10-01T00:00:00Z' })).toBe(false);
        expect(playbackNeverChosen({ ...untouchedConsent(), fullHistoryJournalWordingVersion: 'voice-keep-2026-10-30.1' })).toBe(false);
    });
});

describe('never the wrong person, never lost, never thrown', () => {
    it('bound to the first account that signed in: another account gets nothing written', async () => {
        await holdOnNumberScreen(true, true);
        const failing = fakeApi();
        failing.getImprovementPermission.mockRejectedValueOnce(new Error('offline'));
        await expect(applyHeldSwitchChoices(FARMER, failing)).resolves.toBe('deferred'); // claimed by FARMER
        const other = fakeApi();
        await expect(applyHeldSwitchChoices('someone-else', other)).resolves.toBe('other-account');
        expect(other.setImprovementPermission).not.toHaveBeenCalled();
        expect(other.updateConsent).not.toHaveBeenCalled();
    });

    it('a failed write keeps the choices for the next start; the retry writes them once', async () => {
        await holdOnNumberScreen(true, true);
        const api = fakeApi();
        api.updateConsent.mockRejectedValueOnce(new Error('500'));
        await expect(applyHeldSwitchChoices(FARMER, api)).resolves.toBe('deferred');
        expect(await readHeldSwitchChoices()).not.toBeNull();
        await expect(applyHeldSwitchChoices(FARMER, api)).resolves.toBe('applied');
        expect(api.updateConsent).toHaveBeenCalledTimes(2);
    });

    it('nothing held, or no account: nothing is asked of the server', async () => {
        const api = fakeApi();
        await expect(applyHeldSwitchChoices(FARMER, api)).resolves.toBe('nothing-pending');
        await expect(applyHeldSwitchChoices(null, api)).resolves.toBe('no-account');
        expect(api.getConsent).not.toHaveBeenCalled();
        expect(api.getImprovementPermission).not.toHaveBeenCalled();
    });
});
