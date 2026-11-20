// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H8; doctrine P4)
 *
 * The activity feed card said "तपासलं" (checked) for EVERY approved record. But an owner's own records are approved the moment he
 * makes them (`LogFactory`: the same operator id is the author and the approver), so nobody checked them. "तपासलं" now shows only when a
 * person OTHER than the author approved the record; a self-approved, or not-known, approval says the plain word the overview and the
 * result screen use: "पक्कं केलं". A record still waiting says "तपासणी बाकी" as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import ActivityFeedCard, { CARD_STR } from '../ActivityFeedCard';
import { TodayActivityFeed, type FeedEntry } from '../TodayActivityFeed';
import { buildFeedEntries } from '../../../../core/navigation/activityFeedEntries';
import { isCheckedByAnotherPerson } from '../../../../core/navigation/helpers';
import type { DailyLog } from '../../logs.types';
import type { CropProfile } from '../../../../types';

afterEach(cleanup);

const card = (over: Partial<React.ComponentProps<typeof ActivityFeedCard>> = {}) => (
    <ActivityFeedCard workDone="फवारणी" plotName="सोनाका" cropName="द्राक्ष" cropColor="bg-purple-500" loggedBy="Purvesh" timeLabel=""
        statusTone="approved" onClick={() => undefined} {...over} />
);

describe('H8 - the card says "तपासलं" only when another person approved', () => {
    it('approved by ANOTHER person: तपासलं', () => {
        render(card({ statusTone: 'approved', checkedByOther: true }));
        expect(screen.getByTestId('card-status').textContent).toBe('तपासलं');
    });

    it('approved but self-approved or not known (the flag false or absent): पक्कं केलं, never तपासलं', () => {
        const { unmount } = render(card({ statusTone: 'approved', checkedByOther: false }));
        expect(screen.getByTestId('card-status').textContent).toBe('पक्कं केलं');
        unmount();
        render(card({ statusTone: 'approved' }));
        expect(screen.getByTestId('card-status').textContent).toBe('पक्कं केलं');
        expect(document.body.textContent).not.toContain('तपासलं');
    });

    it('waiting and sent-back records are unchanged', () => {
        const { unmount } = render(card({ statusTone: 'pending', checkedByOther: true }));
        expect(screen.getByTestId('card-status').textContent).toBe('तपासणी बाकी');
        unmount();
        render(card({ statusTone: 'rejected' }));
        expect(screen.getByTestId('card-status').textContent).toBe('दुरुस्ती हवी');
    });

    it('the feed hands the flag from its entry to the card', () => {
        const entry = (id: string, checkedByOther: boolean): FeedEntry => ({
            id, workDone: id, plotName: 'सोनाका', cropName: 'द्राक्ष', cropColor: 'bg-purple-500', loggedBy: 'x', timeLabel: '',
            statusLabel: 'VERIFIED', statusTone: 'approved', checkedByOther, onOpen: vi.fn(),
        });
        render(<TodayActivityFeed entries={[entry('own', false), entry('other', true)]} dateLabel="d" />);
        const rows = screen.getAllByTestId('log-list-item');
        expect(rows[0].querySelector('[data-testid="card-status"]')?.textContent).toBe('पक्कं केलं');
        expect(rows[1].querySelector('[data-testid="card-status"]')?.textContent).toBe('तपासलं');
    });

    it('the two words stay distinct in the card\'s copy', () => {
        expect(CARD_STR.status.approved).toBe('तपासलं');
        expect(CARD_STR.status.confirmed).toBe('पक्कं केलं');
    });
});

describe('H8 - who counts as "another person" (the pure rule)', () => {
    const log = (createdBy?: string, verifiedBy?: string) => ({ meta: { createdAtISO: 'x', createdByOperatorId: createdBy }, verification: { status: 'APPROVED', required: false, verifiedByOperatorId: verifiedBy } }) as unknown as Pick<DailyLog, 'meta' | 'verification'>;

    it('the owner approves a worker\'s record: another person', () => {
        expect(isCheckedByAnotherPerson(log('worker-1', 'owner-1'))).toBe(true);
    });
    it('the owner\'s own record, auto-approved at creation (same id on both sides): nobody else checked it', () => {
        expect(isCheckedByAnotherPerson(log('owner-1', 'owner-1'))).toBe(false);
    });
    it('a missing id on either side is "not known", never "somebody else"', () => {
        expect(isCheckedByAnotherPerson(log(undefined, 'owner-1'))).toBe(false);
        expect(isCheckedByAnotherPerson(log('owner-1', undefined))).toBe(false);
        expect(isCheckedByAnotherPerson(log('', ''))).toBe(false);
        expect(isCheckedByAnotherPerson({} as Pick<DailyLog, 'meta' | 'verification'>)).toBe(false);
    });
});

describe('H8 - the real mapping from logs', () => {
    const crops = [{ id: 'c1', name: 'द्राक्ष', iconName: 'Grape', color: 'bg-purple-500', plots: [] }] as unknown as CropProfile[];
    const baseLog = (id: string, status: string, createdBy: string, verifiedBy?: string) => ({
        id, date: '2026-10-24', context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
        dayOutcome: null, cropActivities: [{ title: 'Spraying', workTypes: ['Spray'] }], irrigation: [], labour: [], inputs: [], machinery: [],
        verification: { status, required: false, verifiedByOperatorId: verifiedBy }, meta: { createdByOperatorId: createdBy, createdAtISO: '2026-10-24T10:40:00.000Z' },
    }) as unknown as DailyLog;
    const deps = { crops, operatorNameById: new Map([['owner-1', 'Purvesh'], ['worker-1', 'Ramesh']]), getLogContextSnapshot: () => ({ plotName: 'सोनाका', cropName: 'द्राक्ष' }), onOpenLog: vi.fn() };

    it('an owner\'s own auto-approved record reads पक्कं केलं; the owner approving a worker\'s reads तपासलं', () => {
        const entries = buildFeedEntries([
            baseLog('own', 'APPROVED', 'owner-1', 'owner-1'),
            baseLog('worker', 'VERIFIED', 'worker-1', 'owner-1'),
            baseLog('waiting', 'PENDING', 'worker-1'),
        ], deps);
        expect(entries.map(e => [e.id, e.statusTone, e.checkedByOther])).toEqual([
            ['own', 'approved', false],
            ['worker', 'approved', true],
            ['waiting', 'pending', false],
        ]);
        render(<TodayActivityFeed entries={entries} dateLabel="d" />);
        const statuses = screen.getAllByTestId('card-status').map(n => n.textContent);
        expect(statuses).toEqual(['पक्कं केलं', 'तपासलं', 'तपासणी बाकी']);
    });
});
