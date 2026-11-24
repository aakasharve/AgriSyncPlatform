// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7) - the head, the four tiles (empty ones drawn, "N आवाज" hidden at 0), the two door cards
 * (no card without the right), the calendar marks (only where the phone has evidence), the two tabs and the language of the schedule's name.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScheduleTiles, placeTiles } from '../ScheduleTiles';
import { ScheduleTabDoors } from '../ScheduleTabDoors';
import { dayMark } from '../ScheduleTabCalendar';
import { areaText } from '../ScheduleTabHead';
import { scheduleNameIn } from '../scheduleNames';
import type { FollowedPlace } from '../resolveSchedule';

const place = (id: string, ownerType: string, origin: 'Outside' | 'Own', slot: number, extra: Partial<FollowedPlace> = {}): FollowedPlace => ({
    subscriptionId: id, templateId: id, slot, origin, checkState: origin === 'Own' ? null : 'Checked', isMain: slot === 1, pending: false, refused: false,
    template: { id, name: 'Grapes - Pruning to Pruning', ownerType, createdBy: 'ShramSafal Reference Data', sourceLabel: 'ICAR-NRCG ची प्रकाशनं' } as unknown as FollowedPlace['template'], ...extra,
});
afterEach(() => cleanup());

describe('the four tiles', () => {
    it('always four tiles in a 2 x 2 grid; an empty one is drawn and says what it is for; the main one is marked; no "N आवाज" at zero', () => {
        render(<ScheduleTiles followed={[place('a', 'INSTITUTION', 'Outside', 1)]} selectedTemplateId="a" onSelect={vi.fn()} onAdd={vi.fn()} />);
        expect(screen.getByTestId('schedule-tiles-grid').children.length).toBe(4);
        expect(screen.getByTestId('tile-INSTITUTION')).toHaveAttribute('data-main', 'true');
        expect(screen.getByTestId('tile-main-INSTITUTION')).toHaveTextContent('मुख्य');
        expect(screen.getByTestId('tile-maker-INSTITUTION')).toHaveTextContent('श्रमसफल');
        expect(screen.getByTestId('tile-source-INSTITUTION')).toHaveTextContent('स्रोत ICAR-NRCG ची प्रकाशनं');
        expect(screen.getByTestId('tile-empty-EXPERT').textContent).toMatch(/तज्ज्ञ/);
        expect(screen.getByTestId('tile-empty-ADVISOR').textContent).toMatch(/कृषी सल्लागार/);
        expect(screen.getByTestId('tile-empty-OWN').textContent).toMatch(/तुमचं स्वतःचं/);
        expect(document.querySelector('[data-testid^="tile-voices-"]')).toBeNull();
        expect(document.querySelectorAll('img').length).toBe(0);
    });
    it('a tile with unheard owner messages carries its count', () => {
        render(<ScheduleTiles followed={[place('a', 'INSTITUTION', 'Outside', 1)]} selectedTemplateId="a" onSelect={vi.fn()} unheard={{ a: 2 }} />);
        expect(screen.getByTestId('tile-voices-INSTITUTION')).toHaveTextContent('२ आवाज');
    });
    it('tapping a filled tile chooses its schedule; the own tile is a door only for a seat that may make', () => {
        const onSelect = vi.fn();
        const onMakeOwn = vi.fn();
        const { rerender } = render(<ScheduleTiles followed={[place('a', 'INSTITUTION', 'Outside', 1)]} selectedTemplateId="a" onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('tile-INSTITUTION'));
        expect(onSelect).toHaveBeenCalledWith('a');
        expect(screen.getByTestId('tile-empty-OWN')).toBeDisabled();
        rerender(<ScheduleTiles followed={[place('a', 'INSTITUTION', 'Outside', 1)]} selectedTemplateId="a" onSelect={onSelect} mayMakeOwn onMakeOwn={onMakeOwn} />);
        fireEvent.click(screen.getByTestId('tile-empty-OWN'));
        expect(onMakeOwn).toHaveBeenCalled();
    });
    it('places go to the tile of their owner type; an unknown type takes the first free outside tile; his own is the fourth', () => {
        const t = placeTiles([place('x', 'SYSTEM_DEFAULT', 'Outside', 1), place('e', 'EXPERT', 'Outside', 2), place('o', 'USER', 'Own', 4)]);
        expect(t.EXPERT?.templateId).toBe('e');
        expect(t.INSTITUTION?.templateId).toBe('x');
        expect(t.OWN?.templateId).toBe('o');
        expect(t.ADVISOR).toBeNull();
    });
});

