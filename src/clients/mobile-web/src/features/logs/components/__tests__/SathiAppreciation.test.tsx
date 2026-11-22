// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 5) - the appreciation line shows only approved wording.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';

const record = {
    cropActivities: [{ id: 'a1', title: 'घड बांधणी' }],
    labour: [{ id: 'l1', type: 'HIRED' as const, femaleCount: 8, count: 8 }],
};

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../domain/dfes/sathiPatterns');
    vi.doUnmock('../../../../i18n/LanguageContext');
    vi.resetModules();
});

async function load(approved: boolean, language: 'mr' | 'en' = 'mr') {
    vi.resetModules();
    vi.doMock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language }) }));
    vi.doMock('../../../../domain/dfes/sathiPatterns', async () => {
        const actual = await vi.importActual<typeof import('../../../../domain/dfes/sathiPatterns')>('../../../../domain/dfes/sathiPatterns');
        return {
            ...actual,
            SATHI_PATTERNS: {
                appreciation: { ...actual.SATHI_PATTERNS.appreciation, approved },
                appreciationPlanned: { ...actual.SATHI_PATTERNS.appreciationPlanned, approved },
            },
        };
    });
    return (await import('../SathiAppreciation')).SathiAppreciation;
}

describe('lane DFES-Q - SathiAppreciation', () => {
    it('renders nothing while the wording is not ticked', async () => {
        const SathiAppreciation = await load(false);
        render(<SathiAppreciation record={record} />);

        expect(screen.queryByTestId('sathi-appreciation')).toBeNull();
    });

    it('once ticked, names his work in Marathi only', async () => {
        const SathiAppreciation = await load(true, 'mr');
        render(<SathiAppreciation record={record} />);

        const line = screen.getByTestId('sathi-appreciation');
        expect(line).toHaveTextContent('घड बांधणी');
        expect(line).toHaveTextContent('८ बायका');
        expect(line.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('renders nothing when there is nothing to name', async () => {
        const SathiAppreciation = await load(true);
        render(<SathiAppreciation record={{}} />);

        expect(screen.queryByTestId('sathi-appreciation')).toBeNull();
    });
});
