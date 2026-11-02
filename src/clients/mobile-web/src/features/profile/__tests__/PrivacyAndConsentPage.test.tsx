// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17; PLR-D9 §6 line 106) — "गोपनीयता व संमती" is ONE
// place: the three consents (all OFF until he turns one on), a copy of his data, and erase behind its own
// "are you sure" step — under ONE title bar with ONE मागे. The consent words and their save are the
// real screen's, unchanged.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        getConsent: vi.fn(), updateConsent: vi.fn(),
        // plr-d10 I25 (D-36): the improvement permission is read on the same page.
        getImprovementPermission: vi.fn(() => Promise.reject(new Error('no permission yet'))),
        setImprovementPermission: vi.fn(),
    },
}));
vi.mock('../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PrivacyAndConsentPage from '../PrivacyAndConsentPage';
import ConsentScreen from '../../consent/ConsentScreen';
import ExportRequestScreen from '../../dataRights/ExportRequestScreen';
import ErasureRequestScreen from '../../dataRights/ErasureRequestScreen';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { apiFetch } from '../../../infrastructure/api/apiFetch';

const client = agriSyncClient as unknown as { getConsent: ReturnType<typeof vi.fn>; updateConsent: ReturnType<typeof vi.fn> };
const fetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>;

describe('PrivacyAndConsentPage — the one गोपनीयता व संमती place', () => {
    beforeEach(() => {
        client.getConsent.mockRejectedValue(new Error('no consent yet'));
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') }) as unknown as typeof fetch;
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ requestId: 'r-1' }), { status: 202 }));
    });
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

    it('one title bar named like the hub row, one मागे, and it goes back', async () => {
        const onBack = vi.fn();
        render(<PrivacyAndConsentPage onBack={onBack} />);
        expect(screen.getByTestId('page-title')).toHaveTextContent('गोपनीयता व संमती');
        expect(screen.getAllByTestId('page-back')).toHaveLength(1);
        expect(screen.getAllByTestId('page-bar')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('holds the three consents (all OFF), a copy of my data and erase — every part on one page', async () => {
        render(<PrivacyAndConsentPage onBack={vi.fn()} />);
        for (const id of ['fullHistoryJournal', 'researchCorpusExport']) {
            expect(await screen.findByTestId(`consent-checkbox-${id}`)).not.toBeChecked();
        }
        // plr-d10 I25 (D-36): the improvement permission replaced the old ambiguous switch.
        expect(screen.getByTestId('improvement-permission-checkbox')).not.toBeChecked();
        expect(screen.queryByTestId('consent-checkbox-crossFarmAggregation')).toBeNull();
        expect(screen.getByText('माझा डेटा')).toBeInTheDocument();
        expect(within(screen.getByTestId('privacy-export')).getByText('माझा डेटा निर्यात करा')).toBeInTheDocument();
        expect(within(screen.getByTestId('privacy-erase')).getByText('माझा डेटा मिटवा')).toBeInTheDocument();
        expect(screen.getByTestId('consent-save-button')).toBeInTheDocument();
    });

    it('erase still asks "are you sure" first — nothing is sent on the first tap', async () => {
        // lane F99 fix pass 1 (D-71): the page READS his erasure requests (a GET); what must not happen is a request SENT.
        const sent = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
        render(<PrivacyAndConsentPage onBack={vi.fn()} />);
        fireEvent.click(await screen.findByTestId('erasure-open-confirm'));
        expect(sent()).toHaveLength(0);
        expect(screen.getByTestId('erasure-confirm-dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('erasure-confirm-cancel'));
        expect(screen.queryByTestId('erasure-confirm-dialog')).toBeNull();
        expect(sent()).toHaveLength(0);
    });

    it('asking for a copy sends the real request from here', async () => {
        render(<PrivacyAndConsentPage onBack={vi.fn()} />);
        fireEvent.click(screen.getByTestId('export-submit-button'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/shramsafal/me/export/request', expect.objectContaining({ method: 'POST' })));
        expect(await screen.findByTestId('export-success-sla')).toBeInTheDocument();
    });
});

describe('the old privacy screens opened directly keep one title bar with मागे (no bare "←")', () => {
    beforeEach(() => {
        client.getConsent.mockRejectedValue(new Error('no consent yet'));
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') }) as unknown as typeof fetch;
    });
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

    it.each([
        ['consent', (onBack: () => void) => <ConsentScreen onBack={onBack} forceLocale="mr-IN" />, 'संमती'],
        ['export', (onBack: () => void) => <ExportRequestScreen onBack={onBack} forceLocale="mr-IN" />, 'माझा डेटा निर्यात करा'],
        ['erasure', (onBack: () => void) => <ErasureRequestScreen onBack={onBack} forceLocale="mr-IN" />, 'माझा डेटा मिटवा'],
    ] as const)('%s', (_name, draw, title) => {
        const onBack = vi.fn();
        render(draw(onBack));
        expect(screen.getByTestId('page-title')).toHaveTextContent(title);
        expect(screen.getByTestId('page-back')).toHaveTextContent('मागे');
        expect(screen.queryByText('←')).toBeNull();
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
