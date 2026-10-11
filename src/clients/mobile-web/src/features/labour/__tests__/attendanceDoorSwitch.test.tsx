// @vitest-environment jsdom
/**
 * Attendance door — per-device early-access switch (default OFF).
 * spec: 2026-08-25-prod-cutover-waves
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { isAttendanceDoorEnabled, setAttendanceDoorEnabled } from '../attendanceDoor';
import {
    createEarlyAccessTapHandler, consumeEarlyAccessUrlParam,
} from '../earlyAccess';
import LabourHub from '../components/LabourHub';
import { LABOUR_MOCK } from '../labourMock';


const noop = () => {};
const hubProps = () => ({
    data: LABOUR_MOCK,
    onOpenMukadam: noop,
    onOpenPerson: noop,
    onAttendance: noop,
    onNoWorkAttendance: noop,
    onDashboard: noop,
    onLedger: noop,
    onReview: noop,
    onGoToLog: noop,
});

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('attendance door switch - default OFF', () => {
    it('is OFF on a fresh device', () => {
        expect(isAttendanceDoorEnabled()).toBe(false);
    });

    it('fresh device: the hub shows no हजेरी घ्या tile (door unreachable)', () => {
        render(<LabourHub {...hubProps()} />);
        expect(screen.queryByText('हजेरी घ्या')).not.toBeInTheDocument();
        expect(screen.queryByText('काम झालं नाही, पण मजूर आले')).not.toBeInTheDocument();
    });

    it('ON shows the tile', () => {
        setAttendanceDoorEnabled(true);
        render(<LabourHub {...hubProps()} />);
        expect(screen.getByText('हजेरी घ्या')).toBeInTheDocument();
    });

    it('set(false) turns it OFF again', () => {
        setAttendanceDoorEnabled(true);
        setAttendanceDoorEnabled(false);
        expect(isAttendanceDoorEnabled()).toBe(false);
    });

    it('storage blocked => OFF, never throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(() => isAttendanceDoorEnabled()).not.toThrow();
        expect(isAttendanceDoorEnabled()).toBe(false);
        expect(setAttendanceDoorEnabled(true)).toBe(false);
        expect(isAttendanceDoorEnabled()).toBe(false);
    });
});

describe('7-tap activation', () => {
    it('fewer than 7 taps does nothing', () => {
        const tap = createEarlyAccessTapHandler();
        for (let i = 0; i < 6; i++) expect(tap()).toBeNull();
        expect(isAttendanceDoorEnabled()).toBe(false);
    });

    it('7 taps within 3s toggles ON, 7 more toggles OFF', () => {
        const tap = createEarlyAccessTapHandler();
        let r: boolean | null = null;
        for (let i = 0; i < 7; i++) r = tap();
        expect(r).toBe(true);
        expect(isAttendanceDoorEnabled()).toBe(true);
        for (let i = 0; i < 7; i++) r = tap();
        expect(r).toBe(false);
        expect(isAttendanceDoorEnabled()).toBe(false);
    });

    it('slow taps (spread beyond 3s) do not count', () => {
        let t = 0;
        const tap = createEarlyAccessTapHandler(() => t);
        for (let i = 0; i < 10; i++) { t += 1000; expect(tap()).toBeNull(); }
        expect(isAttendanceDoorEnabled()).toBe(false);
    });
});

describe('?early= URL param', () => {
    it('?early=attendance turns ON once and is stripped', () => {
        window.history.replaceState({}, '', '/labour?x=1&early=attendance#h');
        expect(consumeEarlyAccessUrlParam()).toBe(true);
        expect(isAttendanceDoorEnabled()).toBe(true);
        expect(window.location.search).toBe('?x=1');
        expect(window.location.hash).toBe('#h');
        expect(consumeEarlyAccessUrlParam()).toBeNull();
    });

    it('?early=attendance-off turns OFF and is stripped', () => {
        setAttendanceDoorEnabled(true);
        window.history.replaceState({}, '', '/?early=attendance-off');
        expect(consumeEarlyAccessUrlParam()).toBe(false);
        expect(isAttendanceDoorEnabled()).toBe(false);
        expect(window.location.search).toBe('');
    });

    it('unknown value changes nothing (still stripped)', () => {
        window.history.replaceState({}, '', '/?early=bogus');
        expect(consumeEarlyAccessUrlParam()).toBeNull();
        expect(isAttendanceDoorEnabled()).toBe(false);
        expect(window.location.search).toBe('');
    });
});
