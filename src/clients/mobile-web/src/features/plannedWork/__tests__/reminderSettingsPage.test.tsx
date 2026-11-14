// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 Task 5; founder D-78, D-84 = 1, D-24e1, D-26; R17, R21) - "आठवणी कोणाला दिसतील":
 *   - it loads the owner's settings and draws the three categories with their choices;
 *   - a tap sends ONE change and the screen adopts the SERVER's answer (never what it asked for);
 *   - the assigned-work line is drawn locked (no button), and the exception for a record hidden or kept for chosen people is said on the screen;
 *   - "यांच्या आठवणी नेहमी दिसतील": add and remove a person;
 *   - "हे कोण बदलू शकतं": only the primary owner sees the switches, through the team roster;
 *   - offline it says so and changes nothing: no call is made (R21); a refusal and a failure are said honestly;
 *   - Marathi mode shows only Marathi, English mode only English.
 * The client is faked at its own seam; the client itself (online-only, no queue) has its own cases below, through the real axios seam.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
    language: 'mr' as 'mr' | 'en',
    http: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { http: h.http } }));

import { ReminderSettingsPage } from '../reminders/ReminderSettingsPage';
import { alwaysShowPath, readSettings, reminderSettingsPath } from '../reminders/reminderSettingsClient';
import { plannedWorkWords } from '../plannedWorkWords';
import type { UseLabourPermissionsResult } from '../../profile/hooks/useLabourPermissions';

const FARM = '55555555-5555-4555-8555-555555555551';
const OWNER = '11111111-1111-4111-8111-111111111111';
const RAJU = '22222222-2222-4222-8222-222222222222';
const SANTOSH = '33333333-3333-4333-8333-333333333333';

const body = (over: Record<string, unknown> = {}) => ({
    farmId: FARM,
    logRemindersAudience: 'MakerAndOwner', ownRemindersAudience: 'MakerAndOwner', scheduleRemindersAudience: 'PlotTeam',
    updatedByUserId: null, updatedAtUtc: null,
    alwaysShow: [],
    members: [
        { userId: OWNER, displayName: 'अशोक', role: 'PrimaryOwner' },
        { userId: RAJU, displayName: 'राजू', role: 'Mukadam' },
        { userId: SANTOSH, displayName: 'संतोष', role: 'Worker' },
    ],
    ...over,
});

const roster = (over: Partial<UseLabourPermissionsResult> = {}): UseLabourPermissionsResult => ({
    rows: [
        { userId: RAJU, role: 'Mukadam', status: 'Active', canEditAuthorities: true, authorities: [{ name: 'PlanWork', expiresAtUtc: null }] },
        { userId: SANTOSH, role: 'Mukadam', status: 'Active', canEditAuthorities: true, authorities: [{ name: 'ManageReminders', expiresAtUtc: null }] },
    ],
    loading: false, loadFailed: false, savingUserId: null, error: null, reload: vi.fn(), setPermission: vi.fn(), dismissError: vi.fn(),
    setAuthorities: vi.fn(async () => {}), adoptRow: vi.fn(),
    ...over,
} as unknown as UseLabourPermissionsResult);

const online = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });

beforeEach(() => {
    h.language = 'mr';
    online(true);
    h.http.get.mockReset().mockResolvedValue({ data: body() });
    h.http.put.mockReset();
    h.http.delete.mockReset();
});
afterEach(cleanup);

const draw = (over: Partial<React.ComponentProps<typeof ReminderSettingsPage>> = {}) =>
    render(<ReminderSettingsPage farmId={FARM} callerUserId={OWNER} isPrimaryOwner roster={roster()} {...over} />);

