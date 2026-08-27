// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T2 — finding B1, second half.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The save path learned to tell the truth about a log it could not queue, and
 * said so in a toast that self-destructs. The "Saved to Ledger" panel behind
 * that toast persists until the farmer navigates away, so the reassuring half of
 * the story outlived the honest half on the exact screen a farmer uses to decide
 * whether their day is recorded. `LastSavedLogSummaryItem.syncQueued` carries
 * the fact; this badge renders it.
 *
 * THE PROPERTY UNDER TEST IS THE THIRD VALUE. `syncQueued` is
 * `boolean | null` and `null` means demo mode — no enqueue was attempted, so
 * there is no evidence either way. `{item.syncQueued && ...}` or
 * `{!item.syncQueued && ...}` would silently convert "I don't know" into a
 * claim; the second one would tell a demo user their record had failed. That is
 * why the guard lives inside the component and why it is `!== false`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { t as translate, type Language } from '../../../i18n/translations';

const langRef = { current: 'mr' as Language };

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

import { NotQueuedForServerBadge } from '../mainView';
import { SYNC_HONESTY_I18N_KEYS } from '../../../features/sync/status/syncHonestyState';

afterEach(() => {
    cleanup();
    langRef.current = 'mr';
});

describe('NotQueuedForServerBadge — the durable half of the skipped-save truth', () => {
    it('says the record is on the phone when it could not be queued', () => {
        render(<NotQueuedForServerBadge syncQueued={false} />);

        // The reassurance LEADS, then the news — and BOTH halves are now in
        // the farmer's language. The tail used to be a hardcoded English
        // fragment, so this assertion could match `/cannot be sent/` while the
        // farmer read one sentence in two scripts. Pinning the composed
        // sentence is what makes that unrepeatable.
        expect(
            screen.getByText(
                `${translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')} — ${translate('sync.notFiledBadgeTail', 'mr')}`,
                { selector: 'p' },
            ),
        ).toBeInTheDocument();
    });

    it('says nothing at all when the log WAS queued', () => {
        const { container } = render(<NotQueuedForServerBadge syncQueued />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says nothing when there is no evidence either way (demo mode)', () => {
        // `null`, not `false`. A falsy check here would tell a demo user their
        // record had failed to send, which is a fabricated claim in the
        // opposite direction from the one this task removed (`P4`).
        const { container } = render(<NotQueuedForServerBadge syncQueued={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says nothing for an older summary that carries no field at all', () => {
        // Absence of evidence must never be read as evidence — the same
        // discipline `UpdateLog`'s `?? 0` follows on the edit path.
        const { container } = render(<NotQueuedForServerBadge syncQueued={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('follows the farmer language rather than hardcoding one script', () => {
        langRef.current = 'en';

        render(<NotQueuedForServerBadge syncQueued={false} />);

        expect(
            screen.getByText(
                `${translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en')} — ${translate('sync.notFiledBadgeTail', 'en')}`,
                { selector: 'p' },
            ),
        ).toBeInTheDocument();
    });
});
