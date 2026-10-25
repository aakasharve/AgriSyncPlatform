// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Setup Hub icon: a plain round settings button (the royal treatment belongs to the nameboard alone); a tap plays a press + ripple, and every
 * further tap plays it again.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SetupHubIcon from '../SetupHubIcon';

afterEach(cleanup);

describe('SetupHubIcon', () => {
    it('a round button with the standard gear icon, and no tap effect until it is tapped', () => {
        render(<SetupHubIcon tap={0} />);
        expect(document.querySelector('[data-nav-icon="settings"]')).toBeTruthy();
        expect(screen.getByTestId('setup-hub-frame').className).toContain('rounded-full');
        expect(screen.queryByTestId('setup-hub-ripple')).toBeNull();
    });

    it('a tap adds the ripple; the next tap replays it (a new element, so the animation restarts)', () => {
        const { rerender } = render(<SetupHubIcon tap={1} />);
        const first = screen.getByTestId('setup-hub-ripple');
        rerender(<SetupHubIcon tap={2} />);
        expect(screen.getByTestId('setup-hub-ripple')).not.toBe(first);
    });

    it('is not the nameboard\'s royal treatment: no brass, no chamfer, no gradient, still when idle', () => {
        const { container } = render(<SetupHubIcon tap={0} />);
        const frame = screen.getByTestId('setup-hub-frame');
        expect(frame.getAttribute('style') ?? '').not.toContain('polygon(');
        expect(frame.className).not.toContain('gradient');
        expect(container.innerHTML).not.toContain('D9B45B');
        expect(container.innerHTML).not.toContain('animate-hub-press'); // still until tapped
    });
});
