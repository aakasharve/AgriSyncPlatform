// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-148 layout C, D-150) - the owner bar of the शेड्यूल tab: a slim white card with
 * a green top edge; the maker's picture place at the left (round for a person, square for an institution's logo, the letter or a leaf when there is no
 * picture), the small label "शेड्यूल बनवणारे", the maker's REAL name (never an invented one) and the schedule's name.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScheduleOwnerBar } from '../ScheduleOwnerBar';
import type { CropScheduleTemplate } from '../../scheduler.types';

afterEach(() => cleanup());

const tpl = (extra: Partial<CropScheduleTemplate> = {}): CropScheduleTemplate => ({
    id: 't', name: 'Grapes - University Schedule', cropCode: 'GRAPES', ownerType: 'INSTITUTION', createdBy: 'Test University', stages: [], periodicExpectations: [], oneTimeExpectations: [],
    ...extra,
}) as unknown as CropScheduleTemplate;

describe('the owner bar (D-148 layout C)', () => {
    it('a slim WHITE card with a green top edge - not the old black card', () => {
        render(<ScheduleOwnerBar template={tpl()} />);
        const bar = screen.getByTestId('sched-owner-bar');
        expect(bar.className).toContain('bg-white');
        expect(bar.className).toContain('border-t-emerald-600');
        expect(bar.className).not.toMatch(/stone-900|from-stone/);
    });

    it('the picture is 92 px, and 72 px under 360 px width (the founder\'s sizes)', () => {
        render(<ScheduleOwnerBar template={tpl()} />);
        const cls = screen.getByTestId('sched-badge').className;
        expect(cls).toContain('h-[72px]');
        expect(cls).toContain('w-[72px]');
        expect(cls).toContain('min-[360px]:h-[92px]');
        expect(cls).toContain('min-[360px]:w-[92px]');
    });

    it('label, the maker\'s real name, the kind of maker, and the schedule name (Marathi for the schedules the app ships)', () => {
        render(<ScheduleOwnerBar template={tpl()} />);
        expect(screen.getByTestId('sched-owner')).toHaveTextContent('शेड्यूल बनवणारे');
        expect(screen.getByTestId('sched-owner-name')).toHaveTextContent('Test University');
        expect(screen.getByTestId('sched-owner-type')).toHaveTextContent('संस्था');
        // a name an institution wrote is shown as written; the schedules the app ships are shown in Marathi
        expect(screen.getByTestId('sched-name')).toHaveTextContent('Grapes - University Schedule');
        cleanup();
        render(<ScheduleOwnerBar template={tpl({ name: 'Grapes - Standard Seasonal Template' })} />);
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष — हंगामी शेड्यूल');
    });

    it('an institution\'s picture place is SQUARE, a person\'s (and an expert\'s) ROUND; with no picture it shows the letter, or a leaf with no name', () => {
        const { rerender } = render(<ScheduleOwnerBar template={tpl({ ownerType: 'INSTITUTION' })} />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'square');
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'letter');
        expect(screen.getByTestId('sched-badge').textContent).toBe('T');
        rerender(<ScheduleOwnerBar template={tpl({ ownerType: 'USER', createdBy: 'अशोक पाटील' })} />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'round');
        expect(screen.getByTestId('sched-badge').textContent).toBe('अ');
        rerender(<ScheduleOwnerBar template={tpl({ ownerType: 'EXPERT' })} />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'round');
        rerender(<ScheduleOwnerBar template={tpl({ ownerType: 'SYSTEM_DEFAULT', createdBy: 'ShramSafal Reference Data' })} />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'leaf');
        expect(screen.getByTestId('sched-badge').querySelector('svg')).not.toBeNull();
    });

    it('it NEVER invents a name: the catalog\'s own tag is not a maker, so the line says who made it in the app\'s own words', () => {
        const { rerender } = render(<ScheduleOwnerBar template={tpl({ ownerType: 'SYSTEM_DEFAULT', createdBy: 'ShramSafal Reference Data' })} />);
        expect(screen.getByTestId('sched-owner-name')).toHaveTextContent('ॲपमधलं मूळ शेड्यूल');
        expect(screen.queryByTestId('sched-owner-type')).toBeNull();
        expect(document.body.textContent).not.toContain('ShramSafal Reference Data');
        rerender(<ScheduleOwnerBar template={tpl({ ownerType: 'USER', createdBy: '' })} />);
        expect(screen.getByTestId('sched-owner-name')).toHaveTextContent('शेतकऱ्याने स्वतः बनवलेलं'); // "the farmer made it", the app's existing words
        expect(screen.queryByTestId('sched-owner-type')).toBeNull();
    });

    it('it accepts an optional picture: shown in the same place and shape when given; nothing is drawn from nowhere when not', () => {
        const { rerender } = render(<ScheduleOwnerBar template={tpl({ ownerType: 'INSTITUTION' })} imageUrl="https://example.test/logo.png" />);
        const badge = screen.getByTestId('sched-badge');
        expect(badge).toHaveAttribute('data-kind', 'image');
        expect(badge).toHaveAttribute('data-shape', 'square');
        expect(badge.querySelector('img')).toHaveAttribute('src', 'https://example.test/logo.png');
        rerender(<ScheduleOwnerBar template={tpl({ ownerType: 'USER', createdBy: 'अशोक पाटील' })} imageUrl="https://example.test/face.jpg" />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'round');
        expect(screen.getByTestId('sched-badge').querySelector('img')).not.toBeNull();
        rerender(<ScheduleOwnerBar template={tpl()} />);
        expect(screen.getByTestId('sched-badge').querySelector('img')).toBeNull();
    });
});
