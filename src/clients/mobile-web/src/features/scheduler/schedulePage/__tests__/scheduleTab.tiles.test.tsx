// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 3; version 7) - the four tiles carry the app's own icon for who made the schedule; never an image
 * (no institution logo: SM-17).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThreePlusOneSection } from '../ThreePlusOneSection';
import type { FollowedPlace } from '../resolveSchedule';

const place = (id: string, ownerType: string, origin: 'Outside' | 'Own', slot: number): FollowedPlace => ({
    subscriptionId: id, templateId: id, slot, origin, checkState: origin === 'Own' ? null : 'Checked', isMain: slot === 1, pending: false, refused: false,
    template: { id, name: 'X', ownerType, createdBy: 'a', sourceLabel: 'स्रोत' } as unknown as FollowedPlace['template'],
});
afterEach(() => cleanup());
describe('the four tiles', () => {
    it('each tile has an icon box, there are four, in two columns, and no image', () => {
        render(<ThreePlusOneSection followed={[place('a', 'INSTITUTION', 'Outside', 1), place('b', 'EXPERT', 'Outside', 2), place('c', 'ADVISOR', 'Outside', 3), place('d', 'USER', 'Own', 4)]} cropHasChecked onAdd={vi.fn()} onLeave={vi.fn()} />);
        for (const id of ['a', 'b', 'c', 'd']) expect(screen.getByTestId(`followed-logo-${id}`)).toBeInTheDocument();
        expect(screen.getByTestId('three-plus-one-tiles')).toHaveClass('grid-cols-2');
        expect(document.querySelectorAll('img').length).toBe(0);
    });
});
