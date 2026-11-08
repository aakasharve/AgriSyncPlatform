// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 3, founder D-24c, D-24a, P4, P10) - the card and the "when" rules:
 * a dated card past its day and not finished is red; an undated or loose one is amber and never "उशीर झाला"; the trail steps; a
 * reminder says "आठवण", never "सोपवलं"; the crew line is words only; Marathi mode shows no English word and English mode no Marathi
 * word (names through `namesIn`); a queued step and a parked step are said honestly.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlanCard } from '../components/PlanCard';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { sortByWhen, whenView } from '../planDates';
import { crewLine, isReminderTask, trailStage } from '../planCardModel';
import { plannedWorkWords } from '../plannedWorkWords';

afterEach(cleanup);

const ME = '22222222-2222-4222-8222-222222222222';
const RAJU = '11111111-1111-4111-8111-111111111111';
const TODAY = new Date(2026, 10, 8); // 8 Nov 2026

const task = (over: Partial<LocalPlannedWork> = {}): LocalPlannedWork => ({
    id: '33333333-3333-4333-8333-333333333331', farmId: 'f1', title: 'फवारणी', scope: 'Plot', plotIds: ['p1'],
    plannedDate: '2026-11-10', looseWhen: null, plannedTime: null, assigneeUserId: RAJU, crewText: null, expectedHeadcount: null,
    quantityText: null, payMode: null, note: null, status: 'Assigned', sourceKind: 'PlanForm', recordedOn: '2026-11-08',
    createdByUserId: ME, modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false,
    ...over,
});

const draw = (t: LocalPlannedWork, over: Partial<React.ComponentProps<typeof PlanCard>> = {}, language = 'mr') =>
    render(<ul><PlanCard task={t} today={TODAY} me={ME} language={language} whereText="ऊस 1" assigneeName="राजू" assigneeRole="Worker" {...over} /></ul>);

describe('the "when" rules (D-24c)', () => {
    const words = plannedWorkWords('mr');

    it('a dated task past its day and not finished is late; the same task finished or cancelled is not', () => {
        expect(whenView({ plannedDate: '2026-11-07', looseWhen: null, status: 'Assigned' }, TODAY, words, 'mr').late).toBe(true);
        expect(whenView({ plannedDate: '2026-11-07', looseWhen: null, status: 'Done' }, TODAY, words, 'mr').late).toBe(false);
        expect(whenView({ plannedDate: '2026-11-07', looseWhen: null, status: 'Cancelled' }, TODAY, words, 'mr').late).toBe(false);
        expect(whenView({ plannedDate: '2026-11-08', looseWhen: null, status: 'Open' }, TODAY, words, 'mr').late).toBe(false);
    });

    it('undated and loose are never late, however old the task', () => {
        for (const looseWhen of [null, 'Week', 'Month', 'Anytime'] as const) {
            const v = whenView({ plannedDate: null, looseWhen, status: 'Assigned' }, TODAY, words, 'mr');
            expect(v.late).toBe(false);
            expect(v.undated).toBe(true);
            expect(v.main).toBe('तारीख ठरलेली नाही');
        }
        expect(whenView({ plannedDate: null, looseWhen: 'Anytime', status: 'Assigned' }, TODAY, words, 'mr').sub).toBe('जमेल तेव्हा');
    });

    it('dated work sorts first, soonest first; undated after', () => {
        const list = sortByWhen([{ plannedDate: null, n: 1 }, { plannedDate: '2026-11-12', n: 2 }, { plannedDate: '2026-11-09', n: 3 }]);
        expect(list.map(x => x.n)).toEqual([3, 2, 1]);
    });
});

