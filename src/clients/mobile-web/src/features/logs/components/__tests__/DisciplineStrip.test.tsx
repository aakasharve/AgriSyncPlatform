// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { t as translate } from '../../../../i18n/translations';

const engagement = {
    currentStreak: 5,
    longestStreak: 9,
    totalShramPoints: 60,
    lastAccountedDate: '2026-07-11',
    totalRichDays: 12,
    unlockStatus: 'locked' as const,
};

async function loadStrip(disciplineSystem: boolean) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { disciplineSystem, understandingMeter: false, DwcChip: false },
    }));
    // The 2026-08-13 redesign gave the strip real copy ("दिवस सलग", the
    // come-back-tomorrow line), so it now reads from i18n like every other
    // DFES component. Same mock DayUnderstandingCard.test.tsx uses — real
    // Marathi strings, no provider needed.
    vi.doMock('../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({
            language: 'mr',
            setLanguage: () => {},
            t: (k: string) => translate(k, 'mr'),
        }),
    }));
    return import('../DisciplineStrip');
}

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('DisciplineStrip', () => {
    it('renders nothing when disciplineSystem flag is OFF', async () => {
        const { DisciplineStrip } = await loadStrip(false);
        const { container } = render(<DisciplineStrip engagement={engagement} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when engagement is null even with flag ON', async () => {
        const { DisciplineStrip } = await loadStrip(true);
        const { container } = render(<DisciplineStrip engagement={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('shows streak, points and the recognition line when flag ON', async () => {
        const { DisciplineStrip } = await loadStrip(true);
        const { getByTestId } = render(<DisciplineStrip engagement={engagement} />);
        expect(getByTestId('discipline-strip')).toBeTruthy();
        expect(getByTestId('discipline-streak').textContent).toContain('५');
        expect(getByTestId('discipline-recognition').textContent).toContain('सलग');
    });
});
