// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6; approved spec SM-12) - तुलना's own-building row: read through the REAL parser (an answer without
 * it reads exactly as before), drawn from the server's numbers only, under the same stage line, Marathi only with Devanagari digits.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OwnBuildingRow } from '../OwnBuildingRow';
import { answerOf, baseAnswer } from './compareFixtures';
import { parseFarmCompare } from '../data/compareDtos';

afterEach(() => cleanup());

const counts = (asked: number | null, done: number | null, items: { asked: number | null; done: number }[]) => ({
    asked, done, notYet: asked === null || done === null ? null : asked - done, saidNotDone: 0, moreThanAsked: 0,
    parts: [{ part: 'work', items: items.map((i, n) => ({ activityId: `own-${n}`, title: 'वेली बांधणी', asked: i.asked, done: i.done, notYet: i.asked === null ? null : i.asked - i.done, saidNotDone: 0, moreThanAsked: 0 })) }],
});

describe('the own schedule still being built, as its own row in तुलना', () => {
    it('an answer without it reads as before (an old server, or no own schedule): null', () => {
        expect(answerOf().plots[0].ownBuilding).toBeNull();
    });

    it('is read whole through the real parser, and draws 1 of 1 in Marathi with Devanagari digits', () => {
        const answer = answerOf(a => {
            (a.plots[0] as unknown as Record<string, unknown>).ownBuilding = {
                works: 2, stages: [null, counts(1, 1, [{ asked: 1, done: 1 }]), null], stageUnknown: counts(null, null, [{ asked: null, done: 1 }]),
            };
        });
        const row = answer.plots[0].ownBuilding!;
        expect(row.works).toBe(2);
        render(<OwnBuildingRow row={row} stageIndex={1} plotStageCount={3} lang="mr" />);
        expect(screen.getByTestId('compare-own-building-count')).toHaveTextContent('१ पैकी १ झालं');
        expect(screen.getByTestId('compare-own-building-works')).toHaveTextContent('२ कामं');
        expect(screen.getByTestId('compare-own-building-unknown')).toHaveTextContent('टप्पा न ठरलेली १ कामं · १ नोंदी');
        expect(screen.getByTestId('compare-own-building').textContent ?? '').not.toMatch(/[A-Za-z0-9]/);
    });

    it('a stage with only works of no fixed day says so in words, never a number (P4)', () => {
        const parsed = parseFarmCompare({ ...baseAnswer(), plots: [{ ...baseAnswer().plots[0], ownBuilding: { works: 1, stages: [null, counts(null, null, [{ asked: null, done: 0 }]), null] } }] });
        render(<OwnBuildingRow row={parsed!.plots[0].ownBuilding!} stageIndex={1} plotStageCount={3} lang="mr" />);
        expect(screen.getByTestId('compare-own-building-count')).toHaveTextContent('या टप्प्यात दिवस अजून ठरलेला नाही');
        expect(screen.queryByTestId('compare-own-building-unknown')).toBeNull();
    });

    it('stages that do not line up with the plot stages draw no number under the wrong stage', () => {
        const parsed = parseFarmCompare({ ...baseAnswer(), plots: [{ ...baseAnswer().plots[0], ownBuilding: { works: 1, stages: [counts(1, 0, [{ asked: 1, done: 0 }])] } }] });
        render(<OwnBuildingRow row={parsed!.plots[0].ownBuilding!} stageIndex={0} plotStageCount={3} lang="mr" />);
        expect(screen.getByTestId('compare-own-building-count')).toHaveTextContent('या टप्प्यात यातलं काम नाही');
    });
});
