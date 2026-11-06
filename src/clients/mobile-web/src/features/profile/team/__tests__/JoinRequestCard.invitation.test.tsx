// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. A joining request claimed from a personal invitation:
 * its grant was chosen before he joined, so the owner's card offers ONE tap ("आत घ्या") and no preset; नको stays. A
 * generic request (typed code, farm QR) keeps the owner's choices as before.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JoinRequestCard } from '../JoinRequestCard';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const row = (over: Partial<LabourPermission> = {}): LabourPermission => ({
    userId: 'u-1',
    role: 'SecondaryOwner',
    status: 'PendingApproval',
    canManageLabourRecords: false,
    hasExplicitGrant: false,
    source: 'NotGranted',
    isGrantEditable: true,
    labourGrantExpiresAtUtc: null,
    joinedVia: 'PersonalInvitation',
    ...over,
} as LabourPermission);

afterEach(cleanup);

describe('a request claimed from an invitation', () => {
    it('one tap lets him in with the invitation\'s grant; no preset is offered', () => {
        const onLetIn = vi.fn();
        const onApprove = vi.fn();
        render(
            <ul>
                <JoinRequestCard row={row({ personalInvitationId: 'inv-1', label: 'Family' })} name="रमेश" busy={false}
                    onApprove={onApprove} onDecline={vi.fn()} onLetInFromInvitation={onLetIn} />
            </ul>,
        );
        expect(screen.getByTestId('join-request-invited-u-1')).toHaveTextContent('कुटुंब');
        fireEvent.click(screen.getByTestId('let-in-u-1'));
        expect(onLetIn).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('approve-work-u-1')).toBeNull();
        expect(screen.getByTestId('decline-u-1')).toBeInTheDocument();
        expect(onApprove).not.toHaveBeenCalled();
    });

    it('a generic request keeps the owner\'s choices', () => {
        render(
            <ul>
                <JoinRequestCard row={row({ role: 'Worker', joinedVia: 'QrScan' })} name="सुरेश" busy={false}
                    onApprove={vi.fn()} onDecline={vi.fn()} />
            </ul>,
        );
        expect(screen.queryByTestId('let-in-u-1')).toBeNull();
        expect(screen.getByTestId('approve-work-u-1')).toBeInTheDocument();
    });
});