describe('the card', () => {
    it('dated past and not done: red, with "उशीर झाला"', () => {
        draw(task({ plannedDate: '2026-11-06' }));
        const card = screen.getByTestId(`plan-${task().id}`);
        expect(card).toHaveAttribute('data-late', 'yes');
        expect(card).toHaveAttribute('data-tone', 'red');
        expect(card.className).toContain('border-red-300');
        expect(within(card).getByTestId('plan-card-late')).toHaveTextContent('उशीर झाला');
    });

    it('undated and loose: amber, never "उशीर झाला", never red', () => {
        for (const over of [{ plannedDate: null, looseWhen: null }, { plannedDate: null, looseWhen: 'Month' as const }]) {
            draw(task(over));
            const card = screen.getByTestId(`plan-${task().id}`);
            expect(card).toHaveAttribute('data-tone', 'amber');
            expect(card).toHaveAttribute('data-late', 'no');
            expect(card.className).not.toContain('border-red');
            expect(card.textContent).not.toContain('उशीर');
            expect(within(card).getByTestId('plan-card-when').className).toContain('amber');
            cleanup();
        }
    });

    it('the trail stands on the status: सोपवलं, पाहिलं, स्वीकारलं, झालं', () => {
        const steps = [['Assigned', 0], ['Seen', 1], ['Accepted', 2], ['Done', 3]] as const;
        for (const [status, stage] of steps) {
            draw(task({ status }));
            const trail = screen.getByTestId('plan-trail');
            expect(trail).toHaveAttribute('data-stage', String(stage));
            expect(Array.from(trail.querySelectorAll('li')).map(li => li.textContent)).toEqual(['सोपवलं', 'पाहिलं', 'स्वीकारलं', 'झालं']);
            expect(screen.getByTestId(`plan-trail-${stage}`)).toHaveAttribute('data-on', 'yes');
            if (stage < 3) expect(screen.getByTestId(`plan-trail-${stage + 1}`)).toHaveAttribute('data-on', 'no');
            cleanup();
        }
    });

    it('a reminder says "आठवण" and "फक्त आठवण", has no trail, and never says "सोपवलं"', () => {
        for (const assigneeUserId of [null, ME]) {
            draw(task({ assigneeUserId, status: 'Open' }));
            const card = screen.getByTestId(`plan-${task().id}`);
            expect(card).toHaveAttribute('data-reminder', 'yes');
            expect(within(card).getByTestId('plan-card-who')).toHaveTextContent('फक्त आठवण');
            expect(within(card).getByTestId('plan-card-reminder')).toHaveTextContent('आठवण');
            expect(screen.queryByTestId('plan-trail')).toBeNull();
            expect(card.textContent).not.toContain('सोपवलं');
            cleanup();
        }
    });

    it('a crew task shows the team and the headcount as words: "रोकडेची टीम · १० जण", and nothing about हजेरी or money', () => {
        draw(task({ crewText: 'रोकडेची टीम', expectedHeadcount: 10, payMode: 'Contract', quantityText: 'प्रत्येक ओळीला ३ पोती' }), { assigneeRole: 'Mukadam' });
        const card = screen.getByTestId(`plan-${task().id}`);
        expect(within(card).getByTestId('plan-card-crew')).toHaveTextContent('रोकडेची टीम · १० जण');
        expect(within(card).getByTestId('plan-card-details')).toHaveTextContent('ठेक्याने');
        expect(card.textContent).not.toMatch(/हजेरी|₹|मजुरी|खर्च/);
    });

    it('the assignee sees "तुम्ही" on his own card', () => {
        draw(task({ assigneeUserId: ME, createdByUserId: RAJU }), { assigneeName: null });
        expect(screen.getByTestId('plan-card-who')).toHaveTextContent('तुम्ही');
    });
});

