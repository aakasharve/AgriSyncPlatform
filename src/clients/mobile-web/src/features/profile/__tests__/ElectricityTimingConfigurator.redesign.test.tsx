// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the redesigned electricity timetable
 * keeps the REAL model (single- AND three-phase, OFF-window arrays with repeat rule and days, the
 * alternate week B) and saves it through `onUpdate` exactly as before; only the look and words changed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ElectricityTimingConfigurator from '../components/ElectricityTimingConfigurator';
import { VerificationStatus, type ElectricityTimingConfiguration, type FarmerProfile } from '../../../domain/types/farm.types';
import { farmerClock, offAtHour, summarizeWeek } from '../components/electricityTiming';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const timing = (): ElectricityTimingConfiguration => ({
    singlePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [{ id: 'sp', startTime: '18:00', endTime: '20:00', repeatRule: 'DAILY', days: ALL_DAYS }], weekBOffWindows: [] },
    threePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] },
});

const profileWith = (electricityTiming?: ElectricityTimingConfiguration): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    electricityTiming,
});

const saved = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[fn.mock.calls.length - 1][0] as FarmerProfile).electricityTiming!;

describe('ElectricityTimingConfigurator (redesigned) — single- and three-phase, saved through onUpdate', () => {
    afterEach(() => cleanup());

    it('asks for both phases, in Marathi, with hours on/off and a 24-hour strip', () => {
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('phase-singlePhase')).toHaveTextContent('सिंगल फेज');
        expect(screen.getByTestId('phase-threePhase')).toHaveTextContent('थ्री फेज');
        expect(screen.getByTestId('off-singlePhase-A')).toHaveTextContent('2 तास');
        expect(screen.getByTestId('on-singlePhase-A')).toHaveTextContent('22 तास');
        expect(screen.getByTestId('on-threePhase-A')).toHaveTextContent('24 तास');
        const offHours = screen.getByTestId('strip-singlePhase-A').querySelectorAll('[data-off="true"]');
        expect(offHours).toHaveLength(2);
    });

    it('sets a three-phase OFF window across midnight and saves it in the stored model; single phase untouched', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('nocut-threePhase-A'));
        fireEvent.change(screen.getByTestId('start-threePhase-A'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByTestId('end-threePhase-A'), { target: { value: '10:00' } });
        expect(screen.getByTestId('off-threePhase-A')).toHaveTextContent('16 तास');
        fireEvent.click(screen.getByTestId('power-save'));

        const t = saved(onUpdate);
        expect(t.threePhase.weekAOffWindows).toHaveLength(1);
        expect(t.threePhase.weekAOffWindows[0]).toMatchObject({ startTime: '18:00', endTime: '10:00', repeatRule: 'DAILY', days: ALL_DAYS });
        expect(t.threePhase.patternMode).toBe('FIXED_WEEKLY');
        expect(t.singlePhase.weekAOffWindows[0]).toMatchObject({ id: 'sp', startTime: '18:00', endTime: '20:00' });
        expect(typeof t.updatedAt).toBe('string');
        expect(screen.getByTestId('power-msg')).toHaveTextContent('वीज वेळ जतन झाली');
    });

    it('"रोज वीज जात नाही" stores no OFF window', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={onUpdate} />);
        const noCut = screen.getByTestId('nocut-singlePhase-A');
        expect(noCut).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(noCut);
        fireEvent.click(screen.getByTestId('power-save'));
        expect(saved(onUpdate).singlePhase.weekAOffWindows).toEqual([]);
    });

    it('the alternate week turns ROTATIONAL with its own week-B window', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={onUpdate} />);
        expect(screen.queryByTestId('week-threePhase-B')).toBeNull();
        fireEvent.click(screen.getByTestId('alternate-threePhase'));
        expect(screen.getByTestId('week-threePhase-A')).toHaveTextContent('आठवडा अ');
        expect(screen.getByTestId('week-threePhase-B')).toHaveTextContent('आठवडा ब');
        fireEvent.click(screen.getByTestId('nocut-threePhase-B'));
        fireEvent.change(screen.getByTestId('start-threePhase-B'), { target: { value: '06:00' } });
        fireEvent.change(screen.getByTestId('end-threePhase-B'), { target: { value: '22:00' } });
        fireEvent.click(screen.getByTestId('power-save'));
        const t = saved(onUpdate);
        expect(t.threePhase).toMatchObject({ patternMode: 'ROTATIONAL', alternateWeeklyPattern: true });
        expect(t.threePhase.weekBOffWindows?.[0]).toMatchObject({ startTime: '06:00', endTime: '22:00', repeatRule: 'DAILY' });
    });

    it('the same start and end is refused: Marathi error, save disabled, nothing saved', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={onUpdate} />);
        fireEvent.change(screen.getByTestId('end-singlePhase-A'), { target: { value: '18:00' } });
        expect(screen.getByTestId('error-singlePhase-A')).toHaveTextContent('एकच असू शकत नाही');
        expect(screen.getByTestId('power-errors')).toBeInTheDocument();
        expect(screen.getByTestId('power-save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('power-save'));
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('पूर्वीसारखं करा puts the stored timing back without saving', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(timing())} onUpdate={onUpdate} />);
        expect(screen.getByTestId('power-reset')).toBeDisabled();
        fireEvent.change(screen.getByTestId('end-singlePhase-A'), { target: { value: '23:00' } });
        expect(screen.getByTestId('off-singlePhase-A')).toHaveTextContent('5 तास');
        fireEvent.click(screen.getByTestId('power-reset'));
        expect(screen.getByTestId('off-singlePhase-A')).toHaveTextContent('2 तास');
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('with no timing stored yet, both phases start as "24 तास" and save the real shape', () => {
        const onUpdate = vi.fn();
        render(<ElectricityTimingConfigurator profile={profileWith(undefined)} onUpdate={onUpdate} />);
        fireEvent.click(screen.getByTestId('nocut-singlePhase-A'));
        fireEvent.click(screen.getByTestId('power-save'));
        const t = saved(onUpdate);
        expect(t.singlePhase.weekAOffWindows[0]).toMatchObject({ startTime: '12:00', endTime: '18:00', repeatRule: 'DAILY', days: ALL_DAYS });
        expect(t.threePhase).toEqual({ patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] });
    });
});

describe('electricityTiming rules', () => {
    const w = (startTime: string, endTime: string) => [{ id: 'x', startTime, endTime, repeatRule: 'DAILY' as const, days: ALL_DAYS }];

    it('a window across midnight is off on both sides of 12', () => {
        expect(offAtHour(w('18:00', '10:00'), 23)).toBe(true);
        expect(offAtHour(w('18:00', '10:00'), 3)).toBe(true);
        expect(offAtHour(w('18:00', '10:00'), 12)).toBe(false);
        expect(offAtHour([], 3)).toBe(false);
    });

    it('summarizes hours and refuses bad windows', () => {
        expect(summarizeWeek(w('18:00', '10:00'))).toEqual({ offMinutes: 16 * 60, onMinutes: 8 * 60, error: null });
        expect(summarizeWeek(w('09:00', '09:00')).error).toMatch(/एकच/);
        expect(summarizeWeek(w('25:00', '09:00')).error).toBe('वेळ नीट भरा');
    });

    it('reads a stored HH:mm with the shared day-period word and 12-hour clock', () => {
        expect(farmerClock('18:00')).toBe('संध्याकाळी 6:00 PM');
        expect(farmerClock('06:30')).toBe('सकाळी 6:30 AM');
        expect(farmerClock('bad')).toBe('bad');
    });
});
