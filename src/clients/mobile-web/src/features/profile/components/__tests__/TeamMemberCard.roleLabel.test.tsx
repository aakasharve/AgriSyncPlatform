// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamMemberCard } from '../TeamMemberCard';

const renderRole = (role: string) => render(
    <TeamMemberCard member={{ id: 'u1', name: 'नाव', role } as never} onDelete={() => {}} />,
);

afterEach(() => cleanup());

/* The Team page used to print "कामाला येणारे" for everyone but a co-owner,
   so the owner and the Mukadam were labelled as workers. */
describe('Team page role label', () => {
    it.each([
        ['PRIMARY_OWNER', 'मालक'],
        ['SECONDARY_OWNER', 'सहमालक'],
        ['MUKADAM', 'मुकादम'],
        ['WORKER', 'कामगार'],
    ])('%s shows %s', (role, label) => {
        renderRole(role);
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.queryByText('कामाला येणारे')).toBeNull();
        expect(screen.queryByText('भागीदार')).toBeNull();
    });

    it('shows NO role label when the client does not know the role', () => {
        const { container } = renderRole('UNKNOWN');
        expect(screen.getByText('नाव')).toBeTruthy();
        for (const word of ['कामगार', 'मालक', 'सहमालक', 'मुकादम', 'सदस्य']) {
            expect(screen.queryByText(word)).toBeNull();
        }
        expect(container.querySelector('span.uppercase')).toBeNull();
    });
});
