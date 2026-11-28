// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A3) — the blackboard's ONE source: the same 15 lines and the same turning
 * rule (a random first line, each line up for its reading time, never the same line twice in a row) on the production waiting screen
 * and on the recording screen's board.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_LINES, ChalkBoard, GRAIN, boardLineMs, nextBoardLine } from '../chalkBoard';
import { ShramSathiUnderstanding } from '../ShramSathiUnderstanding';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the blackboard\'s shared source', () => {
    it('the 15 founder-approved lines, word for word at both ends', () => {
        expect(BOARD_LINES).toHaveLength(15);
        expect(BOARD_LINES[0]).toBe('जे मोजता येतं, त्याचं नियोजन करता येतं — आणि आज तुम्ही शेतकाम मोजायला सुरुवात केली.');
        expect(BOARD_LINES[14]).toBe('आजचं छोटं मोजमाप, उद्या तुमच्या शेतीवरचं पूर्ण नियंत्रण देतं.');
        expect(GRAIN.startsWith('url("data:image/svg+xml')).toBe(true);
    });

    it('reading time: 2.2 s + 0.44 s a word, held between 4.2 s and 9 s', () => {
        BOARD_LINES.forEach((line, i) => {
            const words = line.trim().split(/\s+/).length;
            expect(boardLineMs(i)).toBe(Math.min(9000, Math.max(4200, 2200 + words * 440)));
            expect(boardLineMs(i)).toBeGreaterThanOrEqual(4200);
            expect(boardLineMs(i)).toBeLessThanOrEqual(9000);
        });
    });

    it('the next line is never the same line, whatever the random pick', () => {
        for (let cur = 0; cur < BOARD_LINES.length; cur++) {
            for (let k = 0; k < 100; k++) {
                const n = nextBoardLine(cur, () => k / 100);
                expect(n).not.toBe(cur);
                expect(n).toBeGreaterThanOrEqual(0);
                expect(n).toBeLessThan(BOARD_LINES.length);
            }
        }
    });

    it('the production waiting screen turns the SAME shared lines by the same rule', () => {
        vi.spyOn(Math, 'random').mockReturnValue(3 / 15 + 0.001);
        const { container } = render(<ShramSathiUnderstanding />);
        const quote = () => container.querySelector('.su-quote')?.textContent;
        expect(quote()).toBe(BOARD_LINES[3]);
        advance(boardLineMs(3));
        expect(quote()).toBe(BOARD_LINES[4]);
    });

    it('the recording screen\'s board shows and turns the same lines', () => {
        vi.spyOn(Math, 'random').mockReturnValue(3 / 15 + 0.001);
        render(<ChalkBoard />);
        expect(screen.getByTestId('chalk-board-line')).toHaveTextContent(BOARD_LINES[3]);
        advance(boardLineMs(3));
        expect(screen.getByTestId('chalk-board-line')).toHaveTextContent(BOARD_LINES[4]);
    });
});
