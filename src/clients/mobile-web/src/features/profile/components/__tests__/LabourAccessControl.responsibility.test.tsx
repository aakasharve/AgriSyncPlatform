// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LabourAccessControl from '../LabourAccessControl';

/*
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the D5 labour switch moved out of the old
 * TeamMemberCard into LabourAccessControl, which the new team screen's person card renders. These
 * are the SAME assertions the card carried, against the moved control.
 */
const member = { id: 'user-1', name: 'प्रकाश' };

const renderCard = (labourAccess: {
    canManage: boolean; isEditable: boolean; saving: boolean;
    expiresAtUtc: string | null;
    onChange: (next: boolean, expiresAtUtc: string | null) => void;
}) => render(
    <LabourAccessControl memberId={member.id} memberName={member.name} access={labourAccess} />,
);

afterEach(() => cleanup());

describe('जबाबदारी द्या (D5)', () => {
    it('OFF state offers जबाबदारी द्या and picking कायम grants with no end', () => {
        const onChange = vi.fn();
        renderCard({ canManage: false, isEditable: true, saving: false, expiresAtUtc: null, onChange });

        fireEvent.click(screen.getByText('जबाबदारी द्या'));
        expect(screen.getByText('प्रकाशला किती दिवस?')).toBeTruthy();
        for (const label of ['आज', '2 दिवस', '3 दिवस', 'तारीख', 'कायम']) {
            expect(screen.getByText(label)).toBeTruthy();
        }

        fireEvent.click(screen.getByText('कायम'));
        expect(onChange).toHaveBeenCalledWith(true, null);
    });

    it('a day chip grants until the computed local midnight', () => {
        const onChange = vi.fn();
        renderCard({ canManage: false, isEditable: true, saving: false, expiresAtUtc: null, onChange });
        fireEvent.click(screen.getByText('जबाबदारी द्या'));
        fireEvent.click(screen.getByText('2 दिवस'));

        expect(onChange).toHaveBeenCalledTimes(1);
        const [next, iso] = onChange.mock.calls[0];
        expect(next).toBe(true);
        const now = new Date();
        expect(iso).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString());
    });

    it('ON state states the responsibility and its end, and tapping revokes', () => {
        const onChange = vi.fn();
        const end = new Date(2026, 8, 5).toISOString();
        renderCard({ canManage: true, isEditable: true, saving: false, expiresAtUtc: end, onChange });

        expect(screen.getByText('माणसांची जबाबदारी आहे')).toBeTruthy();
        expect(screen.getByText('4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल')).toBeTruthy();

        fireEvent.click(screen.getByText('माणसांची जबाबदारी आहे'));
        expect(onChange).toHaveBeenCalledWith(false, null);
    });

    it('renders no permission vocabulary anywhere', () => {
        const { container } = renderCard({
            canManage: true, isEditable: false, saving: false, expiresAtUtc: null, onChange: vi.fn(),
        });
        expect(container.textContent).not.toMatch(/permission|grant|\brole\b|claim|policy|access/i);
    });
});
