// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UnderstandingGauge: the arc of bars (PLR-D1a). Lit bars follow the score, the bars this
 * recording added glow, the target mark is solid once reached, and an unknown score lights nothing.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import UnderstandingGauge from '../UnderstandingGauge';

afterEach(cleanup);
const UNLIT = '#E3DED4';
/** The 30 bars only (the target's tick is drawn inside its own group). */
const bars = () => Array.from(document.querySelectorAll('svg > line')) as SVGLineElement[];
const lit = () => bars().filter(l => l.getAttribute('stroke') !== UNLIT);
const glowing = () => bars().filter(l => l.style.filter.includes('drop-shadow'));
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

describe('UnderstandingGauge', () => {
    it('lights bars in proportion to the score; the bars THIS recording added glow', async () => {
        render(<UnderstandingGauge score={8} before={6} max={10} target={9} targetLabel="९"><span>बरंच समजलं</span></UnderstandingGauge>);
        await settle();
        expect(bars().length).toBe(30);
        expect(lit().length).toBe(24); // 8/10 of 30
        expect(glowing().length).toBe(6); // 6/10 -> 8/10
        expect(screen.getByText('बरंच समजलं')).toBeTruthy();
        expect(screen.getByTestId('gauge-target').getAttribute('data-reached')).toBe('no');
        expect(screen.getByTestId('gauge-target').textContent).toBe('९');
    });

    it('the target mark turns solid once reached', async () => {
        render(<UnderstandingGauge score={9} max={10} target={9} />);
        await settle();
        expect(screen.getByTestId('gauge-target').getAttribute('data-reached')).toBe('yes');
    });

    it('an unknown score lights nothing (never a 0 dressed as a number)', async () => {
        render(<UnderstandingGauge score={null} max={10} target={9} />);
        await settle();
        expect(lit().length).toBe(0);
        expect(glowing().length).toBe(0);
    });
});

describe('UnderstandingGauge - the live parts', () => {
    it('a knob sits on the arc and sweeps from where the score WAS to where it is NOW', async () => {
        render(<UnderstandingGauge score={8} before={6} max={10} target={9} />);
        const knob = screen.getByTestId('gauge-knob');
        const deg = () => Number((knob.getAttribute('style') ?? '').match(/rotate\(([\d.]+)deg\)/)?.[1]);
        expect(deg()).toBeCloseTo(6 / 10 * 180, 0); // starts at the old score
        await settle();
        expect(deg()).toBeCloseTo(24 / 30 * 180, 0); // lands on the new one (8/10 of 30 bars = 24)
        expect(knob.getAttribute('style')).toContain('transition');
    });

    it('sparkles go off only when the target is reached, and all motion is motion-safe', async () => {
        const { unmount } = render(<UnderstandingGauge score={7} max={10} target={9} />);
        await settle();
        expect(screen.queryAllByTestId('gauge-spark')).toHaveLength(0);
        unmount();
        render(<UnderstandingGauge score={9} max={10} target={9} />);
        await settle();
        expect(screen.getAllByTestId('gauge-spark').length).toBeGreaterThan(3);
        const bare = (document.body.innerHTML.match(/(?<!motion-safe:)animate-plr-[a-z]+/g) ?? []);
        expect(bare).toEqual([]);
    });

    it('with no knob when the score is unknown, and the number counts up only where motion is welcome', async () => {
        render(<UnderstandingGauge score={null} max={10} />);
        await settle();
        expect(screen.queryByTestId('gauge-knob')).toBeNull();
        const { useCountUp, motionAllowed } = await import('../UnderstandingGauge');
        expect(motionAllowed()).toBe(false); // jsdom has no matchMedia: the final state is simply there
        expect(typeof useCountUp).toBe('function');
    });
});