describe('the screen', () => {
    it('loads the settings from the server and draws the three kinds of reminder with their choices', async () => {
        draw();
        expect(await screen.findByTestId('reminder-settings')).toBeInTheDocument();
        expect(h.http.get).toHaveBeenCalledWith(reminderSettingsPath(FARM));
        const logs = screen.getByTestId('reminder-cat-logRemindersAudience');
        expect(within(logs).getByTestId('reminder-choice-logRemindersAudience-MakerAndOwner')).toHaveAttribute('aria-pressed', 'true');
        expect(within(logs).getByTestId('reminder-choice-logRemindersAudience-MakerAndOwner')).toHaveTextContent('बनवणारा आणि मालक');
        expect(within(logs).getByTestId('reminder-choice-logRemindersAudience-PlotTeam')).toHaveTextContent('प्लॉटवरचे सगळे');
        expect(within(screen.getByTestId('reminder-cat-scheduleRemindersAudience')).getByTestId('reminder-choice-scheduleRemindersAudience-Planners')).toHaveTextContent('नियोजन करणारे');
        // The schedule's step does not offer the maker-and-owner choice; the log and own reminders do not offer the planners.
        expect(screen.queryByTestId('reminder-choice-scheduleRemindersAudience-MakerAndOwner')).toBeNull();
        expect(screen.queryByTestId('reminder-choice-logRemindersAudience-Planners')).toBeNull();
        expect(screen.queryByTestId('reminder-choice-ownRemindersAudience-Planners')).toBeNull();
    });

    it('one tap on नोंदीतून -> प्लॉटवरचे सगळे sends one change and shows what the SERVER answered', async () => {
        h.http.put.mockResolvedValue({ data: body({ logRemindersAudience: 'PlotTeam', updatedByUserId: OWNER, updatedAtUtc: '2026-11-08T06:00:00Z' }) });
        draw();
        fireEvent.click(await screen.findByTestId('reminder-choice-logRemindersAudience-PlotTeam'));
        await waitFor(() => expect(screen.getByTestId('reminder-choice-logRemindersAudience-PlotTeam')).toHaveAttribute('aria-pressed', 'true'));
        expect(h.http.put).toHaveBeenCalledTimes(1);
        expect(h.http.put).toHaveBeenCalledWith(reminderSettingsPath(FARM), { logRemindersAudience: 'PlotTeam' });
        expect(screen.getByTestId('reminder-settings-saved')).toHaveTextContent('ठेवलं');

        // What the server answered is what shows: here it kept the old word, so the screen does too.
        h.http.put.mockResolvedValue({ data: body({ logRemindersAudience: 'MakerAndOwner' }) });
        fireEvent.click(screen.getByTestId('reminder-choice-ownRemindersAudience-PlotTeam'));
        await waitFor(() => expect(h.http.put).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByTestId('reminder-choice-logRemindersAudience-MakerAndOwner')).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByTestId('reminder-choice-ownRemindersAudience-PlotTeam')).toHaveAttribute('aria-pressed', 'false');
    });

    it('the choice already made sends nothing', async () => {
        draw();
        fireEvent.click(await screen.findByTestId('reminder-choice-logRemindersAudience-MakerAndOwner'));
        expect(h.http.put).not.toHaveBeenCalled();
    });

    it('draws the assigned-work line as a locked ShramSafal rule (no button) and says the exception for hidden records on the screen (D-84 = 1)', async () => {
        draw();
        const locked = await screen.findByTestId('reminder-assigned-locked');
        expect(locked.tagName).toBe('P');
        expect(within(locked).queryByRole('button')).toBeNull();
        expect(locked).toHaveTextContent('श्रमसफलचा');
        expect(screen.getByTestId('reminder-always-exception')).toHaveTextContent('लपवलेल्या (फक्त मी) किंवा निवडक लोकांसाठी ठेवलेल्या नोंदीतून आलेली आठवण मात्र त्या नोंदीच्या लोकांपुरतीच राहते.');
        expect(screen.getByText('यांच्या आठवणी नेहमी दिसतील')).toBeInTheDocument();
    });
});

