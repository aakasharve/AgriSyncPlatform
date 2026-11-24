// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; owner messages are slice 12b) - the one line for a NEW owner voice shows nothing while none is
 * unheard. There is no data source yet, so the slot is given an empty list by the page and never invents a voice.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OwnerVoiceSlot } from '../OwnerVoiceSlot';

afterEach(() => cleanup());
describe('owner voice slot', () => {
    it('draws nothing with no voices', () => {
        const { container } = render(<OwnerVoiceSlot voices={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
    it('draws nothing when every voice is already heard', () => {
        const { container } = render(<OwnerVoiceSlot voices={[{ id: 'v1', title: 'x', fromName: 'y', heard: true }]} />);
        expect(container).toBeEmptyDOMElement();
    });
    it('draws ONE line for the newest unheard voice', () => {
        render(<OwnerVoiceSlot voices={[{ id: 'v1', title: 'पावसामुळे बदल', fromName: 'श्रमसफल', heard: false }, { id: 'v2', title: 'जुनी', fromName: 'श्रमसफल', heard: false }]} />);
        expect(screen.getAllByTestId('owner-voice-line')).toHaveLength(1);
        expect(screen.getByText(/पावसामुळे बदल/)).toBeInTheDocument();
    });
});
