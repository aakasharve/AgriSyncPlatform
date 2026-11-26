// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — the v2 recording stage, full screen as the approved design: Sathi's bubble, the ring
 * of the nine v2 parts (no पीक, अडथळा present) around his orb, the bare field card, the honest status line and the red
 * stop. While he speaks NOTHING is understood: every node stays grey and the field stays bare, whatever the level or
 * time (P4). The orb's mood follows the real level; the stop holds the stage still (Sathi nods) until it is replaced.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { PONDER_AFTER_MS, sathiMoodOf } from '../SathiOrb';
import { recordingNodes } from '../SathiRing';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flowV2 = { silenceHelp: true, placeLabel: () => 'द्राक्ष · प्लॉट २', plotLabel: () => 'प्लॉट २', days: 18 };

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = { isRecording: true, seconds: 0, level: 0.3, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), flowV2, ...over };
    const view = render(<RecorderFace {...props} />);
    let current = props;
    return { props, rerender: (o: Partial<RecorderFaceProps>) => { current = { ...current, ...o }; view.rerender(<RecorderFace {...current} />); } };
}
const nodeStates = () => [...document.querySelectorAll('[data-testid^="ring-node-"]')].map(n => n.getAttribute('data-state'));
const mood = () => screen.getByTestId('sathi-orb').getAttribute('data-mood');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SathiRingStage — the ring while he speaks', () => {
    it('nine v2 nodes in the design order: no पीक, अडथळा present', () => {
        expect(recordingNodes().map(n => n.id)).toEqual(['work', 'labour', 'inputs', 'water', 'machinery', 'blockers', 'expenses', 'observations', 'reminders']);
        face();
        expect(nodeStates()).toHaveLength(9);
        const labels = [...document.querySelectorAll('[data-testid^="ring-node-"]')].map(n => n.getAttribute('data-label'));
        expect(labels).toContain('अडथळा');
        expect(labels.join(' ')).not.toContain('पीक');
        expect(screen.queryByTestId('ring-node-cropNote')).toBeNull();
    });

    it('every node stays neutral grey and the field stays bare, however long or loud he speaks (no live parse, P4)', () => {
        const { rerender } = face({ level: 0.6 });
        expect(new Set(nodeStates())).toEqual(new Set(['neutral']));
        for (let s = 1; s <= 40; s += 1) { rerender({ seconds: s, level: s % 2 ? 0.6 : 0.02 }); advance(1000); }
        expect(new Set(nodeStates())).toEqual(new Set(['neutral']));
        expect(screen.getByTestId('field-card')).toHaveAttribute('data-filled', 'no');
        expect(screen.queryAllByTestId('field-worker')).toHaveLength(0);
    });
});

describe('SathiRingStage — the frame, the words, the footer', () => {
    it('full screen: the place chip, "या महिन्यात N दिवस", the field card of his plot, the stop and the cancel', () => {
        face();
        expect(screen.getByTestId('v2-shell-rec')).toBeInTheDocument();
        expect(screen.getByTestId('v2-place')).toHaveTextContent('द्राक्ष · प्लॉट २');
        expect(screen.getByTestId('v2-days')).toHaveTextContent('या महिन्यात १८ दिवस');
        expect(screen.getByTestId('field-title')).toHaveTextContent('तुमचं शेत · प्लॉट २');
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent(VOICE_FLOW_MR.stopSide);
        expect(screen.getByTestId('mic-cancel')).toBeInTheDocument();
        expect(screen.getByTestId('mic-sathi-hello')).toHaveTextContent(VOICE_FLOW_MR.sathiHello);
        expect(screen.queryAllByRole('status')).toHaveLength(0); // no live region while the mic is open
    });

    it('the status line counts only the seconds the phone holds, never the server (P10), and says nothing at 0', () => {
        const { rerender } = face({ seconds: 0 });
        expect(screen.getByTestId('mic-safe').textContent).toBe('');
        rerender({ seconds: 5 });
        expect(screen.getByTestId('mic-safe')).toHaveTextContent('५ सेकंद आवाज फोनवर सुरक्षित');
        expect(document.body.textContent).not.toContain('सर्व्हर');
    });

    it('the 9 s prompts take the field card\'s place; the example stays in the bubble', () => {
        face({ level: 0.02 });
        advance(9000);
        expect(screen.getByTestId('mic-hint-prompts')).toBeInTheDocument();
        expect(screen.queryByTestId('field-card')).toBeNull();
        expect(screen.getByTestId('mic-hint-coachOne')).toBeInTheDocument();
    });
});

