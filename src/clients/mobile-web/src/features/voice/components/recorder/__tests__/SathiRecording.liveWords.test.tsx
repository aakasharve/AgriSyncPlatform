// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — the recording screen's words strip shows
 * the words heard so far, plainly, and NOTHING else on the screen changes: the ring stays quiet (the sorting into parts happens only
 * after he stops, on the real answer), and the strip keeps its calm line until words exist.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = {
        isRecording: true, seconds: 6, level: 0.3, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(),
        flowV2: { silenceHelp: true, card: { armSeq: 0, placeLabel: () => 'द्राक्ष · प्लॉट १' } }, ...over,
    };
    const view = render(<RecorderFace {...props} />);
    return { rerender: (o: Partial<RecorderFaceProps>) => view.rerender(<RecorderFace {...props} {...o} />) };
}

afterEach(cleanup);

describe('the words strip on the v2 recording screen', () => {
    it('shows the calm line until the first words arrive', () => {
        face();

        const strip = screen.getByTestId('sathi-words-strip');
        expect(strip).toHaveTextContent(VOICE_FLOW_MR.wordsStrip);
        expect(strip).toHaveAttribute('data-live', 'no');
    });

    it('shows the words heard so far, plain, as they grow', () => {
        const { rerender } = face({ liveWords: 'आज पाच मजूर होते' });
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('आज पाच मजूर होते');
        expect(screen.getByTestId('sathi-words-strip')).toHaveAttribute('data-live', 'yes');

        rerender({ liveWords: 'आज पाच मजूर होते चार तास Mancozeb फवारणी' });
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('आज पाच मजूर होते चार तास Mancozeb फवारणी');
        expect(screen.getByTestId('sathi-words-strip')).not.toHaveTextContent(VOICE_FLOW_MR.wordsStrip);
    });

    it('words that are only spaces still show the calm line', () => {
        face({ liveWords: '   ' });

        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent(VOICE_FLOW_MR.wordsStrip);
    });

    it('the words are NOT sorted: the ring stays quiet and nothing is lit while he speaks (P4)', () => {
        face({ liveWords: 'आज पाच मजूर होते चार तास फवारणी केली कॉन्फिडॉर अडीचशे एमएल' });

        const ring = screen.getByTestId('sathi-ring');
        expect(ring.getAttribute('data-lit')).toBe('0');
        for (const node of ring.querySelectorAll('[data-state]')) expect(node.getAttribute('data-state')).toBe('quiet');
    });

    it('the rest of the screen is the same: bubble, clock, stop and cancel, and the status still says "फोनवर"', () => {
        face({ liveWords: 'आज पाच मजूर' });

        expect(screen.getByTestId('mic-listening')).toHaveTextContent(VOICE_FLOW_MR.sathiListening);
        expect(screen.getByTestId('mic-clock')).toHaveTextContent('00:06');
        expect(screen.getByTestId('mic-stop')).toBeInTheDocument();
        expect(screen.getByTestId('mic-cancel')).toBeInTheDocument();
        expect(screen.getByTestId('sathi-status')).toHaveTextContent('फोनवर');
        expect(screen.getByTestId('sathi-status').textContent).not.toContain('सर्व्हरवर');
    });

    it('the plain recorder (no v2 flow) is untouched: no strip, whatever words are passed', () => {
        face({ flowV2: undefined, liveWords: 'आज पाच मजूर' });

        expect(screen.queryByTestId('sathi-words-strip')).not.toBeInTheDocument();
    });
});
