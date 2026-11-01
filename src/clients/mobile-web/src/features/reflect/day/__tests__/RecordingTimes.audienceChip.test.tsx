// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 1 (L5) — the lock chip on a recording in the holder's day view tells it honestly: on a
 * record someone else made, "Only me" keeps its maker ("फक्त मी व नोंद करणारा"); on his own, "फक्त मी".
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const session = vi.hoisted(() => ({ id: 'holder' as string | null }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => session.id }));
vi.mock('../RecordingParts', () => ({
    ListenControl: () => null, LogPhotos: () => null, StatusChip: () => null,
    useReflectCopy: () => ({ edit: 'बदला', nothingUnderstood: '—' }),
}));
vi.mock('../../../logs/components/voiceResult/DayParts', () => ({
    AddedRow: () => null, BlockerRow: () => null, LegacyNote: () => null, TypedTag: () => null, WhoChip: () => null,
}));
vi.mock('../../../logs/components/voiceResult/ProductRows', () => ({ ProductBoxCard: () => null }));

import { RecordingInline } from '../RecordingTimes';
import type { DayRecording } from '../dayRecordings';
import type { DayListen } from '../useDayListen';

const rec = (maker: string): DayRecording => ({
    key: 'k', logs: [], plotNames: [], cropColor: '', at: 0,
    view: { id: 'v', entries: [], blockers: [], who: '', typed: true, confirmed: false, legacyPartial: false, logIds: [] },
    voiceLog: { id: 'l1', audience: 'OnlyMe', meta: { createdByOperatorId: maker } },
} as unknown as DayRecording);

afterEach(() => cleanup());

describe('the recording\'s lock chip (fix pass 1, L5)', () => {
    it('says the maker keeps it on someone else\'s record, and "फक्त मी" on his own', () => {
        render(<RecordingInline rec={rec('mukadam')} listen={{} as DayListen} testId="r" />);
        expect(screen.getByTestId('r-audience')).toHaveTextContent('फक्त मी व नोंद करणारा');
        cleanup();
        render(<RecordingInline rec={rec('holder')} listen={{} as DayListen} testId="r" />);
        expect(screen.getByTestId('r-audience').textContent).toBe('फक्त मी');
    });
});
