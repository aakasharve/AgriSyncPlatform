// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT; CTO ruling Q10 = A; doctrine P5) - the create-farm wizard asked "Which
 * village?" (in English) and sent the answer, which the server accepts and never stores (`FirstFarmBootstrapEndpoints.cs`: `Village` is read
 * nowhere). The question is gone until the farm's own place is built with the real 7/12 work: farm name, then the summary, then the farm.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({ bootstrap: vi.fn() }));
vi.mock('../../qr/inviteApi', () => ({
    bootstrapFirstFarm: (...args: unknown[]) => api.bootstrap(...args),
    isInviteApiError: () => false,
}));

import FirstFarmWizard from '../FirstFarmWizard';

afterEach(() => { cleanup(); api.bootstrap.mockReset(); });

describe('FirstFarmWizard — no "Which village?" question', () => {
    it('farm name, then straight to the summary; the farm is made with its name only', async () => {
        const user = userEvent.setup();
        api.bootstrap.mockResolvedValue({ farmId: 'F1', farmName: 'पवार शेत', farmCode: 'K7M2QX', ownerAccountId: 'a', subscription: null, wasAlreadyBootstrapped: false });
        render(<FirstFarmWizard isOpen onComplete={vi.fn()} />);
        await user.click(screen.getByText('चला सुरु करू'));
        await user.type(screen.getByPlaceholderText('e.g. रामू पाटील शेत'), 'पवार शेत');
        await user.click(screen.getByText('पुढे चला'));
        expect(screen.queryByText('गाव कोणते?')).toBeNull();
        expect(screen.queryByText(/Which village/)).toBeNull();
        expect(screen.getByText('तयार आहात?')).toBeInTheDocument();
        await user.click(screen.getByText('शेती तयार करा'));
        expect(api.bootstrap).toHaveBeenCalledTimes(1);
        expect(api.bootstrap.mock.calls[0]).toEqual(['पवार शेत']);
    });

    it('मागे on the summary goes back to the farm name', async () => {
        const user = userEvent.setup();
        render(<FirstFarmWizard isOpen onComplete={vi.fn()} />);
        await user.click(screen.getByText('चला सुरु करू'));
        await user.type(screen.getByPlaceholderText('e.g. रामू पाटील शेत'), 'पवार शेत');
        await user.click(screen.getByText('पुढे चला'));
        await user.click(screen.getByText('मागे'));
        expect(screen.getByText('शेतीचे नाव काय?')).toBeInTheDocument();
    });
});