describe('"यांच्या आठवणी नेहमी दिसतील"', () => {
    it('lists who is marked with his own name, removes one, and adds one from the farm\'s active members', async () => {
        h.http.get.mockResolvedValue({ data: body({ alwaysShow: [{ userId: RAJU, displayName: 'राजू', addedAtUtc: '2026-11-08T05:00:00Z' }] }) });
        h.http.delete.mockResolvedValue({ data: body() });
        draw();
        const row = await screen.findByTestId(`reminder-always-${RAJU}`);
        expect(row).toHaveTextContent('राजू');
        fireEvent.click(screen.getByTestId(`reminder-always-remove-${RAJU}`));
        await waitFor(() => expect(h.http.delete).toHaveBeenCalledWith(alwaysShowPath(FARM, RAJU)));
        await waitFor(() => expect(screen.queryByTestId(`reminder-always-${RAJU}`)).toBeNull());
        expect(screen.getByTestId('reminder-always-none')).toBeInTheDocument();

        h.http.put.mockResolvedValue({ data: body({ alwaysShow: [{ userId: SANTOSH, displayName: 'संतोष', addedAtUtc: '2026-11-08T05:10:00Z' }] }) });
        fireEvent.click(screen.getByTestId('reminder-always-add'));
        expect(screen.getByTestId('reminder-always-candidates')).toHaveTextContent('राजू');
        fireEvent.click(screen.getByTestId(`reminder-always-pick-${SANTOSH}`));
        await waitFor(() => expect(h.http.put).toHaveBeenCalledWith(alwaysShowPath(FARM, SANTOSH)));
        expect(await screen.findByTestId(`reminder-always-${SANTOSH}`)).toHaveTextContent('संतोष');
    });

    it('a person with no name shows his seat\'s word, never an invented name', async () => {
        h.http.get.mockResolvedValue({ data: body({ alwaysShow: [{ userId: RAJU, displayName: null, addedAtUtc: '' }], members: [{ userId: RAJU, displayName: null, role: 'Mukadam' }] }) });
        draw();
        expect(await screen.findByTestId(`reminder-always-${RAJU}`)).toHaveTextContent(plannedWorkWords('mr').role.Mukadam);
    });
});

describe('"हे कोण बदलू शकतं" (R17; D-26: only the primary owner gives it)', () => {
    it('the owner sees a switch per let-in person, through the team roster, and a tap sends the WHOLE desired set', async () => {
        const r = roster();
        draw({ roster: r });
        const raju = await screen.findByTestId(`reminder-grant-${RAJU}`);
        expect(raju).toHaveAttribute('data-on', 'no');
        expect(screen.getByTestId(`reminder-grant-${SANTOSH}`)).toHaveAttribute('data-on', 'yes');
        expect(raju).toHaveTextContent('आठवणींची मांडणी बदलणे');
        fireEvent.click(raju);
        expect(r.setAuthorities).toHaveBeenCalledWith(RAJU, [{ name: 'PlanWork', expiresAtUtc: null }, { name: 'ManageReminders', expiresAtUtc: null }]);
        fireEvent.click(screen.getByTestId(`reminder-grant-${SANTOSH}`));
        expect(r.setAuthorities).toHaveBeenLastCalledWith(SANTOSH, []);
        expect(screen.queryByTestId(`reminder-grant-${OWNER}`)).toBeNull();
    });

    it('a holder who is not the primary owner sees no switch, only that this is the owner\'s', async () => {
        draw({ isPrimaryOwner: false, roster: null, callerUserId: RAJU });
        expect(await screen.findByTestId('reminder-who-owner-only')).toBeInTheDocument();
        expect(screen.queryByTestId(`reminder-grant-${SANTOSH}`)).toBeNull();
    });
});

