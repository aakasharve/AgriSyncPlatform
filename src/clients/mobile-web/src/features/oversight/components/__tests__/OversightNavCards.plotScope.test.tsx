// @vitest-environment jsdom
/**
 * spec: plr-d10 lane MU-4 (orchestrator call 8) — the overview a person who covers CHOSEN plots opens shows only his
 * plots (the server sends nothing else and the phone keeps nothing else, `plotScopePurge`), so its card must not say
 * "पूर्ण शेती" to him. A single-farm owner's card stays exactly as it was (MU design acceptance A).
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OversightNavCards from '../OversightNavCards';

afterEach(cleanup);

describe('the overview card for a person who covers chosen plots', () => {
    it('reads "माझ्या प्लॉटचा आढावा", never "पूर्ण शेतीचा आढावा"', () => {
        render(<OversightNavCards language="mr" view="reflect" onChange={vi.fn()} plotsOnly />);
        const card = screen.getByTestId('oversight-nav-card-reflect');
        expect(card.textContent).toContain('माझ्या प्लॉटचा आढावा');
        expect(card.textContent).not.toContain('पूर्ण शेती');
    });

    it('reads its English twin in English mode only', () => {
        render(<OversightNavCards language="en" view="log" onChange={vi.fn()} plotsOnly />);
        const card = screen.getByTestId('oversight-nav-card-reflect');
        expect(card.textContent).toContain('My plots overview');
        expect(card.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('stays exactly as it was for everyone else (the single-farm owner sees no change)', () => {
        render(<OversightNavCards language="mr" view="reflect" onChange={vi.fn()} />);
        expect(screen.getByTestId('oversight-nav-card-reflect').textContent).toContain('पूर्ण शेतीचा आढावा');
    });
});
