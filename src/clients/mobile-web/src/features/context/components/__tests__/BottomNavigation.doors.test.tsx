// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6, role-shaped doors). The bottom bar follows the
 * seat's authorities, never its label: the owner keeps all five places, a मुकादम without money loses the money doors, a worker
 * has लक्ष द्या and शेड्यूल only (found live 2026-11-06: his bar showed खरेदी / उत्पन्न / चाचण्या, and उत्पन्न led to a page
 * that said the money is not shown). A seat the phone does not know yet keeps every door (the server decides anyway).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BottomNavigation from '../BottomNavigation';
import { seatDoors } from '../../../../core/session/seatDoors';

vi.mock('../../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/utils/haptics', () => ({ hapticFeedback: { medium: () => undefined } }));

afterEach(cleanup);

const props = (over = {}) => ({ currentRoute: 'main' as never, currentView: 'log' as never, onNavigate: vi.fn(), onViewChange: vi.fn(), ...over });
const grants = (...names: string[]) => names.map(name => ({ name, expiresAtUtc: null }));
const icons = () => [...document.querySelectorAll('[data-nav-icon]')].map(e => e.getAttribute('data-nav-icon'));

const OWNER = { role: 'PrimaryOwner', authorities: grants('TakeAttendance', 'ConfirmRecords', 'SeeMoney', 'SeeWages', 'ReviewMoney', 'PlanWork', 'EditFarmSetup', 'LabRecords', 'ScheduleTemplates') };
const MUKADAM = { role: 'Mukadam', authorities: grants('TakeAttendance') };
const MUKADAM_WITH_MONEY = { role: 'Mukadam', authorities: grants('TakeAttendance', 'SeeMoney') };
const CO_OWNER_LABELLED_BUT_GRANTED_NOTHING = { role: 'SecondaryOwner', authorities: [] };
const WORKER = { role: 'Worker', authorities: [] };

describe('seatDoors', () => {
    it('owner full, मुकादम short, worker minimal - read from the authorities, never the label', () => {
        expect(seatDoors(OWNER)).toEqual({ procurement: true, money: true, tests: true });
        expect(seatDoors(MUKADAM)).toEqual({ procurement: false, money: false, tests: false });
        expect(seatDoors(MUKADAM_WITH_MONEY)).toEqual({ procurement: true, money: true, tests: false });
        expect(seatDoors(CO_OWNER_LABELLED_BUT_GRANTED_NOTHING)).toEqual({ procurement: false, money: false, tests: false });
        expect(seatDoors(WORKER)).toEqual({ procurement: false, money: false, tests: false });
        expect(seatDoors({ role: 'Worker', authorities: grants('LabRecords') }).tests).toBe(true);
        expect(seatDoors({ role: 'Mukadam', authorities: grants('ReviewMoney') }).procurement).toBe(true);
    });

    it('a seat the phone does not know shows every door; a known seat the server did not describe keeps only the primary owner\'s', () => {
        expect(seatDoors(null)).toEqual({ procurement: true, money: true, tests: true });
        expect(seatDoors(undefined)).toEqual({ procurement: true, money: true, tests: true });
        expect(seatDoors({ role: 'PrimaryOwner', authorities: null })).toEqual({ procurement: true, money: true, tests: true });
        expect(seatDoors({ role: 'Worker', authorities: null })).toEqual({ procurement: false, money: false, tests: false });
    });
});

describe('the bottom bar per role', () => {
    it('the owner has all five places', () => {
        render(<BottomNavigation {...props({ doors: seatDoors(OWNER) })} />);
        expect(icons()).toEqual(['attention', 'procure', 'schedule', 'income', 'tests']);
    });

    it('a मुकादम who may not see money has लक्ष द्या and शेड्यूल; with money he gets खरेदी and उत्पन्न back', () => {
        render(<BottomNavigation {...props({ doors: seatDoors(MUKADAM) })} />);
        expect(icons()).toEqual(['attention', 'schedule']);
        cleanup();
        render(<BottomNavigation {...props({ doors: seatDoors(MUKADAM_WITH_MONEY) })} />);
        expect(icons()).toEqual(['attention', 'procure', 'schedule', 'income']);
    });

    it('a worker\'s bar is लक्ष द्या and शेड्यूल only: no खरेदी, no उत्पन्न, no चाचण्या', () => {
        render(<BottomNavigation {...props({ doors: seatDoors(WORKER) })} />);
        expect(icons()).toEqual(['attention', 'schedule']);
        expect(screen.queryByTestId('procurement-nav-btn')).toBeNull();
        expect(screen.queryByTestId('nav-income')).toBeNull();
        expect(screen.getByTestId('nav-attention')).toBeTruthy();
        expect(screen.getByTestId('nav-schedule')).toBeTruthy();
        // The raised button keeps its cradle, and the columns share the width.
        expect(screen.getByTestId('nav-cradle')).toBeTruthy();
        expect((screen.getByTestId('nav-row') as HTMLElement).className).toContain('grid-cols-2');
    });

    it('with no doors given (the seat is not known yet) every place is drawn, as before', () => {
        render(<BottomNavigation {...props()} />);
        expect(icons()).toEqual(['attention', 'procure', 'schedule', 'income', 'tests']);
        expect((screen.getByTestId('nav-row') as HTMLElement).className).toContain('grid-cols-5');
    });
});
