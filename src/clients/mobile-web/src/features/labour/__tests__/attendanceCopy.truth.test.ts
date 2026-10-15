// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';

/* Founder decision 2026-10-12: truthful Marathi - no authorship the app cannot
   prove, no "went/saved" claim for a mark the server refused, no English. */
describe('attendance copy - truth and authorship', () => {
    it('never says "you said" (the speaker is whoever holds the phone; a marked list is not speech)', () => {
        expect(COPY.youSaidChip).not.toContain('तुम्ही');
        expect(COPY.markedChip).not.toContain('तुम्ही');
        expect(COPY.youSaidChip).not.toBe(COPY.markedChip);
    });

    it('a refused mark / no-work day says it was NOT deposited in the farm record', () => {
        expect(COPY.refusedMarksTitle(2)).toBe('2 हजेरी शेतनोंदीत जमा झाली नाही');
        expect(COPY.noWorkNotRecorded).toContain('शेतनोंदीत जमा झाला नाही');
    });
});
