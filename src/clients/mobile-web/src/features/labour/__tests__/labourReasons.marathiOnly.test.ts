/**
 * PLR-D10 L3a — merge-review m3 and the founder's language-strict rule ("Marathi mode = Marathi
 * only"). The labour screens speak Marathi only, so every REASON they give the farmer — why there is
 * no mic yet, why a mark did not reach the farm record, why a count is only provisional, why his own
 * हजेरी is not here yet, and the वही's paging words — must be Marathi, with no English word slipping
 * in from a server message or a developer string. (A reason is asserted by its Marathi text in the
 * screen tests; this pins the whole set at once.)
 */
import { describe, it, expect } from 'vitest';
import { ATTENDANCE_COPY } from '../attendanceCopy';
import { OWN_ATTENDANCE_COMING_SOON } from '../components/OwnAttendanceComingSoon';
import { VAHI_ENDS_TODAY, VAHI_UNIT_LABELS } from '../vahiPeriod';

const LATIN = /[A-Za-z]/;

describe('labour reasons are Marathi only (m3, language-strict)', () => {
    it.each([
        ['no-mic reason', ATTENDANCE_COPY.noAnchorReason],
        ['refused: no responsibility', ATTENDANCE_COPY.refusedMissingResponsibility],
        ['refused: a future day', ATTENDANCE_COPY.refusedFutureDate],
        ['refused: title', ATTENDANCE_COPY.refusedMarksTitle(2)],
        ['no-work day not recorded', ATTENDANCE_COPY.noWorkNotRecorded],
        ['provisional count', ATTENDANCE_COPY.provisionalChip],
        ['own हजेरी coming soon', OWN_ATTENDANCE_COMING_SOON],
        ['वही: week', VAHI_UNIT_LABELS.week],
        ['वही: month', VAHI_UNIT_LABELS.month],
        ['वही: ends today', VAHI_ENDS_TODAY],
    ])('%s has no English', (_name, text) => {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(LATIN);
    });
});
