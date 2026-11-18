// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148 layout C) - the owner bar, a library row and a map card show
 * the picture this phone holds for a schedule (round for a person, square for a schedule's picture or an institution's logo), and fall back to the
 * letter or leaf badge when there is no picture, when it is not the file the pull named, or when the screen cannot draw it. The object URL is revoked
 * when the file changes and when the screen goes away.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { ScheduleOwnerBar } from '../../schedulePage/ScheduleOwnerBar';
import { ScheduleMakerBadge } from '../ScheduleMakerBadge';
import ScheduleLibraryView from '../../components/ScheduleLibraryView';
import type { CropScheduleTemplate, SchedulePictureKind } from '../../scheduler.types';
import type { CropProfile } from '../../../../types';

const ID = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const SHA = 'a'.repeat(64);
const OTHER_SHA = 'd'.repeat(64);

const template = (extra: Partial<CropScheduleTemplate> = {}): CropScheduleTemplate => ({
    id: 'tpl-1', name: 'Grapes - University Schedule', cropCode: 'GRAPES', ownerType: 'USER', createdBy: 'अशोक पाटील', stages: [], periodicExpectations: [], oneTimeExpectations: [],
    pictureId: ID, pictureSha256: SHA, pictureKind: 'PERSON',
    ...extra,
}) as unknown as CropScheduleTemplate;

let counter = 0;
const created: string[] = [];
const revoked: string[] = [];
const store = async (kind: SchedulePictureKind = 'PERSON', sha = SHA) => {
    // A blob made by the platform of the storage layer (fake-indexeddb clones it as the real store would).
    const { Blob: StoredBlob } = await import('node:buffer');
    await getDatabase().schedulePictures.put({
        pictureId: ID, sha256: sha, kind, fetchedAt: '2026-11-18T10:00:00.000Z',
        blob: new StoredBlob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }) as unknown as Blob,
    });
};
const badge = () => screen.getByTestId('sched-badge');

beforeEach(() => {
    counter = 0; created.length = 0; revoked.length = 0;
    URL.createObjectURL = vi.fn(() => { const url = `blob:picture-${++counter}`; created.push(url); return url; });
    URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
});
afterEach(async () => {
    cleanup();
    await getDatabase().schedulePictures.clear();
});

