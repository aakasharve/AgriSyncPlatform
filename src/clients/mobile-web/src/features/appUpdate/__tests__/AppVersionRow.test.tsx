// @vitest-environment jsdom
/**
 * Lane UPD-1 — सेट-अप केंद्र → अ‍ॅप: the installed version always; a tappable "नवीन … उपलब्ध — अपडेट करा"
 * only when a newer one exists (no dead button otherwise, P5); both languages.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRelease } from '../../../infrastructure/api/appReleaseApi';

const h = vi.hoisted(() => ({ goToUpdate: vi.fn() }));
vi.mock('../updateChannel', () => ({ goToUpdate: h.goToUpdate }));

import { AppVersionRow } from '../AppVersionRow';
import { __resetAppUpdateForTests, checkForAppUpdate } from '../appUpdateState';

const rel = (latestVersion: string | null): AppRelease =>
    ({ latestVersion, minimumVersion: null, playStoreUrl: null, apkUrl: null });
const start = (answer: AppRelease) =>
    __resetAppUpdateForTests({ installed: '1.0.18', fetchRelease: () => Promise.resolve(answer), now: () => new Date(2026, 10, 1, 9) });
const mount = async (language: 'mr' | 'en') => {
    render(<AppVersionRow language={language} />);
    await act(async () => { await checkForAppUpdate(); });
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); __resetAppUpdateForTests(); });

describe('the version row in सेट-अप केंद्र (UPD-1)', () => {
    it('always shows the installed version; with nothing newer it is a plain line, not a button', async () => {
        start(rel(null));
        await mount('mr');
        const row = screen.getByTestId('hub-app-version');
        expect(row).toHaveTextContent('ॲपची आवृत्ती 1.0.18');
        expect(row.tagName).not.toBe('BUTTON');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('with a newer version: "नवीन 1.0.19 उपलब्ध — अपडेट करा", and a tap goes to the update place', async () => {
        start(rel('1.0.19'));
        await mount('mr');
        const row = screen.getByTestId('hub-app-version');
        expect(row.tagName).toBe('BUTTON');
        expect(row).toHaveTextContent('ॲपची आवृत्ती 1.0.18');
        expect(row).toHaveTextContent('नवीन 1.0.19 उपलब्ध — अपडेट करा');
        expect(row.textContent ?? '').not.toMatch(/[A-Za-z]{2,}/);
        fireEvent.click(row);
        expect(h.goToUpdate).toHaveBeenCalledWith(rel('1.0.19'));
    });

    it('English: English only', async () => {
        start(rel('1.0.19'));
        await mount('en');
        const row = screen.getByTestId('hub-app-version');
        expect(row).toHaveTextContent('App version 1.0.18');
        expect(row).toHaveTextContent('New 1.0.19 available — update');
        expect(/[ऀ-ॿ]/.test(row.textContent ?? '')).toBe(false);
    });
});
