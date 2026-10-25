// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The crop cards on the log home screen (PLR-D5, founder brief 2026-10-24): one card = two zones + one
 * touch target. The photograph has NOTHING on it; the name sits big in its own panel; a small outlined
 * finger-tap cue is a hint only, because the WHOLE card is the button.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CropSelector from '../CropSelector';
import type { CropProfile } from '../../../../types';

afterEach(cleanup);

const NAMES: [string, string, string, string[]][] = [
    ['grape', 'द्राक्ष', 'Grape', ['सोनाका', 'थॉमसन']], ['cane', 'ऊस', 'Sugarcane', ['ऊस १', 'ऊस २']], ['pom', 'डाळिंब', 'Pomegranate', ['डाळिंब १']],
    ['onion', 'कांदा', 'Onion', ['कांदा १']], ['tomato', 'टोमॅटो', 'Tomato', ['टोमॅटो १']],
];
const farm = (n: number) => NAMES.slice(0, n).map(([id, name, icon, plots]) => ({ id, name, iconName: icon, color: 'emerald', plots: plots.map((p, i) => ({ id: `${id}-${i + 1}`, name: p })) }) as unknown as CropProfile);
const home = (n: number, onSel = () => {}) => render(
    <CropSelector mode="log" layout="stepper" crops={farm(n)} selectedCrops={[]} selectedPlots={{}} onSelectionChange={onSel}
        stepper={{ labels: { entireFarmShort: 'प्लॉटला न जोडलेली कामे', entireFarmHelp: 'LONG-HELP' } }} />,
);

