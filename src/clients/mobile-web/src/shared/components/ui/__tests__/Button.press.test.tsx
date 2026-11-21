// @vitest-environment jsdom
/**
 * FEEL-1 — the shared Button's press feel.
 *
 * The visible press (a 97% shrink over 100 ms) is CSS, so what is pinned here is the contract the CSS and the haptic
 * listener rely on: the Button wears the shared `press-feel` class, is a real `<button>` the listener recognises as a press,
 * stops being one when disabled or loading, and buzzes nothing just by being rendered.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/haptics', () => ({
    Haptics: { impact: vi.fn(), notification: vi.fn(), selectionChanged: vi.fn() },
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

import Button from '../Button';
import { classifyPress } from '../../../utils/pressFeel';

let vib: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vib = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vib, configurable: true, writable: true });
});
afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
});

describe('Button press feel', () => {
    it('wears the shared press-feel class and no longer carries its own 96% shrink or 300 ms transition', () => {
        render(<Button>Save</Button>);
        const cls = screen.getByRole('button', { name: 'Save' }).className;
        expect(cls).toContain('press-feel');
        expect(cls).not.toContain('active:scale-[0.96]');
        expect(cls).not.toContain('duration-300');
    });

    it('is a press to the haptic listener', () => {
        render(<Button>Save</Button>);
        expect(classifyPress(screen.getByRole('button', { name: 'Save' }))).toBe('light');
    });

    it('is not a press while disabled, and not while loading', () => {
        render(<><Button disabled>Off</Button><Button isLoading>Busy</Button></>);
        expect(classifyPress(screen.getByRole('button', { name: 'Off' }))).toBeNull();
        expect(classifyPress(screen.getByRole('button', { name: /Busy/ }))).toBeNull();
    });

    it('buzzes nothing when it is merely rendered or re-rendered', () => {
        const { rerender } = render(<Button>Save</Button>);
        rerender(<Button>Save again</Button>);
        expect(vib).not.toHaveBeenCalled();
    });

    it('keeps its other classes, so the look is unchanged apart from the press', () => {
        render(<Button variant="danger" className="extra">Delete</Button>);
        const cls = screen.getByRole('button', { name: 'Delete' }).className;
        expect(cls).toContain('rounded-2xl');
        expect(cls).toContain('from-red-500');
        expect(cls).toContain('extra');
    });
});
