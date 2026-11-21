// @vitest-environment jsdom
/**
 * FEEL-1 — the one press listener.
 *
 * It is installed once at the app root and decides, from the tapped element alone, whether a tap is a press (light) or a
 * choice (selection). These tests use the real haptics engine and a spy on `navigator.vibrate`, so what is asserted is
 * what a browser would be asked to do.
 *
 * The honesty rules, as tests:
 *   - only a real, trusted click counts: a script calling `.click()` is not a person tapping;
 *   - focus, key presses, scrolling and a bare pointer-down never buzz;
 *   - a disabled control, a non-control and anything opted out buzzes nothing;
 *   - a control that already fired its own haptic is not buzzed a second time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/haptics', () => ({
    Haptics: { impact: vi.fn(), notification: vi.fn(), selectionChanged: vi.fn() },
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

type PressModule = typeof import('../pressFeel');
type HapticsModule = typeof import('../haptics');
let press: PressModule;
let haptics: HapticsModule;
let vib: ReturnType<typeof vi.fn>;
let off: () => void;

const LIGHT = 10;
const SELECTION = 8;

function mount(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
}
const q = <T extends Element>(sel: string) => document.querySelector(sel) as T;
/** A click as a person's finger makes it: the listener is told to accept untrusted events only in tests. */
const tap = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    vib = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vib, configurable: true, writable: true });
    vi.resetModules();
    haptics = await import('../haptics');
    press = await import('../pressFeel');
    off = press.installPressFeel({ trustedOnly: false });
});

afterEach(() => {
    off();
    document.body.innerHTML = '';
    vi.useRealTimers();
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
});

describe('what a tap is', () => {
    it('a plain button is a light press', () => {
        mount('<button id="b">Save</button>');
        tap(q('#b'));
        expect(vib).toHaveBeenCalledTimes(1);
        expect(vib).toHaveBeenCalledWith(LIGHT);
    });

    it('a tap on something inside a button is a tap on the button', () => {
        mount('<button id="b"><span><i id="deep">icon</i></span></button>');
        tap(q('#deep'));
        expect(vib).toHaveBeenCalledWith(LIGHT);
    });

    it('a link with an address is a light press; an anchor with no address is not a control', () => {
        mount('<a id="a" href="/x">go</a><a id="n">nothing</a>');
        tap(q('#n'));
        expect(vib).not.toHaveBeenCalled();
        tap(q('#a'));
        expect(vib).toHaveBeenCalledWith(LIGHT);
    });

    it.each([
        ['aria-pressed', '<button id="c" aria-pressed="false">Wheat</button>'],
        ['aria-checked', '<div id="c" role="menuitemcheckbox" aria-checked="true">x</div>'],
        ['aria-selected', '<div id="c" role="option" aria-selected="false">x</div>'],
        ['role=tab', '<button id="c" role="tab">Plots</button>'],
        ['role=radio', '<div id="c" role="radio" tabindex="0">A</div>'],
        ['role=switch', '<button id="c" role="switch">on</button>'],
        ['a checkbox input', '<input id="c" type="checkbox">'],
        ['a radio input', '<input id="c" type="radio">'],
    ])('a choice (%s) is a selection, lighter than a press', (_n, html) => {
        mount(html);
        tap(q('#c'));
        expect(vib).toHaveBeenCalledTimes(1);
        expect(vib).toHaveBeenCalledWith(SELECTION);
    });

    it('a role=button element is a light press', () => {
        mount('<div id="c" role="button" tabindex="0">tap</div>');
        tap(q('#c'));
        expect(vib).toHaveBeenCalledWith(LIGHT);
    });
});

describe('what is never a press', () => {
    it('text, a heading, a plain div and a text field', () => {
        mount('<h1 id="h">Title</h1><div id="d">box</div><input id="t" type="text"><textarea id="x"></textarea>');
        for (const id of ['#h', '#d', '#t', '#x']) tap(q(id));
        expect(vib).not.toHaveBeenCalled();
    });

    it('a disabled button, and one marked aria-disabled', () => {
        mount('<button id="a" disabled>no</button><button id="b" aria-disabled="true">no</button>');
        tap(q('#a'));
        tap(q('#b'));
        expect(vib).not.toHaveBeenCalled();
    });

    it('anything inside a data-feel="off" area, or marked so itself', () => {
        mount('<div data-feel="off"><button id="a">x</button></div><button id="b" data-feel="off">y</button>');
        tap(q('#a'));
        tap(q('#b'));
        expect(vib).not.toHaveBeenCalled();
    });

    it('a click the page makes itself (script .click()) is not a person tapping, by default', () => {
        off();
        off = press.installPressFeel(); // trustedOnly defaults to true
        mount('<button id="b">x</button>');
        q<HTMLButtonElement>('#b').click();
        tap(q('#b'));
        expect(vib).not.toHaveBeenCalled();
    });
});

describe('passive events never buzz', () => {
    it('installing, then nothing happening, buzzes nothing', () => {
        mount('<button id="b">x</button>');
        vi.advanceTimersByTime(60_000);
        expect(vib).not.toHaveBeenCalled();
    });

    it('focus, key presses, scrolling and a bare pointer-down or pointer-up are not taps', () => {
        mount('<button id="b">x</button>');
        const b = q('#b');
        b.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        document.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('online'));
        expect(vib).not.toHaveBeenCalled();
    });
});

describe('one buzz per tap', () => {
    it('a control that fired its own haptic just now is not buzzed a second time', () => {
        mount('<button id="b">x</button>');
        haptics.hapticFeedback.medium();           // e.g. the bottom bar's own call, on pointer-down or click
        vib.mockClear();
        vi.advanceTimersByTime(100);               // past the 60 ms throttle, inside the press dedupe window
        tap(q('#b'));
        expect(vib).not.toHaveBeenCalled();
    });

    it('a tap long after the last buzz is felt', () => {
        mount('<button id="b">x</button>');
        haptics.hapticFeedback.medium();
        vib.mockClear();
        vi.advanceTimersByTime(2000);
        tap(q('#b'));
        expect(vib).toHaveBeenCalledTimes(1);
    });

    it('quick taps down a row of chips are each felt, not every other one', () => {
        mount('<button id="a" aria-pressed="false">a</button><button id="b" aria-pressed="false">b</button><button id="c" aria-pressed="false">c</button>');
        tap(q('#a'));
        vi.advanceTimersByTime(100);
        tap(q('#b'));
        vi.advanceTimersByTime(100);
        tap(q('#c'));
        expect(vib).toHaveBeenCalledTimes(3);
    });

    it('two taps in the same breath are one buzz', () => {
        mount('<button id="a">x</button><button id="b">y</button>');
        tap(q('#a'));
        vi.advanceTimersByTime(20);
        tap(q('#b'));
        expect(vib).toHaveBeenCalledTimes(1);
    });
});

describe('install and remove', () => {
    it('removing the listener stops all buzzing', () => {
        mount('<button id="b">x</button>');
        off();
        tap(q('#b'));
        expect(vib).not.toHaveBeenCalled();
    });

    it('classifyPress answers null for a missing target without throwing', () => {
        expect(press.classifyPress(null)).toBeNull();
        expect(press.classifyPress(document)).toBeNull();
    });
});