describe('one crop card: two zones, one touch target', () => {
    it('the photograph zone holds ONLY the photograph: no text, no button, no scrim over it', () => {
        home(3);
        const photo = screen.getByTestId('flow-crop-grape-photo');
        expect(photo.textContent).toBe('');
        expect(photo.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
        expect(photo.querySelector('img')?.getAttribute('src')).toBe('/images/crops/Black Grapes.jpg');
        expect(photo.innerHTML).not.toContain('bg-gradient-to-t'); // no dark gradient laid over the picture for text
        expect(photo.querySelector('img')?.getAttribute('alt')).toBe(''); // decorative: the card's own name labels it
    });

    it('the name is BIG and bold in its own panel, the varieties smaller beneath, the cue small and outlined', () => {
        home(3);
        const panel = screen.getByTestId('flow-crop-grape-panel');
        expect(within(panel).getByTestId('flow-crop-grape-name').textContent).toBe('द्राक्ष');
        expect(within(panel).getByTestId('flow-crop-grape-name').className).toContain('text-[30px]');
        expect(within(panel).getByTestId('flow-crop-grape-name').className).toContain('font-extrabold');
        expect(within(panel).getByTestId('flow-crop-grape-sub').textContent).toBe('सोनाका · थॉमसन');
        expect(within(panel).getByTestId('flow-crop-grape-sub').className).toContain('text-[16px]');
        const cue = within(panel).getByTestId('flow-crop-grape-cue');
        expect(cue.className).toContain('h-[46px]');
        expect(cue.className).toContain('border-emerald-200'); // a restrained outline, not a solid dark circle
        expect(cue.className).not.toContain('bg-emerald-700');
        expect(cue.getAttribute('aria-hidden')).toBe('true'); // a visual hint only
        // the name and the photograph never share a box
        expect(screen.getByTestId('flow-crop-grape-photo').contains(screen.getByTestId('flow-crop-grape-name'))).toBe(false);
    });

    it('the WHOLE card is one button with an accessible name; touching it selects that crop', () => {
        const onSel = vi.fn();
        home(3, onSel);
        const card = screen.getByTestId('flow-crop-cane');
        expect(card.tagName).toBe('BUTTON');
        expect(card.getAttribute('aria-label')).toBe('ऊस — ऊस १ · ऊस २');
        expect(card.className).toContain('focus-visible:ring-4'); // keyboard focus is visible
        expect(card.className).toContain('active:scale-[0.98]'); // a gentle pressed state
        fireEvent.click(screen.getByTestId('flow-crop-cane-name')); // touching the NAME (not the cue) works too
        expect(onSel).toHaveBeenCalledWith(['cane'], { cane: [] });
    });
});

describe('the four cards of the brief', () => {
    it('grapes, sugarcane, pomegranate and the entire farm, in the existing order, with their own words', () => {
        home(3);
        const grid = screen.getByTestId('flow-crop-grid');
        expect(Array.from(grid.children).map(c => c.getAttribute('data-testid'))).toEqual(['flow-crop-grape', 'flow-crop-cane', 'flow-crop-pom', 'flow-crop-whole-farm']);
        expect(screen.getByTestId('flow-crop-cane-sub').textContent).toBe('ऊस १ · ऊस २');
        expect(screen.getByTestId('flow-crop-pom-sub').textContent).toBe('डाळिंब १');
    });

    it('the entire-farm card is short: a name and one line, the farm picture, no paragraph on it', () => {
        home(3);
        expect(screen.getByTestId('flow-crop-whole-farm-name').textContent).toBe('Entire Farm'); // approved label (Marathi under a Marathi provider)
        expect(screen.getByTestId('flow-crop-whole-farm-sub').textContent).toBe('प्लॉटला न जोडलेली कामे');
        expect(screen.getByTestId('flow-crop-whole-farm-photo').querySelector('img')?.getAttribute('src')).toBe('/images/farm/entire-farm.svg');
        expect(screen.getByTestId('flow-crop-whole-farm').textContent).not.toContain('LONG-HELP'); // the long meaning waits for the next screen
    });
});

describe('responsive grid', () => {
    it('one column on a phone, two where there is room; an odd last card spans both so there is no blank hole', () => {
        home(3);
        const grid = screen.getByTestId('flow-crop-grid');
        expect(grid.className).toContain('grid-cols-1');
        expect(grid.className).toContain('min-[480px]:grid-cols-2');
        expect(screen.getByTestId('flow-crop-whole-farm').className).not.toContain('col-span-2'); // 3 crops + farm = 4: an even grid
        cleanup();
        home(2); // 2 crops + farm = 3: the farm card takes the last full row
        expect(screen.getByTestId('flow-crop-whole-farm').className).toContain('min-[480px]:col-span-2');
        cleanup();
        home(1);
        expect(screen.getByTestId('flow-crop-whole-farm').className).not.toContain('col-span-2');
    });

    it('layout is stable while images load: fixed photo height, lazy images below the first screen, no sideways scroll classes', () => {
        home(4);
        for (const id of ['grape', 'cane', 'pom', 'onion', 'whole-farm']) expect(screen.getByTestId(`flow-crop-${id}-photo`).className).toMatch(/h-\[\d+px\]/);
        expect(screen.getByTestId('flow-crop-grape-photo').querySelector('img')?.getAttribute('loading')).toBe('eager');
        expect(screen.getByTestId('flow-crop-pom-photo').querySelector('img')?.getAttribute('loading')).toBe('lazy');
        expect(screen.getByTestId('flow-crop-whole-farm-photo').querySelector('img')?.getAttribute('loading')).toBe('lazy');
        expect(screen.getByTestId('flow-step-crop').innerHTML).not.toContain('overflow-x-auto');
    });

    it('each photo keeps its subject in frame with a crop-specific focal point', () => {
        home(3);
        expect((screen.getByTestId('flow-crop-grape-photo').querySelector('img') as HTMLImageElement).style.objectPosition).toBe('50% 35%');
        expect((screen.getByTestId('flow-crop-whole-farm-photo').querySelector('img') as HTMLImageElement).style.objectPosition).toBe('50% 60%');
    });
});

describe('calm motion', () => {
    it('a soft staggered entrance and a tiny tap-cue nudge, all motion-safe; no glow or sweep', () => {
        home(3);
        const cards = ['grape', 'cane', 'pom'].map(id => screen.getByTestId(`flow-crop-${id}`));
        expect(cards.map(c => c.style.animationDelay)).toEqual(['0ms', '80ms', '160ms']);
        cards.forEach(c => expect(c.className).toContain('motion-safe:animate-plr-rise'));
        const html = screen.getByTestId('flow-step-crop').innerHTML;
        expect(html).not.toContain('plr-sheen');
        expect(html).not.toContain('plr-ken');
        expect(html).not.toContain('plr-glow');
        const bare = (html.match(/(?<!motion-safe:)animate-plr-[a-z]+/g) ?? []);
        expect(bare).toEqual([]);
    });
});