describe('SathiRingStage — Sathi\'s mood from the real level', () => {
    it('listens while the level is up, ponders after ~2 s of quiet, listens again when he speaks', () => {
        const { rerender } = face({ level: 0.3 });
        expect(mood()).toBe('listen');
        advance(3000);
        expect(mood()).toBe('listen'); // a steady loud level is still speech
        rerender({ level: 0.02 });
        advance(PONDER_AFTER_MS + 300);
        expect(mood()).toBe('ponder');
        rerender({ level: 0.4 });
        expect(mood()).toBe('listen');
    });

    it('a level the phone cannot measure is never read as quiet: he keeps listening, no ripple', () => {
        face({ level: undefined });
        advance(6000);
        expect(mood()).toBe('listen');
        expect(screen.queryByTestId('sathi-ripple')).toBeNull();
    });

    it('ripples leave the orb only while the level is above speech', () => {
        const { rerender } = face({ level: 0.02 });
        advance(1200);
        expect(screen.queryAllByTestId('sathi-ripple')).toHaveLength(0);
        rerender({ level: 0.5 });
        advance(600);
        expect(screen.queryAllByTestId('sathi-ripple').length).toBeGreaterThan(0);
    });

    it('the pure rule', () => {
        expect(sathiMoodOf({ stopped: false, lastLoudAt: 0, now: PONDER_AFTER_MS - 1 })).toBe('listen');
        expect(sathiMoodOf({ stopped: false, lastLoudAt: 0, now: PONDER_AFTER_MS })).toBe('ponder');
        expect(sathiMoodOf({ stopped: true, lastLoudAt: 0, now: 0 })).toBe('nod');
    });
});

describe('SathiRingStage — the stop', () => {
    it('one tap stops; Sathi nods and the stage holds still (no cancel) until it is replaced, at most 4 s', () => {
        const { props, rerender } = face({ level: 0.3, seconds: 7 });
        fireEvent.click(screen.getByTestId('mic-stop'));
        fireEvent.click(screen.getByTestId('mic-stop'));
        expect(props.onStop).toHaveBeenCalledTimes(1);
        expect(mood()).toBe('nod');
        rerender({ isRecording: false, level: undefined, seconds: 0 });
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-stopped', 'yes');
        expect(screen.queryByTestId('mic-cancel')).toBeNull();
        advance(4000);
        expect(screen.queryByTestId('v2-shell-rec')).toBeNull();
    });

    it('an error after the stop shows the face with the error at once', () => {
        const { rerender } = face({ level: 0.3 });
        fireEvent.click(screen.getByTestId('mic-stop'));
        rerender({ isRecording: false, error: 'माइक सुरू झाला नाही' });
        expect(screen.queryByTestId('v2-shell-rec')).toBeNull();
        expect(screen.getByTestId('mic-error')).toBeInTheDocument();
    });

    it('cancel still discards and says so', () => {
        const { props, rerender } = face();
        fireEvent.click(screen.getByTestId('mic-cancel'));
        expect(props.onCancel).toHaveBeenCalledTimes(1);
        rerender({ isRecording: false });
        expect(screen.queryByTestId('v2-shell-rec')).toBeNull();
        expect(screen.getByTestId('mic-cancelled')).toBeInTheDocument();
    });
});

describe('flag off', () => {
    it('without flowV2 the recording face is today\'s: no full-screen stage, no ring', () => {
        face({ flowV2: undefined });
        expect(screen.queryByTestId('v2-shell-rec')).toBeNull();
        expect(screen.queryByTestId('sathi-ring')).toBeNull();
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
        expect(screen.getByTestId('mic-listening')).toBeVisible();
    });
});
