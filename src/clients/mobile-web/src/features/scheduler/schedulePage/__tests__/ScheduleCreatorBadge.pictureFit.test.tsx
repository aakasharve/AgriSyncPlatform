// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - gate 45 (found in the real browser): a wide logo in the square place was cut in half by
 * `object-cover`. A square place now shows the whole picture on white; a person's round photo still fills the circle.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleCreatorBadge } from '../ScheduleCreatorBadge';

afterEach(cleanup);

describe('ScheduleCreatorBadge picture fit', () => {
    it('a square place shows the whole picture (contain, white, small padding)', () => {
        render(<ScheduleCreatorBadge imageUrl="blob:logo" shape="square" tone="light" />);
        const img = screen.getByTestId('sched-badge').querySelector('img') as HTMLImageElement;
        expect(img.className).toContain('object-contain');
        expect(img.className).toContain('bg-white');
        expect(img.className).not.toContain('object-cover');
    });

    it('a round place fills the circle with the person\'s face (cover)', () => {
        render(<ScheduleCreatorBadge imageUrl="blob:face" shape="round" tone="light" />);
        const img = screen.getByTestId('sched-badge').querySelector('img') as HTMLImageElement;
        expect(img.className).toContain('object-cover');
        expect(img.className).not.toContain('object-contain');
    });

    it('with no picture there is no image at all (leaf or letter)', () => {
        render(<ScheduleCreatorBadge shape="square" tone="light" />);
        expect(screen.getByTestId('sched-badge').querySelector('img')).toBeNull();
    });
});