describe('the owner bar shows the picture the phone holds', () => {
    it('a stored PERSON picture fills the place, round, with the maker\'s name unchanged', async () => {
        await store('PERSON');
        render(<ScheduleOwnerBar template={template()} />);
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        expect(badge()).toHaveAttribute('data-shape', 'round');
        expect(badge().querySelector('img')).toHaveAttribute('src', 'blob:picture-1');
        expect(screen.getByTestId('sched-owner-name')).toHaveTextContent('अशोक पाटील');
    });

    it('a schedule\'s own picture and an institution\'s logo are SQUARE', async () => {
        await store('SCHEDULE');
        render(<ScheduleOwnerBar template={template({ pictureKind: 'SCHEDULE' })} />);
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        expect(badge()).toHaveAttribute('data-shape', 'square');
        cleanup();
        await store('INSTITUTION');
        render(<ScheduleOwnerBar template={template({ ownerType: 'INSTITUTION', createdBy: 'Test University', pictureKind: 'INSTITUTION' })} />);
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        expect(badge()).toHaveAttribute('data-shape', 'square');
    });

    it('falls back to the LETTER (or the leaf with no name) when the picture is not held yet, and never asks for an object URL', async () => {
        render(<ScheduleOwnerBar template={template()} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(badge()).toHaveAttribute('data-kind', 'letter');
        expect(badge().textContent).toBe('अ');
        expect(created).toHaveLength(0);
        cleanup();
        render(<ScheduleOwnerBar template={template({ createdBy: '' })} />);
        expect(badge()).toHaveAttribute('data-kind', 'leaf');
    });

    it('falls back when the file held is not the one the pull named (a replaced picture never shows the old face)', async () => {
        await store('PERSON', OTHER_SHA);
        render(<ScheduleOwnerBar template={template()} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(badge()).toHaveAttribute('data-kind', 'letter');
        expect(created).toHaveLength(0);
    });

    it('a schedule the server names no picture for keeps its badge and never touches the store', async () => {
        await store('PERSON');
        render(<ScheduleOwnerBar template={template({ pictureId: undefined, pictureSha256: undefined, pictureKind: undefined })} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(badge()).toHaveAttribute('data-kind', 'letter');
        expect(created).toHaveLength(0);
    });

    it('the picture appears when the downloader stores it (no reload), and a refreshed file revokes the old object URL', async () => {
        render(<ScheduleOwnerBar template={template()} />);
        expect(badge()).toHaveAttribute('data-kind', 'letter');
        await store('PERSON');
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        expect(created).toEqual(['blob:picture-1']);
        await store('PERSON'); // the same row written again: a fresh object URL, the old one released
        await waitFor(() => expect(revoked).toContain('blob:picture-1'));
        await waitFor(() => expect(badge().querySelector('img')).toHaveAttribute('src', 'blob:picture-2'));
    });

    it('revokes the object URL when the screen goes away', async () => {
        await store('PERSON');
        const view = render(<ScheduleOwnerBar template={template()} />);
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        view.unmount();
        expect(revoked).toEqual(['blob:picture-1']);
    });

    it('a picture the screen cannot draw drops back to the letter, not a broken image', async () => {
        await store('PERSON');
        render(<ScheduleOwnerBar template={template()} />);
        await waitFor(() => expect(badge()).toHaveAttribute('data-kind', 'image'));
        fireEvent.error(badge().querySelector('img') as HTMLImageElement);
        expect(badge()).toHaveAttribute('data-kind', 'letter');
        expect(badge().querySelector('img')).toBeNull();
    });

    it('a picture the caller passes wins over the stored one', () => {
        render(<ScheduleOwnerBar template={template({ pictureId: undefined, pictureSha256: undefined, pictureKind: undefined })} imageUrl="blob:given" />);
        expect(badge().querySelector('img')).toHaveAttribute('src', 'blob:given');
    });
});

describe('a library row and a map card wear the same picture', () => {
    const grapes: CropProfile = {
        id: 'c_11111111-1111-4111-8111-111111111111', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500',
        plots: [], activeScheduleId: null, supportedTasks: [], workflow: [],
    } as unknown as CropProfile;
    const stages = [{ name: 'Post Pruning', startDay: 0, endDay: 12 }, { name: 'Canopy Build', startDay: 13, endDay: 40 }];

    it('a library row shows the stored picture of its schedule, and the letter on a row that has none', async () => {
        setScheduleTemplatesFromReferenceData([
            { id: '9a0b1c2d-0000-4000-8000-000000000001', name: 'Grapes - University Schedule', cropType: 'grape', totalDays: 41, stages, activities: [], versionHash: 'h',
              ownerType: 'INSTITUTION', sourceLabel: 'Test University', check: { state: 'Checked', checkerDisplayName: 'x', checkedAtUtc: '2026-11-08T05:00:00Z' },
              pictureId: ID, pictureSha256: SHA, pictureKind: 'INSTITUTION' },
            { id: '9a0b1c2d-0000-4000-8000-000000000003', name: 'Grapes - Other Checked Row', cropType: 'grape', totalDays: 60, stages, activities: [], versionHash: 'h',
              ownerType: 'INSTITUTION', sourceLabel: 'Other Body', check: { state: 'Checked', checkerDisplayName: 'x', checkedAtUtc: '2026-11-08T05:00:00Z' } },
        ]);
        await store('INSTITUTION');
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        const withPicture = screen.getByTestId('library-badge-9a0b1c2d-0000-4000-8000-000000000001');
        await waitFor(() => expect(withPicture).toHaveAttribute('data-kind', 'image'));
        expect(withPicture).toHaveAttribute('data-shape', 'square');
        expect(screen.getByTestId('library-badge-9a0b1c2d-0000-4000-8000-000000000003')).not.toHaveAttribute('data-kind', 'image');
        setScheduleTemplatesFromReferenceData([]);
    });

    it('the maker badge (map cards) takes the stored picture the same way', async () => {
        await store('SCHEDULE');
        render(<ScheduleMakerBadge template={template({ pictureKind: 'SCHEDULE' })} size={34} tone="light" testId="map-badge-x" />);
        const el = screen.getByTestId('map-badge-x');
        await waitFor(() => expect(el).toHaveAttribute('data-kind', 'image'));
        expect(el).toHaveAttribute('data-shape', 'square');
    });
});
