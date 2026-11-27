// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9 §8b (a), phone task P13; FIX-1 item 8 sends it) - "कोणामार्फत?" comes back. The pull
 * writes `dailyLogs[].labour[].engagedThroughFieldOperatorId` ONLY when it is set (SERVER-REPORT §2): the phone keeps it on the labour line, absent when
 * the server sent none, and the labour home shows "कोणामार्फत: ‹नाव›" for the person the farm's list names - so the picked मुकादम is still shown after a
 * pull, on a second phone, or after a reinstall. A person the list does not name is never invented.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }),
}));

import LabourHub from '../components/LabourHub';
import { LABOUR_MOCK } from '../labourMock';
import { mapLabourEngagements } from '../../sync/pull/helpers/mapLabourEngagements';
import type { LabourEngagementDto } from '../../../infrastructure/api/AgriSyncClient';
import type { DailyLog, LedgerDefaults } from '../../../types';

const MUKADAM = '5a5a5a5a-0000-4000-8000-0000000000aa';
const wire = (over: Partial<LabourEngagementDto> = {}): LabourEngagementDto => ({
    labourAssignmentId: 'la-1', dailyLogId: 'log-1', engagementType: 'Hired', workerCount: 6, maleCount: null, femaleCount: null, wagePerPerson: null,
    contractUnit: null, contractQuantity: null, totalCost: null, durationHours: 8, timeBasis: 'Assumed', shift: null, task: null, notes: null,
    workerNames: [], createdAtUtc: '2026-11-27T05:00:00Z', linkedActivityId: null, attributedOperators: [], ...over,
} as LabourEngagementDto);

const ledgerDefaults: LedgerDefaults = {
    irrigation: { method: 'Drip', source: 'well', defaultDuration: 2 },
    labour: { defaultHours: 8, shifts: [] },
    machinery: { defaultRentalCost: 0, defaultFuelCost: 0 },
};
const hub = (labour: ReturnType<typeof mapLabourEngagements>, people = [{ id: MUKADAM, displayName: 'रमेश मुकादम' }]) => {
    const log = { id: 'log-1', labour, cropActivities: [], irrigation: [], inputs: [], machinery: [] } as unknown as DailyLog;
    return render(<LabourHub data={LABOUR_MOCK} onOpenMukadam={() => { }} onOpenPerson={() => { }} onAttendance={() => { }} onDashboard={() => { }}
        onLedger={() => { }} onReview={() => { }} onGoToLog={() => { }} onInviteWorker={() => { }} history={[log]} ledgerDefaults={ledgerDefaults}
        lastLabourLogIds={['log-1']} rosterPeople={people} />);
};

afterEach(() => cleanup());

describe('"कोणामार्फत?" read back from the pull (P13)', () => {
    it('the pull\'s id lands on the labour line; none sent, none kept', () => {
        expect(mapLabourEngagements([wire({ engagedThroughFieldOperatorId: MUKADAM } as Partial<LabourEngagementDto>)])[0].engagedThroughFieldOperatorId).toBe(MUKADAM);
        expect('engagedThroughFieldOperatorId' in mapLabourEngagements([wire()])[0]).toBe(false);
        expect('engagedThroughFieldOperatorId' in mapLabourEngagements([wire({ engagedThroughFieldOperatorId: null } as Partial<LabourEngagementDto>)])[0]).toBe(false);
    });

    it('the picked मुकादम is still shown after a pull', () => {
        hub(mapLabourEngagements([wire({ engagedThroughFieldOperatorId: MUKADAM } as Partial<LabourEngagementDto>)]));
        expect(screen.getByTestId('labour-just-logged-through')).toHaveTextContent('कोणामार्फत: रमेश मुकादम');
    });

    it('a person the farm\'s list does not name is never invented; a line with none says nothing', () => {
        hub(mapLabourEngagements([wire({ engagedThroughFieldOperatorId: MUKADAM } as Partial<LabourEngagementDto>)]), []);
        expect(screen.queryByTestId('labour-just-logged-through')).not.toBeInTheDocument();
        cleanup();
        hub(mapLabourEngagements([wire()]));
        expect(screen.queryByTestId('labour-just-logged-through')).not.toBeInTheDocument();
    });
});
