// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-27, round 3 — I13-V2-m7) — the "not understood" card
 * speaks ONE language. Its hint under the phrase existed in English only, so round 2 hid it from a Marathi user;
 * now he gets it in Marathi. An English user reads English only — no Marathi line stacked above the English one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { lang } = vi.hoisted(() => ({ lang: { value: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
}));

import UnclearSegmentCard from '../UnclearSegmentCard';
import type { UnclearSegment } from '../../../../features/logs/logs.types';

afterEach(() => { cleanup(); lang.value = 'mr'; });

const segment = {
    id: 's1', rawText: 'काहीतरी', reason: 'incomplete_sentence', confidence: 0.3,
    userMessage: 'वाक्य अपूर्ण वाटतं', userMessageEn: 'Sentence seems incomplete',
} as unknown as UnclearSegment;
const mount = () => render(<UnclearSegmentCard segment={segment} onRelog={vi.fn()} onManualEdit={vi.fn()} onDismiss={vi.fn()} />);

describe('UnclearSegmentCard — one language', () => {
    it('Marathi: the hint is shown, in Marathi; no English letter anywhere', () => {
        const { container } = mount();
        expect(screen.getByTestId('unclear-suggestion').textContent).toBe('काय केलं, किती, कधी — हे सांगा');
        expect(screen.getByTestId('unclear-said').textContent?.trim()).toBe('वाक्य अपूर्ण वाटतं');
        const tooltips = [...container.querySelectorAll('[title]')].map(el => el.getAttribute('title')).join(' ');
        expect(`${container.textContent} ${tooltips}`).not.toMatch(/[A-Za-z]/);
    });

    it('English: the English line ONLY (no Marathi above it), the English hint, English buttons', () => {
        lang.value = 'en';
        const { container } = mount();
        expect(screen.getByTestId('unclear-said').textContent?.trim()).toBe('Sentence seems incomplete');
        expect(container.textContent).not.toContain('वाक्य अपूर्ण वाटतं');
        expect(screen.getByTestId('unclear-suggestion').textContent).toBe('Include: काय केलं, किती, कधी');
        expect(container.textContent).toContain('Say again');
    });
});
