// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (UI-9a, redesign item 9; founder 2026-11-21: "only with LOGO")
 *
 * A crop whose photo is missing, or did not load, shows the app's own LOGO mark and nothing else: never an emoji, never a leaf or an
 * emoji on a coloured square. `CropSymbol` is drawn in Setup's add-plot door (CropSelector), the saved screen and the cost analysis.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CROP_SYMBOL_LOGO, CropSymbol } from '../CropSelector';
import { cropImageUrl } from '../cropImage';

// Any emoji, pictograph or dingbat (the old fallbacks were grapes, sugarcane, cloud, wheat, onion, sprout, sunflower, tree and house).
const EMOJI = /\p{Extended_Pictographic}/u;

describe('CropSymbol - the logo is the only fallback (item 9)', () => {
    afterEach(cleanup);

    it('a crop with a photo draws the photo, no logo', () => {
        expect(cropImageUrl('Grape')).toBeTruthy(); // the premise: the app carries a photo of grapes
        const { container } = render(<CropSymbol name="Grape" size="md" />);
        const imgs = container.querySelectorAll('img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0]).toHaveAttribute('src', cropImageUrl('Grape'));
        expect(screen.queryByTestId('crop-symbol-logo')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('a photo that fails to load is replaced by the logo image, never an emoji', () => {
        const { container } = render(<CropSymbol name="Grape" size="md" />);
        fireEvent.error(container.querySelector('img')!);
        const logo = screen.getByTestId('crop-symbol-logo');
        expect(logo.tagName).toBe('IMG');
        expect(logo).toHaveAttribute('src', CROP_SYMBOL_LOGO);
        expect(container.querySelectorAll('img')).toHaveLength(1);
        // no emoji span (the old fallback), no text at all, no emoji anywhere in the markup
        expect(container.querySelector('span')).toBeNull();
        expect(container.textContent).toBe('');
        expect(EMOJI.test(container.innerHTML)).toBe(false);
    });

    it.each(['Sprout', 'Warehouse', 'Flower2', 'Trees', 'Cotton', 'My own crop'])('"%s" with no picture at all is the logo, never an emoji', name => {
        // the premise: these names have no photo in the app, so the old code drew an emoji span for them
        expect(cropImageUrl(name)).toBeNull();
        const { container } = render(<CropSymbol name={name} size="lg" />);
        expect(screen.getByTestId('crop-symbol-logo')).toHaveAttribute('src', CROP_SYMBOL_LOGO);
        expect(container.querySelector('[role="img"]:not(img)')).toBeNull();
        expect(container.textContent).toBe('');
        expect(EMOJI.test(container.innerHTML)).toBe(false);
    });

    it('the logo mark is the app\'s own shield (the one the farm name board draws), not the wide wordmark', () => {
        expect(CROP_SYMBOL_LOGO).toBe('/brand/logo-mark.webp');
        render(<CropSymbol name="Warehouse" size="xl" />);
        expect(screen.getByTestId('crop-symbol-logo').getAttribute('src')).not.toBe('/logo.png');
    });

    it('the logo keeps the symbol\'s size and sits on no coloured square', () => {
        const sizes: Array<['xs' | 'sm' | 'md' | 'lg' | 'xl', string]> = [['xs', 'w-4'], ['sm', 'w-6'], ['md', 'w-10'], ['lg', 'w-16'], ['xl', 'w-20']];
        for (const [size, w] of sizes) {
            const { unmount } = render(<CropSymbol name="Warehouse" size={size} />);
            const logo = screen.getByTestId('crop-symbol-logo');
            expect(logo.className).toContain(w);
            expect(logo.className).toContain('object-contain');
            expect(logo.className).not.toMatch(/\bbg-/);
            expect(logo.parentElement?.className ?? '').not.toMatch(/\bbg-(?!slate-50)/);
            unmount();
        }
    });

    it('another crop on the same mounted symbol gets its own photo tried (a failure is remembered for that photo only)', () => {
        const { container, rerender } = render(<CropSymbol name="Grape" size="md" />);
        fireEvent.error(container.querySelector('img')!);
        expect(screen.getByTestId('crop-symbol-logo')).toBeInTheDocument();
        rerender(<CropSymbol name="Sugarcane" size="md" />);
        expect(screen.queryByTestId('crop-symbol-logo')).toBeNull();
        expect(container.querySelector('img')).toHaveAttribute('src', cropImageUrl('Sugarcane'));
    });

    it('its accessible name stays the crop\'s name', () => {
        render(<CropSymbol name="Warehouse" size="md" />);
        expect(screen.getByAltText('Warehouse')).toBe(screen.getByTestId('crop-symbol-logo'));
    });
});
