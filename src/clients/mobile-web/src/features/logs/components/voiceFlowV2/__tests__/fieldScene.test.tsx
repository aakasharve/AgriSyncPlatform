// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — the field card draws only what the parse found (P4): workers only for a stated
 * headcount (capped), a sprayer for a spray, drip lines for watering, a tractor for a machine, vines for the work.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgriLogResponse } from '../../../../../types';
import { EMPTY_FIELD, MAX_WORKERS, fieldSceneOf, sceneCount } from '../fieldScene';
import { FieldCard } from '../FieldCard';

const draft = (over: Partial<AgriLogResponse>): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
    ...over,
} as unknown as AgriLogResponse);

afterEach(() => cleanup());

describe('fieldSceneOf', () => {
    it('nothing parsed, nothing drawn', () => {
        expect(fieldSceneOf(undefined)).toEqual(EMPTY_FIELD);
        expect(fieldSceneOf(draft({}))).toEqual(EMPTY_FIELD);
    });

    it('workers: his stated count, capped; an unstated count draws none (never a guess)', () => {
        expect(fieldSceneOf(draft({ labour: [{ id: 'l', count: 10 }] as never })).workers).toBe(10);
        expect(fieldSceneOf(draft({ labour: [{ id: 'l', maleCount: 3, femaleCount: 7 }] as never })).workers).toBe(10);
        expect(fieldSceneOf(draft({ labour: [{ id: 'l', count: 40 }] as never })).workers).toBe(MAX_WORKERS);
        expect(fieldSceneOf(draft({ labour: [{ id: 'l' }] as never })).workers).toBe(0);
    });

    it('a spray, watering (not the spray\'s own water), a machine, the work', () => {
        const s = fieldSceneOf(draft({
            inputs: [{ id: 'i', method: 'Spray', mix: [] }] as never,
            irrigation: [{ id: 'w', method: 'Drip', durationHours: 2 }] as never,
            machinery: [{ id: 'm', type: 'tractor' }] as never,
            cropActivities: [{ id: 'c', title: 'फवारणी' }] as never,
        }));
        expect(s).toEqual({ workers: 0, spray: true, drip: true, tractor: true, vines: true });
        expect(sceneCount(s)).toBe(4);
        expect(fieldSceneOf(draft({ irrigation: [{ id: 'w', role: 'spray-carrier' }] as never })).drip).toBe(false);
        expect(fieldSceneOf(draft({ inputs: [{ id: 'i', method: 'Soil', mix: [] }] as never })).spray).toBe(false);
    });
});

describe('FieldCard', () => {
    it('bare without a scene: the caption only, nothing drawn, no count', () => {
        render(<FieldCard title="तुमचं शेत · प्लॉट २" countLabel={n => `शेतात भरलं: ${n}`} />);
        expect(screen.getByTestId('field-card')).toHaveAttribute('data-filled', 'no');
        expect(screen.getByTestId('field-title')).toHaveTextContent('तुमचं शेत · प्लॉट २');
        expect(screen.queryByTestId('field-count')).toBeNull();
        expect(screen.queryAllByTestId('field-worker')).toHaveLength(0);
    });

    it('filled from a scene: exactly its workers, its machine, its drip, its count', () => {
        render(<FieldCard title="तुमचं शेत" scene={{ workers: 4, spray: false, drip: true, tractor: true, vines: false }} countLabel={n => `शेतात भरलं: ${n}`} />);
        expect(screen.getByTestId('field-card')).toHaveAttribute('data-filled', 'yes');
        expect(screen.getAllByTestId('field-worker')).toHaveLength(4);
        expect(screen.getByTestId('field-tractor')).toBeInTheDocument();
        expect(screen.getAllByTestId('field-drip').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('field-spray')).toBeNull();
        expect(screen.queryByTestId('field-vines')).toBeNull();
        expect(screen.getByTestId('field-count')).toHaveTextContent('शेतात भरलं: 3');
    });
});
