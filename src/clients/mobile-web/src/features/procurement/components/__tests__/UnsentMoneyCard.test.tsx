// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (R-4) — the खरेदी card "फोनवर राहिलेल्या नोंदी — पाठवायच्या":
 * nothing before the first download or when nothing is left; a farm the phone cannot prove is CHOSEN by the
 * farmer (the send button waits for it); a proven farm is named on the button the farmer taps; a row whose plot
 * is not on the server says it stays on the phone and offers no button. The list/send module is mocked.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnsentGroup, UnsentMoney } from '../../unsentMoney';

const listUnsentMoney = vi.fn<() => Promise<UnsentMoney>>();
const sendUnsentGroup = vi.fn();
vi.mock('../../unsentMoney', () => ({
    listUnsentMoney: () => listUnsentMoney(),
    sendUnsentGroup: (...a: unknown[]) => sendUnsentGroup(...a),
}));

import { FarmContext } from '../../../../core/session/FarmContext';
import { STAYS_ON_PHONE_MR, UNSENT_TITLE_MR, UnsentMoneyCard, sendLabelMr } from '../UnsentMoneyCard';

const FARMS = [{ farmId: 'farm-A', name: 'मळा', status: 'Active' }, { farmId: 'farm-B', name: 'ओढा', status: 'Active' }];
const group = (over: Partial<UnsentGroup>): UnsentGroup => ({
    key: 'bill:1', kind: 'bill', billId: '1', entries: [{ costEntryId: 'e1', payload: {} as never }], total: 700,
    date: '2026-10-20', label: 'कृषी सेवा', proposedFarmId: null, sendable: true, ...over,
});
const card = (farms = FARMS) => (
    <FarmContext.Provider value={{ farms, currentFarmId: null } as never}>
        <UnsentMoneyCard crops={[]} />
    </FarmContext.Provider>
);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('फोनवर राहिलेल्या नोंदी', () => {
    it('shows nothing before the first download, and nothing when nothing is left', async () => {
        listUnsentMoney.mockResolvedValue({ ready: false, groups: [] });
        const { container, unmount } = render(card());
        await waitFor(() => expect(listUnsentMoney).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
        unmount();
        listUnsentMoney.mockResolvedValue({ ready: true, groups: [] });
        const second = render(card());
        await waitFor(() => expect(listUnsentMoney).toHaveBeenCalledTimes(2));
        expect(second.container).toBeEmptyDOMElement();
    });

    it('an unproven farm is chosen by the farmer; only then the send goes — to THAT farm', async () => {
        listUnsentMoney.mockResolvedValue({ ready: true, groups: [group({})] });
        sendUnsentGroup.mockResolvedValue({ queued: 1, kept: 0, photoQueued: false });
        render(card());
        expect(await screen.findByText(UNSENT_TITLE_MR)).toBeInTheDocument();
        expect(screen.getByTestId('unsent-send-bill:1')).toBeDisabled();

        fireEvent.click(screen.getByText('ओढा'));
        const send = screen.getByTestId('unsent-send-bill:1');
        expect(send).toHaveTextContent(sendLabelMr('ओढा'));
        fireEvent.click(send);
        await waitFor(() => expect(sendUnsentGroup).toHaveBeenCalledWith(expect.objectContaining({ key: 'bill:1' }), 'farm-B'));
    });

    it('a proven farm is named on the button; a plot not on the server stays on the phone with no button', async () => {
        listUnsentMoney.mockResolvedValue({ ready: true, groups: [
            group({ key: 'log:L', kind: 'log', proposedFarmId: 'farm-A' }),
            group({ key: 'log:P', kind: 'log', plotId: 'p_old', sendable: false }),
        ] });
        render(card());
        expect(await screen.findByTestId('unsent-send-log:L')).toHaveTextContent(sendLabelMr('मळा'));
        expect(screen.queryByTestId('unsent-farm-log:L')).toBeNull();
        expect(screen.getByTestId('unsent-stays-log:P')).toHaveTextContent(STAYS_ON_PHONE_MR);
        expect(screen.queryByTestId('unsent-send-log:P')).toBeNull();
    });
});
