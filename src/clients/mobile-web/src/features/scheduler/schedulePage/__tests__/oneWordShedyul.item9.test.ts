/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (UI-9a, redesign item 9; founder 2026-11-21: "the word 'शेड्यूल' everywhere, never 'वेळापत्रक'")
 *
 * The farmer reads ONE word for a schedule. These copy objects used to carry "वेळापत्रक" (the inflected forms too); they now carry "शेड्यूल".
 * The inflected Marathi is draft Marathi - needs review; this test pins what was written, not that the grammar is final.
 */
import { describe, expect, it } from 'vitest';
import { SOURCE_LABEL } from '../../../finance/moneyLabels';
import { INVITATION_COPY_FOR_TESTS } from '../../../invitations/invitationCopy';
import { authorityCopy } from '../../../profile/team/authorityCopy';
import { relationshipCopy } from '../../../relationships/relationshipCopy';
import { OWN_WORDS } from '../../ownSchedule/ownScheduleWords';
import { SC } from '../scheduleCopy';
import { SCHEDULE_MAP_WORDS } from '../scheduleMapCopy';
import { SCHEDULE_GATE_WORDS } from '../scheduleGateCopy';
import { THREE_PLUS_ONE_WORDS } from '../threePlusOneCopy';
import { plotStartWords } from '../../../profile/plotStart/plotStartCopy';

const OLD_WORD = 'वेळापत्रक';

/** Every string in a value (nested objects and arrays walked; functions are not called). */
const stringsIn = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(stringsIn);
    if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
    return [];
};

describe('one word for a schedule: "शेड्यूल", never "वेळापत्रक" (item 9)', () => {
    it('the changed Marathi labels', () => {
        expect(SOURCE_LABEL.ScheduleAuto).toBe('शेड्यूलमधून');
        expect(INVITATION_COPY_FOR_TESTS.mr.can.ScheduleTemplates).toBe('पीक शेड्यूलचे नमुने बनवू शकतात');
        expect(authorityCopy('mr').label.ScheduleTemplates).toBe('पीक शेड्यूलचे नमुने');
        expect((relationshipCopy('mr').kept.what as Record<string, string>).ScheduleSubscription).toBe('शेड्यूलमधील बदल');
        expect(OWN_WORDS.mr.whoRuleMake).toContain('"पीक शेड्यूलचे नमुने"');
    });

    it('no Marathi copy object the farmer reads carries the old word', () => {
        const objects: Record<string, unknown> = {
            moneyLabels: SOURCE_LABEL,
            invitationMr: INVITATION_COPY_FOR_TESTS.mr,
            authorityMr: authorityCopy('mr'),
            relationshipMr: relationshipCopy('mr'),
            ownScheduleMr: OWN_WORDS.mr,
            scheduleCopy: SC,
            scheduleMapMr: SCHEDULE_MAP_WORDS.mr,
            scheduleGateMr: SCHEDULE_GATE_WORDS.mr,
            threePlusOneMr: THREE_PLUS_ONE_WORDS.mr,
            plotStartMr: plotStartWords('mr', 'PRUNING'),
        };
        const offenders = Object.entries(objects).flatMap(([name, obj]) => stringsIn(obj).filter(s => s.includes(OLD_WORD)).map(s => `${name}: ${s}`));
        expect(offenders).toEqual([]);
    });
});
