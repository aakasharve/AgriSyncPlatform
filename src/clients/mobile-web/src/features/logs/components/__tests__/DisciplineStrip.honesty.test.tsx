// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H7; doctrine P4)
 *
 * The streak strip shows right after a save, from the server's engagement snapshot, which is read ONCE when the screen opens. The
 * record he has just saved may not have reached the server yet, so that snapshot can say "streak 0" while he has plainly just told his
 * work. The old copy for 0 - "पुन्हा सुरुवात करूया" (let's start again) - then tells him he broke a chain he did not break. It is
 * gone: a streak of 0 draws no recognition line. The rest of the strip (the number, the chain, tomorrow's line, the total) is unchanged.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { t as translate } from '../../../../i18n/translations';

vi.mock('../../../../app/featureFlags', async (importActual) => {
    const actual = await importActual<typeof import('../../../../app/featureFlags')>();
    return { ...actual, FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, disciplineSystem: true } };
});
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
}));
const getFarmerEngagement = vi.hoisted(() => vi.fn());
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { getFarmerEngagement: (...args: unknown[]) => getFarmerEngagement(...args) } }));

import { DisciplineStrip } from '../DisciplineStrip';
import { useFarmerEngagement } from '../../hooks/useFarmerEngagement';
import type { FarmerEngagementDto } from '../../../../infrastructure/api/resources/DfesResource';

const snapshot = (streak: number): FarmerEngagementDto => ({
    currentStreak: streak, longestStreak: 4, totalShramPoints: 20, lastAccountedDate: '2026-11-17', totalRichDays: 5, unlockStatus: 'locked',
});

/** The strip as the saved screen feeds it: one fetch when it opens. */
const Opened: React.FC = () => {
    const { engagement } = useFarmerEngagement('farm-1');
    return <DisciplineStrip engagement={engagement} />;
};

beforeEach(() => { getFarmerEngagement.mockReset(); });
afterEach(cleanup);

describe('H7 - the strip never says "start again" from a snapshot that may predate the save', () => {
    it('a snapshot that missed the record just saved (streak 0): NO recognition line, and never पुन्हा सुरुवात', async () => {
        getFarmerEngagement.mockResolvedValue(snapshot(0));
        render(<Opened />);
        await waitFor(() => expect(screen.getByTestId('discipline-strip')).toBeInTheDocument());
        expect(screen.queryByTestId('discipline-recognition')).toBeNull();
        expect(screen.getByTestId('discipline-strip').textContent).not.toContain('पुन्हा सुरुवात');
    });

    it('the rest of the strip is untouched at streak 0: the number, tomorrow\'s dot and line, and the total', async () => {
        getFarmerEngagement.mockResolvedValue(snapshot(0));
        render(<Opened />);
        await waitFor(() => expect(screen.getByTestId('discipline-strip')).toBeInTheDocument());
        expect(screen.getByTestId('discipline-streak')).toHaveTextContent('०');
        expect(screen.getByTestId('discipline-tomorrow')).toBeInTheDocument();
        expect(screen.getByTestId('discipline-tomorrow-line')).toBeInTheDocument();
        expect(screen.getByTestId('discipline-points')).toHaveTextContent('२० श्रम-गुण');
    });

    it('a real streak still gets its warm line (1 and 2+ are unchanged)', async () => {
        getFarmerEngagement.mockResolvedValue(snapshot(1));
        const { unmount } = render(<Opened />);
        await waitFor(() => expect(screen.getByTestId('discipline-recognition')).toHaveTextContent('आजचं काम सांगितलं. उद्याही भेटूया.'));
        unmount();
        getFarmerEngagement.mockResolvedValue(snapshot(3));
        render(<Opened />);
        await waitFor(() => expect(screen.getByTestId('discipline-recognition')).toHaveTextContent('सलग ३ दिवस'));
    });
});
