// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1 — review finding F3.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `SyncIndicator` was rendered by NO test in this client. Every existing test
 * around the sync chip proves things about `deriveSyncHonestyState` (a pure
 * function) and about the strings in `i18n/translations.ts` (a data table).
 * Neither of them touches the one hop that actually reaches the farmer's eye:
 * the component that decides which of those strings to paint for which state.
 *
 * The concrete hole F3 named: re-wire `ON_PHONE` to the `ON_SERVER` label and
 * all 30 tests still passed — while the chip told a farmer holding an unsent
 * record that it had been sent. The wording tests locked the STRINGS; nothing
 * locked the PAIRING.
 *
 * So this file asserts the pairing, and deliberately NOT the literals:
 * `expect(text).toBe('पाठवलं ✓')` would go green on a mis-wire the day someone
 * "fixes" the label to match. Every expectation below is
 * `translate(SYNC_HONESTY_I18N_KEYS[state], language)` — the same lookup the
 * component is supposed to be doing — so the only way to satisfy it is to
 * actually do it.
 *
 * WHERE IT LIVES, AND WHY IT IS NOT NEXT TO THE COMPONENT
 * ------------------------------------------------------
 * `SyncIndicator.tsx` lives under `src/shared/components/ui/`, which is NOT one
 * of the nine roots of the WEB-LABOUR scoped suite this phase gates every
 * commit on (`test-severity-policy.md` section 1.1). A guard that does not run
 * in the gate is a guard nobody will see fail. The invariant is anyway owned by
 * the sync-honesty model — `SYNC_HONESTY_I18N_KEYS` is the single source of the
 * state -> label pairing and it lives here — so the test sits beside the rule
 * it protects and inside the suite that runs.
 *
 * THE LANGUAGE MOCK
 * -----------------
 * `useLanguage` throws outside a `LanguageProvider`, and the real provider
 * reaches Dexie through `useUiPref`. The stub below drives the language as data
 * while still calling the REAL `translate()` over the REAL translation table,
 * so every string this test compares is the shipped string — the same technique
 * the L5b harness used for this component.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { t as translate, type Language } from '../../../../i18n/translations';

const langRef = { current: 'mr' as Language };

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

import { SyncIndicator } from '../../../../shared/components/ui/SyncIndicator';
import { SYNC_HONESTY_I18N_KEYS, type SyncHonestyState } from '../syncHonestyState';

const STATES: SyncHonestyState[] = ['ON_PHONE', 'ON_SERVER', 'NEEDS_FIX'];
const LANGUAGES: Language[] = ['mr', 'en'];

/** The label the model says this state must show, in this language. */
const expectedLabel = (state: SyncHonestyState, language: Language): string =>
    translate(SYNC_HONESTY_I18N_KEYS[state], language);

/** The chip is one <button>; its text content is the whole visible label. */
const chip = (): HTMLElement => screen.getByTestId('chip-under-test');

afterEach(() => {
    cleanup();
    langRef.current = 'mr';
});

describe('SyncIndicator — the state the app derived is the label the farmer reads', () => {
    for (const language of LANGUAGES) {
        for (const state of STATES) {
            it(`${language}: ${state} renders its OWN label, not another state's`, () => {
                langRef.current = language;

                render(<SyncIndicator status={state} testId="chip-under-test" />);

                const mine = expectedLabel(state, language);
                expect(chip()).toHaveTextContent(mine);

                // The half that actually bites. A mis-wire produces a perfectly
                // valid label — just the wrong one — so "contains a real string"
                // proves nothing. Every OTHER state's label must be absent.
                for (const other of STATES) {
                    if (other === state) continue;
                    expect(chip()).not.toHaveTextContent(expectedLabel(other, language));
                }
            });
        }
    }

    it('the accessible name says the same thing as the visible text', () => {
        // The chip sets aria-label, which OVERRIDES its subtree for a screen
        // reader. Two independent reads of the same lookup means two chances to
        // disagree, and the one a blind farmer hears is the one no sighted
        // reviewer would ever catch.
        for (const state of STATES) {
            cleanup();
            render(<SyncIndicator status={state} testId="chip-under-test" />);

            const label = expectedLabel(state, 'mr');
            expect(chip()).toHaveTextContent(label);
            expect(chip()).toHaveAttribute('aria-label', label);
        }
    });

    it('the three states never collapse onto one label', () => {
        // If two states resolved to the same string the pairing test above
        // would still pass for one of them, and the chip would confidently
        // render an indistinguishable claim. Rendered, not looked up.
        const rendered = STATES.map((state) => {
            cleanup();
            render(<SyncIndicator status={state} testId="chip-under-test" />);
            return chip().textContent;
        });

        expect(new Set(rendered).size).toBe(STATES.length);
    });
});

describe('SyncIndicator — the badge beside the label', () => {
    // Also previously unrendered by any test. `useSyncQueueStatus.failedCount`
    // now means "rows that need the farmer" (T3, ruling R12), so this number is
    // the visible half of that redefinition.
    it('shows the count that needs the farmer, in red, when there is one', () => {
        render(<SyncIndicator status="NEEDS_FIX" pendingCount={4} failedCount={2} testId="chip-under-test" />);

        const badge = chip().querySelector('span.absolute');
        expect(badge).not.toBeNull();
        expect(badge).toHaveTextContent('2');
        expect(badge?.className).toContain('bg-red-500');
    });

    it('falls back to the amber pending count when nothing needs the farmer', () => {
        render(<SyncIndicator status="ON_PHONE" pendingCount={4} failedCount={0} testId="chip-under-test" />);

        const badge = chip().querySelector('span.absolute');
        expect(badge).toHaveTextContent('4');
        expect(badge?.className).toContain('bg-amber-500');
    });

    it('renders NO badge at all when both counts are zero', () => {
        // A "0" beside a settled chip was the visual form of the original
        // defect: a number with nothing behind it.
        render(<SyncIndicator status="ON_SERVER" pendingCount={0} failedCount={0} testId="chip-under-test" />);

        expect(chip().querySelector('span.absolute')).toBeNull();
        expect(chip()).not.toHaveTextContent('0');
    });
});
