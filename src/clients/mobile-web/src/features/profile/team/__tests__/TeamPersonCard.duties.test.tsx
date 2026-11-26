// @vitest-environment jsdom
/**
 * Repair FIX-1 item 9 (R2-B 16 Step A, founder 27 Nov) — the team card shows what each person may do WITHOUT a tap, so the
 * owner sees that "all plots" does not mean "all actions":
 *   भूमिका: <label> · प्लॉट: <scope> · काय करू शकतात: <the responsibilities ON and not ended>, or "बाकी काही नाही".
 * The thirteen switches (behind "बदला") are grouped under four headings, each switch exactly once. No rule changes.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LabourPermission, AuthorityGrant } from '../../data/labourPermissionsClient';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import { TeamPersonCard } from '../TeamPersonCard';
import { SWITCHABLE_AUTHORITIES } from '../../../../core/session/farmAuthorities';

const row = (over: Partial<LabourPermission> = {}): LabourPermission => ({
    userId: 'shankar', role: 'Mukadam', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [],
    authorities: [], plotScope: 'AllPlots', ...over,
});
const grant = (name: string, expiresAtUtc: string | null = null): AuthorityGrant => ({ name, expiresAtUtc });

const draw = (r: LabourPermission, withSwitches = false) => render(
    <TeamPersonCard row={r} name="शंकर" isYou={false} rights={{ canDecide: false, canChangeRole: false }} busy={false}
        authorityAccess={withSwitches ? { authorities: r.authorities ?? [], saving: false, onChange: vi.fn() } : undefined}
        onChangePreset={vi.fn()} onSuspend={vi.fn()} onRestore={vi.fn()} onRemove={vi.fn()} />,
);
const text = (id: string) => screen.getByTestId(id).textContent;

afterEach(() => { cleanup(); h.language = 'mr'; });

describe('team card — role, plots and what he may do, without a tap', () => {
    it('a मुकादम on all plots with no responsibility: "बाकी काही नाही"', () => {
        draw(row());
        expect(text('team-person-role')).toBe('भूमिका: मुकादम');
        expect(text('team-person-plots')).toBe('प्लॉट: सर्व प्लॉट');
        expect(text('team-person-can')).toBe('काय करू शकतात: बाकी काही नाही');
    });

    it('two switches on: exactly those two, then "बाकी काही नाही"', () => {
        draw(row({ authorities: [grant('TakeAttendance'), grant('ConfirmRecords')] }));
        expect(text('team-person-can')).toBe('काय करू शकतात: नोंदी पक्क्या करणे · हजेरी घेणे · बाकी काही नाही');
        // the always-open line no longer repeats हजेरी: the responsibilities have their own line
        expect(text('team-person-line')).toBe('काम सांगणे · खर्च नोंदवणे');
    });

    it('an ended responsibility is not shown as allowed; one not in force on his seat is not either', () => {
        draw(row({
            authorities: [grant('TakeAttendance', '2020-01-02T00:00:00Z'), grant('EditFarmSetup'), grant('SeeAllTasks')],
            authoritiesNotInForce: ['EditFarmSetup'],
        }));
        expect(text('team-person-can')).toBe('काय करू शकतात: सगळी कामे पाहणे · बाकी काही नाही');
    });

    it('chosen plots read their count when the names are not at hand; own work reads स्वतःचं काम', () => {
        draw(row({ plotScope: 'ChosenPlots', plotIds: ['p1', 'p2'] }));
        expect(text('team-person-plots')).toBe('प्लॉट: २ प्लॉट');
        cleanup();
        draw(row({ role: 'Worker', plotScope: 'AllPlots', effectivePlotScope: 'OwnWork' }));
        expect(text('team-person-role')).toBe('भूमिका: कामगार');
        expect(text('team-person-plots')).toBe('प्लॉट: स्वतःचं काम');
    });

    it('the primary owner, who holds every responsibility, reads "सर्व जबाबदाऱ्या"', () => {
        draw(row({ userId: 'me', role: 'PrimaryOwner', isRegistrant: true, authorities: SWITCHABLE_AUTHORITIES.map(n => grant(n)) }));
        expect(text('team-person-role')).toBe('भूमिका: मालक');
        expect(text('team-person-can')).toBe('काय करू शकतात: सर्व जबाबदाऱ्या');
    });

    it('an older server (no responsibilities sent): no new lines, the card as before', () => {
        draw(row({ authorities: undefined, canManageLabourRecords: true }));
        expect(screen.queryByTestId('team-person-can')).toBeNull();
        expect(screen.queryByTestId('team-person-role')).toBeNull();
        expect(text('team-person-line')).toBe('काम सांगणे · खर्च नोंदवणे · हजेरी · पक्कं करणे');
    });

    it('English mode: the English twins', () => {
        h.language = 'en';
        draw(row({ authorities: [grant('TakeAttendance')] }));
        expect(text('team-person-role')).toBe('Role: Mukadam');
        expect(text('team-person-plots')).toBe('Plots: All plots');
        expect(text('team-person-can')).toBe('Can do: Take attendance · Nothing else');
    });
});

describe('the thirteen switches, under four headings', () => {
    it('every switch appears exactly once, under its heading, in the founder\'s order of headings', () => {
        draw(row({ authorities: [] }), true);
        fireEvent.click(screen.getByTestId('team-change-shankar'));
        const block = screen.getByTestId('authority-switches-shankar');
        const headings = Array.from(block.querySelectorAll('[data-testid^="authority-group-"][data-part="heading"]')).map(el => el.textContent);
        expect(headings).toEqual(['नोंद व खात्री', 'हजेरी', 'पैसे', 'नियोजन व शेताची रचना']);
        for (const name of SWITCHABLE_AUTHORITIES) {
            expect(block.querySelectorAll(`[data-testid="authority-${name}-shankar"]`)).toHaveLength(1);
        }
        expect(block.querySelectorAll('[data-testid^="authority-"][data-on]')).toHaveLength(SWITCHABLE_AUTHORITIES.length);
        const group = (key: string) => within(screen.getByTestId(`authority-group-${key}-shankar`));
        expect(group('attendance').getByTestId('authority-TakeAttendance-shankar')).toBeInTheDocument();
        expect(group('money').getByTestId('authority-SeeWages-shankar')).toBeInTheDocument();
        expect(group('records').getByTestId('authority-ConfirmRecords-shankar')).toBeInTheDocument();
        expect(group('planning').getByTestId('authority-EditFarmSetup-shankar')).toBeInTheDocument();
    });
});
