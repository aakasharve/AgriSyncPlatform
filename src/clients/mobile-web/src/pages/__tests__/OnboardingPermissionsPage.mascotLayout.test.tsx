// @vitest-environment jsdom
/**
 * First-run screen "फोनमधल्या कोणत्या गोष्टी लागतील" (spec: 2026-08-25-prod-cutover-waves,
 * founder report on APK 1.0.14): the pointing farmer sat BEHIND the permission cards - his
 * head was blurred behind the साठवण (Storage) card - and his lower half behind the button.
 *
 * Cause: he was positioned against the SCREEN bottom (`absolute bottom-[96px]`), independent
 * of where the cards end, so on a phone whose cards reach low enough he slid under them.
 *
 * HONESTY NOTE: jsdom has no layout engine, so this cannot measure overlap. It pins the
 * STRUCTURE that makes overlap impossible: he lives in his own in-flow slot placed AFTER the
 * card list and BEFORE the button dock; the slot takes only the space the cards leave (it can
 * shrink to nothing); the image never grows past the slot; the card list does not claim that
 * space; and a slot under 120px hides him. Real proof is the browser measurement
 * (getBoundingClientRect intersection = 0 at 360x640..412x915, text 1.0 and 1.3).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../shared/hooks/useUiPref', () => ({
    useUiPref: () => [false, vi.fn()] as const,
}));
vi.mock('../../features/consent/separation/devicePermissions', () => ({
    readDevicePermission: vi.fn(async () => 'prompt'),
}));

import OnboardingPermissionsPage from '../OnboardingPermissionsPage';

afterEach(cleanup);

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

function mount() {
    const { container } = render(<OnboardingPermissionsPage onComplete={vi.fn()} />);
    const img = container.querySelector('img[src="/brand/farmer-point.webp"]');
    expect(img, 'the pointing farmer must still be on the screen').not.toBeNull();
    const cards = container.querySelector('[class*="rounded-[18px]"]');
    const cardList = cards?.closest('.overflow-y-auto') ?? null;
    const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('समजलं, पुढे चला'));
    return { container, img: img!, slot: img!.parentElement!, cardList, button: button! };
}

describe('OnboardingPermissionsPage — the farmer never sits over the cards or the button', () => {
    it('he is in his own in-flow slot, not pinned to the screen bottom', () => {
        const { slot } = mount();
        expect(classes(slot)).not.toContain('absolute');
        expect(classes(slot).some(c => c.startsWith('bottom-'))).toBe(false);
        // Takes only the space left over, and may shrink to nothing.
        expect(classes(slot)).toContain('flex-1');
        expect(classes(slot)).toContain('min-h-0');
    });

    it('the slot sits AFTER the card list and BEFORE the button, as siblings in the page column', () => {
        const { slot, cardList, button } = mount();
        expect(cardList).not.toBeNull();
        expect(cardList!.parentElement).toBe(slot.parentElement);
        const order = Array.from(slot.parentElement!.children);
        const buttonDock = order.find(child => child.contains(button))!;
        expect(order.indexOf(cardList!)).toBeLessThan(order.indexOf(slot));
        expect(order.indexOf(slot)).toBeLessThan(order.indexOf(buttonDock));
    });

    it('the card list keeps its own height instead of claiming the free space', () => {
        const { cardList } = mount();
        expect(classes(cardList)).not.toContain('flex-1');
        expect(classes(cardList)).toContain('min-h-0'); // still scrolls on short screens
    });

    it('the image is bounded by the slot (never taller than the space it was given)', () => {
        const { img } = mount();
        expect(classes(img)).toContain('max-h-full');
        expect(classes(img)).toContain('object-contain');
    });

    it('a slot under 120px hides him rather than drawing a sliver', () => {
        const { container, slot, img } = mount();
        expect(classes(slot)).toContain('cs-mascot-slot');
        expect(classes(img)).toContain('cs-mascot-img');
        const css = Array.from(container.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n');
        expect(css).toMatch(/\.cs-mascot-slot\s*\{\s*container-type:\s*size\s*\}/);
        expect(css).toMatch(/@container\s*\(max-height:\s*120px\)\s*\{\s*\.cs-mascot-img\s*\{\s*display:\s*none\s*\}\s*\}/);
    });
});
