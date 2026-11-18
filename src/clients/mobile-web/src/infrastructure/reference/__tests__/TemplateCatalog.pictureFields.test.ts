/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the three optional picture fields the server appends
 * to each pulled schedule (`pictureId`, `pictureSha256`, `pictureKind`) are read when all three are well formed, and left out otherwise: an old
 * server sends none, a half set is never kept, and nothing unreadable becomes part of a request address.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getAllTemplates, readPictureFields, setScheduleTemplatesFromReferenceData } from '../TemplateCatalog';

const ID = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const SHA = 'a'.repeat(64);

const row = (extra: Record<string, unknown> = {}) => ({
    id: 'tpl-1', name: 'द्राक्ष', cropType: 'grape', totalDays: 120,
    stages: [{ name: 'Establishment', startDay: 0, endDay: 30 }],
    activities: [],
    ...extra,
});

const first = () => getAllTemplates().find(t => t.id === 'tpl-1')!;

afterEach(() => setScheduleTemplatesFromReferenceData([]));

describe('the pulled schedule\'s picture fields', () => {
    it('are read, and typed, when the server sends all three', () => {
        setScheduleTemplatesFromReferenceData([row({ pictureId: ID, pictureSha256: SHA, pictureKind: 'PERSON' })]);
        expect(first().pictureId).toBe(ID);
        expect(first().pictureSha256).toBe(SHA);
        expect(first().pictureKind).toBe('PERSON');
    });

    it('are absent (not null, not empty) when an old server sends none: the page draws its letter or leaf badge', () => {
        setScheduleTemplatesFromReferenceData([row()]);
        expect(first()).not.toHaveProperty('pictureId');
        expect(first()).not.toHaveProperty('pictureSha256');
        expect(first()).not.toHaveProperty('pictureKind');
    });

    it('are absent when the server sends them as null (a schedule with no picture)', () => {
        setScheduleTemplatesFromReferenceData([row({ pictureId: null, pictureSha256: null, pictureKind: null })]);
        expect(first()).not.toHaveProperty('pictureId');
        expect(first()).not.toHaveProperty('pictureKind');
    });

    it('are all left out when one is missing or unreadable (never a half picture)', () => {
        for (const bad of [
            { pictureId: ID, pictureSha256: SHA },
            { pictureId: ID, pictureKind: 'PERSON' },
            { pictureSha256: SHA, pictureKind: 'PERSON' },
            { pictureId: 'not-a-guid', pictureSha256: SHA, pictureKind: 'PERSON' },
            { pictureId: `${ID}/../../admin`, pictureSha256: SHA, pictureKind: 'PERSON' },
            { pictureId: ID, pictureSha256: 'abc', pictureKind: 'PERSON' },
            { pictureId: ID, pictureSha256: SHA, pictureKind: 'AVATAR' },
            { pictureId: 7, pictureSha256: SHA, pictureKind: 'PERSON' },
        ]) {
            setScheduleTemplatesFromReferenceData([row(bad)]);
            expect(first(), JSON.stringify(bad)).not.toHaveProperty('pictureId');
            expect(first(), JSON.stringify(bad)).not.toHaveProperty('pictureSha256');
            expect(first(), JSON.stringify(bad)).not.toHaveProperty('pictureKind');
        }
    });

    it('accept each of the three kinds, and tidy case (the hash and the id are lower-case; the kind is read upper-case)', () => {
        for (const kind of ['PERSON', 'SCHEDULE', 'INSTITUTION']) {
            setScheduleTemplatesFromReferenceData([row({ pictureId: ID.toUpperCase(), pictureSha256: SHA.toUpperCase(), pictureKind: kind.toLowerCase() })]);
            expect(first().pictureKind).toBe(kind);
            expect(first().pictureId).toBe(ID);
            expect(first().pictureSha256).toBe(SHA);
        }
    });

    it('readPictureFields answers null for anything that is not a schedule row', () => {
        expect(readPictureFields(null)).toBeNull();
        expect(readPictureFields('x')).toBeNull();
        expect(readPictureFields({})).toBeNull();
        expect(readPictureFields({ pictureId: ID, pictureSha256: SHA, pictureKind: 'SCHEDULE' })).toEqual({ pictureId: ID, pictureSha256: SHA, pictureKind: 'SCHEDULE' });
    });
});
