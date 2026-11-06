/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1, Review Focus 3) — C# <-> TS CROP RULE PARITY, the TS half.
 *
 * The schedule a farmer sees in the शेड्यूल लायब्ररी must be the schedule the server can adopt for his plot. Both sides
 * decide "is this schedule for this crop?" by one rule: the name read through the founder's crop master, then the crop
 * code. ONE shared fixture pins both: `sync-contract/tests/fixtures/crop-schedule-match.json`. This file proves the
 * phone's library (getTemplatesForCrop, scheduleCropCode, the library view's list) reads every fixture name as the fixture
 * says; `ScheduleLibraryCropRuleTests.cs` and `ScheduleAdoptRealPostgresTests.Marathi_crop_name_matches_like_the_phone_library`
 * prove the server does. Change either side and one goes red.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getTemplatesForCrop,
    isFallbackTemplate,
    scheduleCropCode,
    setScheduleTemplatesFromReferenceData,
} from '../TemplateCatalog';
import { libraryTemplates } from '../../../features/scheduler/components/ScheduleLibraryView';
import type { CropProfile } from '../../../types';

interface Fixture {
    builtInTemplates: Array<{ id: string; cropType: string; cropCode: string }>;
    cases: Array<{ name: string; cycleCrop: string; cropCode: string }>;
    neverMatch: Array<{ name: string; templateCrop: string; cycleCrop: string }>;
}

const fixturePath = resolve(__dirname, '../../../../../../../sync-contract/tests/fixtures/crop-schedule-match.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

/** The built-in library as the server sends it (ReferenceDataCatalog's ids and crop types; one stage, one task). */
const referenceTemplates = fixture.builtInTemplates.map(t => ({
    id: t.id,
    name: `${t.cropType} - Standard`,
    cropType: t.cropType,
    totalDays: 120,
    stages: [{ name: 'Establishment', startDay: 0, endDay: 119 }],
    activities: [{ name: 'Irrigation', category: 'Irrigation', stageName: 'Establishment', startDay: 1, endDay: 60, frequencyMode: 'every_n_days', intervalDays: 3 }],
}));

const cropNamed = (name: string): CropProfile => ({
    id: `c_${name}`, name, iconName: 'Sprout', color: 'bg-green-500', plots: [], activeScheduleId: null,
    supportedTasks: ['General'], workflow: [], createdAt: '2026-11-06T00:00:00.000Z',
} as unknown as CropProfile);

describe('the crop <-> schedule rule (shared with the server)', () => {
    beforeEach(() => setScheduleTemplatesFromReferenceData(referenceTemplates));

    it('the fixture holds the Marathi grape name and every built-in crop', () => {
        expect(fixture.cases.map(c => c.cycleCrop)).toContain('द्राक्ष');
        expect(fixture.builtInTemplates.map(t => t.cropCode).sort()).toEqual(['grape', 'onion', 'pomegranate', 'sugarcane']);
    });

    for (const c of fixture.cases) {
        it(`${c.name}: "${c.cycleCrop}" reads as ${c.cropCode}`, () => {
            expect(scheduleCropCode(c.cycleCrop)).toBe(c.cropCode);

            const own = fixture.builtInTemplates.find(t => t.cropCode === c.cropCode);
            const listed = getTemplatesForCrop(c.cycleCrop);
            if (own) {
                // The library lists exactly this crop's schedule for it — the one the server will adopt.
                expect(listed.map(t => t.id)).toEqual([own.id]);
            } else {
                // No schedule of its crop: only the stand-in, which the page never shows as a schedule (P4).
                expect(listed).toHaveLength(1);
                expect(isFallbackTemplate(listed[0])).toBe(true);
            }

            // The library page lists the same schedules for a farm growing this crop.
            expect(libraryTemplates([cropNamed(c.cycleCrop)]).map(t => t.id)).toEqual(own ? [own.id] : []);
        });
    }
});

// lane L8b-1 fix round 1 (review L5) — a name the rule cannot read (unknown_crop) is never a crop: no schedule is matched
// to it, on the phone as on the server (ScheduleLibraryCropRuleTests.An_unreadable_crop_never_matches reads the same list).
describe('an unreadable crop never matches (shared with the server)', () => {
    for (const c of fixture.neverMatch) {
        it(`${c.name}: a "${c.templateCrop}" schedule is not listed for "${c.cycleCrop}"`, () => {
            setScheduleTemplatesFromReferenceData([{ ...referenceTemplates[0], id: 'l5-unreadable', name: `${c.templateCrop} - Standard`, cropType: c.templateCrop }]);

            expect(getTemplatesForCrop(c.cycleCrop).map(t => t.id)).not.toContain('l5-unreadable');
            expect(libraryTemplates([cropNamed(c.cycleCrop)]).map(t => t.id)).not.toContain('l5-unreadable');
        });
    }
});