describe('the two door cards', () => {
    it('a seat without the right sees neither card; with the right each card opens its door', () => {
        const { rerender } = render(<ScheduleTabDoors plotName="G1" />);
        expect(screen.queryByTestId('tab-door-plan')).toBeNull();
        expect(screen.queryByTestId('tab-door-make')).toBeNull();
        const plan = vi.fn();
        const make = vi.fn();
        rerender(<ScheduleTabDoors plotName="G1" onPlan={plan} onMake={make} />);
        expect(screen.getByTestId('tab-door-plan')).toHaveTextContent('G1 चं नियोजन करा');
        fireEvent.click(screen.getByTestId('tab-door-plan'));
        fireEvent.click(screen.getByTestId('tab-door-make'));
        expect(plan).toHaveBeenCalled();
        expect(make).toHaveBeenCalled();
    });
});

describe('calendar marks: only where the phone holds evidence', () => {
    const cell = (status: string, hasItems = true) => ({ items: hasItems ? [{}] : [], status, done: status === 'done' });
    const day = (key: string, statuses: string[], prep = false): any => ({
        key, day: 3, prep, stageId: 's', items: [], logs: [],
        cells: { irrigation: cell(statuses[0] ?? 'x', statuses.length > 0), nutrition: cell('x', false), spray: cell(statuses[1] ?? 'x', statuses.length > 1), work: cell('x', false) },
    });
    it('done everywhere = tick; some done = partly; none done on a past day = missed; today with none done is NOT missed; a future day and a prep day are never marked', () => {
        expect(dayMark(day('2026-10-20', ['done', 'done']), '2026-10-26')).toBe('done');
        expect(dayMark(day('2026-10-20', ['done', 'missed']), '2026-10-26')).toBe('part');
        expect(dayMark(day('2026-10-20', ['missed', 'missed']), '2026-10-26')).toBe('missed');
        expect(dayMark(day('2026-10-26', ['missed', 'missed']), '2026-10-26')).toBeNull();
        expect(dayMark(day('2026-10-30', ['missed', 'missed']), '2026-10-26')).toBeNull();
        expect(dayMark(day('2026-10-10', ['missed', 'missed'], true), '2026-10-26')).toBeNull();
        expect(dayMark(day('2026-10-20', []), '2026-10-26')).toBeNull();
    });
});

describe('head and names', () => {
    it('the area is the plot\'s own, in Devanagari digits; none on the phone = nothing said', () => {
        expect(areaText({ baseline: { totalArea: 2, unit: 'Acre' } } as any, 'mr')).toBe('२ एकर');
        expect(areaText({ baseline: { totalArea: 20, unit: 'Guntha' } } as any, 'en')).toBe('20 guntha');
        expect(areaText({ baseline: {} } as any, 'mr')).toBeNull();
    });
    it('the schedule\'s name is never English on a Marathi screen', () => {
        expect(scheduleNameIn('Grapes - Pruning to Pruning', 'mr')).toBe('द्राक्ष — फळछाटणी ते फळछाटणी');
        expect(scheduleNameIn('Grapes - Pruning to Pruning', 'en')).toBe('Grapes - Pruning to Pruning');
        expect(scheduleNameIn('Grapes - Something New', 'mr')).toBe('द्राक्ष — Something New');
    });
});