describe('Marathi mode shows Marathi only, English mode English only (names through namesIn)', () => {
    const full = task({ title: 'फवारणी', crewText: null, expectedHeadcount: 12, quantityText: null, payMode: 'Cash', note: null, assigneeUserId: RAJU });

    it('Marathi mode: no Latin letter in the words (digits and the entered name aside)', () => {
        draw(full, { assigneeName: 'राजू', assigneeRole: 'Mukadam' });
        const text = screen.getByTestId(`plan-${full.id}`).textContent ?? '';
        expect(text).toContain('फवारणी');
        expect(text).not.toMatch(/[A-Za-z]/);
    });

    it('English mode: the known work type is shown in English and no Devanagari letter is drawn', () => {
        draw(full, { assigneeName: 'Raju', assigneeRole: 'Mukadam', whereText: 'Sugarcane 1' }, 'en');
        const card = screen.getByTestId(`plan-${full.id}`);
        expect(within(card).getByTestId('plan-card-work')).toHaveTextContent('Spraying');
        expect(card.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(within(card).getByTestId('plan-card-who')).toHaveTextContent('For whom: Raju · Mukadam');
    });

    it('English mode: a reminder, a crew line and a late card carry no Marathi', () => {
        draw(task({ plannedDate: '2026-11-01', assigneeUserId: null, status: 'Open', crewText: 'Rokade team', expectedHeadcount: 10 }), { whereText: 'Whole farm' }, 'en');
        const text = screen.getByTestId(`plan-${task().id}`).textContent ?? '';
        expect(text).not.toMatch(/[ऀ-ॿ]/);
        expect(text).toContain('Reminder only');
        expect(text).toContain('Rokade team · 10 people');
    });
});

describe('honest states (P10)', () => {
    it('a queued step says "फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल"', () => {
        draw(task({ keptOnPhone: true, pendingSteps: ['accept'], status: 'Accepted' }));
        expect(screen.getByTestId('plan-kept')).toHaveTextContent('फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल');
    });

    it('a parked step shows its own words, opens the conflict page, and the trail does not run ahead', () => {
        const onOpen = vi.fn();
        draw(task({ status: 'Seen' }), { parked: { verb: 'accept', errorCode: 'ShramSafal.PlannedWorkState.InvalidCommand', lastError: 'x' }, onOpenConflicts: onOpen });
        expect(screen.getByTestId('plan-parked-words')).toHaveTextContent('हे काम आधी बदललं गेलं, म्हणून हा बदल लागू झाला नाही.');
        expect(screen.getByTestId('plan-trail')).toHaveAttribute('data-stage', '1');
        expect(screen.getByTestId('plan-trail-2')).toHaveAttribute('data-on', 'no');
        fireEvent.click(screen.getByTestId('plan-parked-open'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('the refusal codes map to their words', () => {
        const cases: Array<[string, 'create' | 'seen', string]> = [
            ['ShramSafal.PlannedWorkAssigneeNotMember.InvalidCommand', 'create', 'ही व्यक्ती या शेतावर सध्या नाही, म्हणून तिला काम सोपवता येत नाही.'],
            ['ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand', 'create', 'या व्यक्तीकडे यातले सगळे प्लॉट नाहीत, म्हणून तिला हे काम सोपवता येत नाही.'],
            ['ShramSafal.Forbidden', 'seen', 'हे काम आता तुमच्यावर सोपवलेलं नाही.'],
        ];
        for (const [errorCode, verb, expected] of cases) {
            draw(task(), { parked: { verb, errorCode, lastError: null } });
            expect(screen.getByTestId('plan-parked-words')).toHaveTextContent(expected);
            cleanup();
        }
    });
});

describe('the model', () => {
    it('a task made on this phone (no maker field yet) assigned to himself is a reminder', () => {
        expect(isReminderTask({ assigneeUserId: ME, createdByUserId: null }, ME)).toBe(true);
        expect(isReminderTask({ assigneeUserId: RAJU, createdByUserId: null }, ME)).toBe(false);
        expect(trailStage({ status: 'Cancelled', assigneeUserId: RAJU, createdByUserId: ME }, ME)).toBeNull();
        expect(crewLine({ crewText: null, expectedHeadcount: null }, plannedWorkWords('mr'))).toBe('');
    });
});
