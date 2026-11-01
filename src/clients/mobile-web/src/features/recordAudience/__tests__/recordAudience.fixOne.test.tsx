// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 1 —
 *   L1  the audience sheet opens over the whole screen: rendered through a portal to document.body, never inside a
 *       card whose backdrop blur makes it the containing block of anything `fixed` (the money book's सविस्तर view);
 *   L5  "Selected" on someone else's record says its maker keeps seeing it, as "Only me" already did.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));
vi.mock('../../../core/navigation/useBackDismiss', () => ({ useBackDismiss: () => undefined }));
// Fix pass 2 - the row is the registrant's alone; these facts are about the sheet, so he is the registrant here.
vi.mock('../recordHolder', () => ({ useIsFarmRegistrant: () => true }));
vi.mock('../recordAudienceLocal', () => ({
    loadChoosablePeople: vi.fn(async () => []),
    chooseAudience: vi.fn(async () => undefined),
}));

import { AudienceRow } from '../AudienceRow';
import { audienceCopy } from '../audienceCopy';

const props = (madeBySomeoneElse: boolean) => ({
    kind: 'CostEntry' as const, recordIds: ['r1'], farmId: 'f1', selfUserId: 'me', audience: 'Team' as const,
    chosen: [], madeBySomeoneElse, testId: 'aud',
});

afterEach(() => cleanup());

describe('the audience sheet (fix pass 1)', () => {
    it('L1 — opens on document.body even from inside a blurred card in a list', () => {
        render(
            <div data-testid="list">
                <div className="backdrop-blur-md" data-testid="card"><AudienceRow {...props(false)} /></div>
            </div>,
        );
        fireEvent.click(screen.getByTestId('aud'));
        const sheet = screen.getByTestId('aud-sheet');
        expect(sheet.parentElement).toBe(document.body);
        expect(screen.getByTestId('card')).not.toContainElement(sheet);
    });

    it('L5 — "Selected" on someone else\'s record names its maker; on his own it does not', () => {
        const mr = audienceCopy('mr');
        render(<AudienceRow {...props(true)} />);
        fireEvent.click(screen.getByTestId('aud'));
        expect(screen.getByTestId('aud-choice-Selected')).toHaveTextContent(mr.selectedAndMakerHint);
        expect(mr.selectedAndMakerHint).toBe('तुम्ही निवडलेले लोक, तुम्ही आणि ज्यांनी ही नोंद केली ते');
        expect(audienceCopy('en').selectedAndMakerHint).toBe('The people you choose, you, and the person who recorded it');
        cleanup();

        render(<AudienceRow {...props(false)} />);
        fireEvent.click(screen.getByTestId('aud'));
        expect(screen.getByTestId('aud-choice-Selected')).toHaveTextContent(mr.selectedHint);
        expect(screen.getByTestId('aud-choice-Selected')).not.toHaveTextContent('नोंद केली');
    });
});
