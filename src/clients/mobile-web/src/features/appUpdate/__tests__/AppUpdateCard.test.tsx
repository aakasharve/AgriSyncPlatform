// @vitest-environment jsdom
/**
 * Lane UPD-1 — the "new version" card on आजची कामे: shows / hides, "नंतर" until the next day, a newer
 * version re-shows, below the minimum it cannot be put off and the page stays usable, both languages.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRelease } from '../../../infrastructure/api/appReleaseApi';
import { logger } from '../../../infrastructure/observability/Logger';

const h = vi.hoisted(() => ({ goToUpdate: vi.fn() }));
vi.mock('../updateChannel', () => ({ goToUpdate: h.goToUpdate }));

import { AppUpdateCard } from '../AppUpdateCard';
import { __resetAppUpdateForTests, checkForAppUpdate } from '../appUpdateState';
import { WorkHome } from '../../logs/components/entry/WorkHome';

const rel = (latestVersion: string | null, minimumVersion: string | null = null): AppRelease =>
    ({ latestVersion, minimumVersion, playStoreUrl: null, apkUrl: 'https://shramsafal.in/apk' });

let clock = new Date(2026, 10, 1, 9, 0, 0);
const start = (fetchRelease: () => Promise<AppRelease>) => {
    __resetAppUpdateForTests({ installed: '1.0.17', fetchRelease, now: () => clock });
};
/** Mount, then let the start-up question land. */
const mount = async (node: React.ReactElement) => {
    const r = render(node);
    await act(async () => { await checkForAppUpdate(); });
    return r;
};
const DEVANAGARI = /[ऀ-ॿ]/;

beforeEach(() => { localStorage.clear(); clock = new Date(2026, 10, 1, 9, 0, 0); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); __resetAppUpdateForTests(); });

describe('the home card (UPD-1)', () => {
    it('draws nothing when nothing newer is announced', async () => {
        start(() => Promise.resolve(rel(null)));
        await mount(<AppUpdateCard language="mr" />);
        expect(screen.queryByTestId('app-update-card')).toBeNull();
        cleanup();
        start(() => Promise.resolve(rel('1.0.17')));
        await mount(<AppUpdateCard language="mr" />);
        expect(screen.queryByTestId('app-update-card')).toBeNull();
    });

    it('offline: nothing is shown and no error reaches the farmer', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        start(() => Promise.reject(new TypeError('Failed to fetch')));
        await mount(<AppUpdateCard language="mr" />);
        expect(screen.queryByTestId('app-update-card')).toBeNull();
        expect(document.body.textContent).toBe('');
    });

    it('Marathi: the title, the version line and the two buttons — Marathi only', async () => {
        start(() => Promise.resolve(rel('1.0.18')));
        await mount(<AppUpdateCard language="mr" />);
        const card = screen.getByTestId('app-update-card');
        expect(screen.getByTestId('app-update-title')).toHaveTextContent('नवीन आवृत्ती आली आहे');
        expect(screen.getByTestId('app-update-version')).toHaveTextContent('1.0.18');
        expect(screen.getByTestId('app-update-version')).toHaveTextContent('1.0.17');
        expect(screen.getByTestId('app-update-go')).toHaveTextContent('अपडेट करा');
        expect(screen.getByTestId('app-update-later')).toHaveTextContent('नंतर');
        expect(card.textContent ?? '').not.toMatch(/[A-Za-z]{2,}/);
    });

    it('English: English only', async () => {
        start(() => Promise.resolve(rel('1.0.18')));
        await mount(<AppUpdateCard language="en" />);
        const card = screen.getByTestId('app-update-card');
        expect(screen.getByTestId('app-update-title')).toHaveTextContent('A new version is available');
        expect(screen.getByTestId('app-update-go')).toHaveTextContent('Update');
        expect(screen.getByTestId('app-update-later')).toHaveTextContent('Later');
        expect(DEVANAGARI.test(card.textContent ?? '')).toBe(false);
    });

    it('"अपडेट करा" goes to the update place with the server answer', async () => {
        start(() => Promise.resolve(rel('1.0.18')));
        await mount(<AppUpdateCard language="mr" />);
        fireEvent.click(screen.getByTestId('app-update-go'));
        expect(h.goToUpdate).toHaveBeenCalledWith(rel('1.0.18'));
    });

    it('"नंतर" hides it until the next day', async () => {
        start(() => Promise.resolve(rel('1.0.18')));
        await mount(<AppUpdateCard language="mr" />);
        fireEvent.click(screen.getByTestId('app-update-later'));
        expect(screen.queryByTestId('app-update-card')).toBeNull();
        // the same day, the app comes back to the front: still hidden
        clock = new Date(2026, 10, 1, 20, 0, 0);
        await act(async () => { await checkForAppUpdate(); });
        expect(screen.queryByTestId('app-update-card')).toBeNull();
        // the next day: back
        clock = new Date(2026, 10, 2, 7, 0, 0);
        await act(async () => { await checkForAppUpdate(); });
        expect(screen.getByTestId('app-update-card')).toBeInTheDocument();
    });

    it('a version newer than the one he put off shows again at once', async () => {
        const answers = [rel('1.0.18'), rel('1.0.19')];
        start(() => Promise.resolve(answers.shift() ?? rel('1.0.19')));
        await mount(<AppUpdateCard language="mr" />);
        fireEvent.click(screen.getByTestId('app-update-later'));
        expect(screen.queryByTestId('app-update-card')).toBeNull();
        // a fresh app start later the same day (a new day's question would also do): 1.0.19 is out
        localStorage.removeItem('shramsafal_app_release_v1');
        __resetAppUpdateForTests({ installed: '1.0.17', fetchRelease: () => Promise.resolve(rel('1.0.19')), now: () => clock });
        cleanup();
        await mount(<AppUpdateCard language="mr" />);
        expect(screen.getByTestId('app-update-version')).toHaveTextContent('1.0.19');
    });

    it('below the minimum version: no "नंतर", one calm line — and the page around it still works', async () => {
        start(() => Promise.resolve(rel('1.0.19', '1.0.18')));
        const onTell = vi.fn();
        await mount(<WorkHome onTell={onTell} />);
        expect(screen.getByTestId('app-update-card')).toBeInTheDocument();
        expect(screen.queryByTestId('app-update-later')).toBeNull();
        expect(screen.getByTestId('app-update-must')).toHaveTextContent('लवकरच चालणं बंद होऊ शकते');
        // never blocks: the home's own door is there and works
        fireEvent.click(screen.getByTestId('home-tell'));
        expect(onTell).toHaveBeenCalledTimes(1);
    });

    it('on the home it sits above "काय करायचं आहे?"', async () => {
        start(() => Promise.resolve(rel('1.0.18')));
        await mount(<WorkHome onTell={vi.fn()} />);
        const card = screen.getByTestId('app-update-card');
        const title = screen.getByTestId('home-title');
        expect(card.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
