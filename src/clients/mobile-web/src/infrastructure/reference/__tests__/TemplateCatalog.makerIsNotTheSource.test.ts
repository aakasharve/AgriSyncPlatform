/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10) - a reference schedule is MADE by ShramSafal (only the platform may import one); the import's
 * source label is where its content comes from and is kept apart. Fed with what the REAL server answered (`schedule-listing-slice7.json`): the maker is never
 * the source (founder v7: "बनवणारे श्रमसफल", "स्रोत ICAR-NRCG ची प्रकाशनं").
 */
import { describe, expect, it } from 'vitest';
import listing from './fixtures/schedule-listing-slice7.json';
import { getTemplateById, setScheduleTemplatesFromReferenceData } from '../TemplateCatalog';

type Row = { id: string; sourceLabel?: string; activities: unknown[] };

describe('the catalog keeps the maker and the source apart', () => {
    it('a reference with a source label is made by ShramSafal, and its source label stays the source', () => {
        const rows = listing as unknown as Row[];
        const reference = rows.find(r => r.activities.length > 0 && r.sourceLabel)!;
        setScheduleTemplatesFromReferenceData(rows as unknown[]);
        const template = getTemplateById(reference.id);
        expect(template).toBeDefined();
        expect(template!.createdBy).toBe('ShramSafal Reference Data');
        expect(template!.createdBy).not.toBe(reference.sourceLabel);
        expect(template!.sourceLabel).toBe(reference.sourceLabel);
    });
});
