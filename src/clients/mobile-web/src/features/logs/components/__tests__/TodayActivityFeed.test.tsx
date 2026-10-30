// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Activity Feed, moved from the log page to "माझं शेत" (founder 2026-10-24): its own button, a sheet
 * with the same cards, a Marathi heading, one big back. Also: the log page must no longer carry it.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TodayActivityButton, TodayActivityFeed, TodayActivitySheet, type FeedEntry } from '../TodayActivityFeed';
import { buildFeedEntries } from '../../../../core/navigation/activityFeedEntries';
import type { DailyLog } from '../../logs.types';
import type { CropProfile } from '../../../../types';

afterEach(cleanup);

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
    id: 'e1', workDone: 'Spray Logged', plotName: 'सोनाका', cropName: 'द्राक्ष', cropColor: 'bg-purple-500', loggedBy: 'Purvesh',
    timeLabel: '04:10 PM', statusLabel: 'UNVERIFIED', statusTone: 'pending', counts: { inputs: 2 }, summaryLines: ['Input: Ethrel'], onOpen: vi.fn(), ...over,
});

describe('the button on "माझं शेत"', () => {
    it('says what it opens, in Marathi, with how many cards wait', () => {
        const onClick = vi.fn();
        render(<TodayActivityButton count={3} onClick={onClick} />);
        const b = screen.getByTestId('activity-feed-button');
        expect(b.textContent).toContain('आजचा आढावा');
        expect(b.textContent).toContain('आज कोणी काय केलं ते पाहा');
        expect(screen.getByTestId('activity-feed-count').textContent).toBe('3');
        expect(b.className).toContain('min-h-[64px]'); // a big touch target
        fireEvent.click(b);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
    it('shows no count badge when there is nothing yet', () => {
        render(<TodayActivityButton count={0} onClick={() => {}} />);
        expect(screen.queryByTestId('activity-feed-count')).toBeNull();
    });
});

describe('the feed', () => {
    it('lists the same cards the log page used to; a card opens its log; no English headings', () => {
        const onOpen = vi.fn();
        render(<TodayActivityFeed entries={[entry({ onOpen }), entry({ id: 'e2', workDone: 'Irrigation Completed' })]} dateLabel="शनिवार, २५ ऑक्टो" />);
        expect(screen.getByTestId('activity-feed').textContent).toContain('आजचा आढावा');
        expect(screen.getByTestId('activity-feed-date').textContent).toBe('शनिवार, २५ ऑक्टो');
        expect(screen.getByText('Spray Logged')).toBeTruthy();
        expect(screen.getByText('Irrigation Completed')).toBeTruthy();
        fireEvent.click(screen.getByText('Spray Logged'));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain('Activity Feed');
        expect(document.body.textContent).not.toContain("Today's Timeline");
    });
    it('a real log (no recording) keeps every fact the old card showed, in Marathi, with no ▶ and no hint', () => {
        render(<TodayActivityFeed entries={[entry()]} dateLabel="d" />);
        expect(screen.getByTestId('card-work').textContent).toBe('Spray Logged');
        expect(screen.getByTestId('card-where').textContent).toContain('द्राक्ष · सोनाका');
        expect(screen.getByTestId('card-by').textContent).toContain('कोणी: Purvesh');
        expect(screen.getByTestId('card-time').textContent).toBe('04:10 PM');
        expect(screen.getByTestId('card-status').textContent).toBe('तपासणी बाकी');
        expect(screen.getByTestId('log-list-item').textContent).toContain('Input: Ethrel'); // summary line
        expect(screen.getByTestId('log-list-item').textContent).toContain('औषध / खत 2'); // per-bucket count
        expect(screen.queryByTestId('card-play')).toBeNull();
        expect(screen.queryByTestId('activity-feed-hint')).toBeNull();
    });
    it('an empty day says so in Marathi', () => {
        render(<TodayActivityFeed entries={[]} dateLabel="x" />);
        expect(screen.getByTestId('activity-feed-empty').textContent).toBe('आज अजून काहीही सांगितलं नाही');
    });
});

describe('the sheet', () => {
    it('is a full-screen dialog with one big labelled back', () => {
        const onClose = vi.fn();
        render(<TodayActivitySheet entries={[entry()]} dateLabel="d" onClose={onClose} />);
        expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('आजचा आढावा');
        const back = screen.getByTestId('activity-feed-back');
        expect(back.textContent).toContain('मागे');
        expect(back.className).toContain('min-h-[52px]');
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('the mapping from real logs', () => {
    const log = {
        id: 'L1', date: '2026-10-24', context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
        dayOutcome: null, cropActivities: [{ title: 'Spraying', workTypes: ['Spray'] }], irrigation: [], labour: [{ count: 4 }], inputs: [{ type: 'pesticide', productName: 'Ethrel' }], machinery: [],
        verification: { status: 'PENDING' }, meta: { createdByOperatorId: 'op1', createdAtISO: '2026-10-24T10:40:00.000Z' },
    } as unknown as DailyLog;
    const crops = [{ id: 'c1', name: 'द्राक्ष', iconName: 'Grape', color: 'bg-purple-500', plots: [] }] as unknown as CropProfile[];

    it('keeps the old rules: a named person is shown, an unnamed one is अज्ञात (never a guess)', () => {
        const onOpenLog = vi.fn();
        const base = { crops, getLogContextSnapshot: () => ({ plotName: 'सोनाका', cropName: 'द्राक्ष' }), onOpenLog };
        const named = buildFeedEntries([log], { ...base, operatorNameById: new Map([['op1', 'Purvesh']]) })[0];
        expect(named).toMatchObject({ id: 'L1', logId: 'L1', plotName: 'सोनाका', cropName: 'द्राक्ष', loggedBy: 'Purvesh', cropColor: 'bg-purple-500', statusTone: 'pending', counts: { inputs: 1, labour: 1, cropActivities: 1, irrigation: 0 } });
        const unnamed = buildFeedEntries([log], { ...base, operatorNameById: new Map() })[0];
        expect(unnamed.loggedBy).toBe('अज्ञात');
        named.onOpen();
        expect(onOpenLog).toHaveBeenCalledWith(log);
    });
});

describe('the log page no longer carries the feed', () => {
    it('mainView has no "Activity Feed" / "Today\'s Timeline"; the reflect view hands the entries to ReflectPage', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/core/navigation/mainView.tsx'), 'utf-8');
        expect(src).not.toMatch(/>\s*Activity Feed\s*</); // the old English heading
        expect(src).not.toMatch(/>\s*Today's Timeline/); // the old divider
        expect(src).not.toContain('<DailyLogCard');
        // lane RF: आढावा builds the day's work itself, for the day it is on; the reflect view hands it who is holding the
        // phone, his role, and the result screen's "बदला" path — no longer today's entries, ready-made.
        expect(src).not.toContain('activityFeed={activityFeed}');
        // review B001: "he said it" is the signed-in session's user only, never the profile's active operator
        expect(src).toContain('sessionUserId={getSessionUserId()}');
        expect(src).not.toContain('activeOperatorId, getSessionUserId()');
        expect(src).toContain('farmRole={ctx.farmRole ?? null}');
        // lane E1: "बदला" is the speak-the-change screen (`handleEditLog` opens it over the page).
        expect(src).toContain('onOpenLog={ctx.handleEditLog}');
    });
});