describe('online only (R21)', () => {
    it('offline it says so, makes no call at all and keeps nothing', async () => {
        online(false);
        draw();
        expect(await screen.findByTestId('reminder-settings-offline')).toHaveTextContent('ही मांडणी बदलण्यासाठी नेट लागतं');
        expect(h.http.get).not.toHaveBeenCalled();
        expect(h.http.put).not.toHaveBeenCalled();
        expect(screen.queryByTestId('reminder-settings')).toBeNull();
    });

    it('losing the net after it opened: a tap changes nothing, says so, and sends nothing', async () => {
        draw();
        const choice = await screen.findByTestId('reminder-choice-logRemindersAudience-PlotTeam');
        online(false);
        fireEvent.click(choice);
        expect(await screen.findByTestId('reminder-settings-offline')).toHaveTextContent('काहीही बदललेलं नाही');
        expect(h.http.put).not.toHaveBeenCalled();
        expect(screen.getByTestId('reminder-choice-logRemindersAudience-MakerAndOwner')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a failed change says nothing changed and the choice stays as it was', async () => {
        h.http.put.mockRejectedValue({ response: { status: 500 } });
        draw();
        fireEvent.click(await screen.findByTestId('reminder-choice-logRemindersAudience-PlotTeam'));
        expect(await screen.findByTestId('reminder-settings-failed')).toHaveTextContent('काहीही बदललेलं नाही');
        expect(screen.getByTestId('reminder-choice-logRemindersAudience-MakerAndOwner')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a refusal on open (403) says whose it is, and offers no choice', async () => {
        h.http.get.mockRejectedValue({ response: { status: 403 } });
        draw();
        expect(await screen.findByTestId('reminder-settings-forbidden')).toHaveTextContent('फक्त मालक');
        expect(screen.queryByTestId('reminder-choice-logRemindersAudience-PlotTeam')).toBeNull();
    });

    it('a failed read offers a retry', async () => {
        h.http.get.mockRejectedValueOnce({ response: { status: 500 } });
        draw();
        fireEvent.click(await screen.findByTestId('reminder-settings-retry'));
        expect(await screen.findByTestId('reminder-settings')).toBeInTheDocument();
    });
});

describe('the client reads the server\'s body honestly', () => {
    it('a word it does not know falls back to the D-79 base; a missing list is empty', () => {
        const view = readSettings({ farmId: FARM, logRemindersAudience: 'Everyone', scheduleRemindersAudience: 'Planners' })!;
        expect(view.logRemindersAudience).toBe('MakerAndOwner');
        expect(view.ownRemindersAudience).toBe('MakerAndOwner');
        expect(view.scheduleRemindersAudience).toBe('Planners');
        expect(view.alwaysShow).toEqual([]);
        expect(view.members).toEqual([]);
        expect(readSettings(null)).toBeNull();
        expect(readSettings({ nothing: 1 })).toBeNull();
    });
});

describe('one language at a time', () => {
    it('English mode: every word of the screen is English', async () => {
        h.language = 'en';
        h.http.get.mockResolvedValue({ data: body({ alwaysShow: [{ userId: RAJU, displayName: null, addedAtUtc: '' }] }) });
        draw();
        const page = await screen.findByTestId('reminder-settings');
        const text = page.textContent ?? '';
        // Names are the farm's own words (राजू, अशोक); every word of the screen is English.
        const withoutNames = text.replace(/[ऀ-ॿ]+/g, '');
        expect(withoutNames).toMatch(/Everyone on the plot/);
        expect(text).toContain("These people's reminders always show");
        expect(text).toContain('Who can change this');
        const own = within(page).getByTestId('reminder-assigned-locked').textContent ?? '';
        expect(own).not.toMatch(/[ऀ-ॿ]/);
    });

    it('the word tables: Marathi only has no Latin letter, English only has no Devanagari', () => {
        // A plot's name is the farmer's own word, never ours: the sample is a digit in the screen's own script.
        const strings = (node: unknown, sample: string, out: string[] = []): string[] => {
            if (typeof node === 'string') out.push(node);
            else if (typeof node === 'function') strings((node as (...a: unknown[]) => unknown)(sample), sample, out);
            else if (node && typeof node === 'object') Object.values(node).forEach(n => strings(n, sample, out));
            return out;
        };
        const mr = strings(plannedWorkWords('mr').reminders, '१');
        const en = strings(plannedWorkWords('en').reminders, '1');
        for (const s of mr) expect(s, s).not.toMatch(/[A-Za-z]/);
        for (const s of en) expect(s, s).not.toMatch(/[ऀ-ॿ]/);
        for (const s of [...mr, ...en]) {
            expect(s, s).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
            expect(s, s).not.toMatch(/\bA\.?I\.?\b|artificial|कृत्रिम|एआय/i);
        }
    });
});
