// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-1F Task 4 (R7, R8): what the page says under the schedule a plot
 * ALREADY follows when ShramSafal's check does not stand behind it - a sample kept after its crop got a checked schedule, and a
 * schedule whose check was withdrawn. The newer-version button opens the library.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FollowedCheckNoteLine } from '../WhereYouAre';
import { followedCheckNote } from '../followedCheck';
import { SC } from '../scheduleCopy';

describe('followedCheckNote', () => {
    it('a checked schedule says nothing', () => {
        expect(followedCheckNote({ check: { state: 'Checked' } }, undefined, true)).toBeNull();
    });

    it('a followed sample is kept; the new-version button appears only once the crop has a checked schedule', () => {
        expect(followedCheckNote({}, undefined, false)).toEqual({ kind: 'sample', reason: '', offerNew: false });
        expect(followedCheckNote({ check: { state: 'NotChecked' } }, undefined, true)).toEqual({ kind: 'sample', reason: '', offerNew: true });
    });

    it('a withdrawn check says why, from the server\'s own note', () => {
        expect(followedCheckNote({ check: { state: 'Withdrawn', note: 'wrong dose' } }, undefined, true)).toEqual({ kind: 'withdrawn', reason: 'wrong dose', offerNew: true });
        // Only the subscription says it (the template is not cached): still withdrawn, no invented reason.
        expect(followedCheckNote({}, 'Withdrawn', false)).toEqual({ kind: 'withdrawn', reason: '', offerNew: false });
    });
});

describe('FollowedCheckNoteLine', () => {
    afterEach(() => cleanup());

    it('shows the withdrawn words with the reason and the take-new button, which opens the library', () => {
        const onLibrary = vi.fn();
        render(<FollowedCheckNoteLine note={{ kind: 'withdrawn', reason: 'wrong dose', offerNew: true }} onLibrary={onLibrary} />);

        expect(screen.getByTestId('followed-withdrawn')).toHaveTextContent('श्रमसफलने तपासणी मागे घेतली: wrong dose');
        expect(SC.takeNewChecked).toBe('नवीन तपासलेलं शेड्यूल घ्या');
        fireEvent.click(screen.getByTestId('followed-take-new'));
        expect(onLibrary).toHaveBeenCalledTimes(1);
    });

    it('a followed sample with no checked schedule yet shows no button and no withdrawn words', () => {
        render(<FollowedCheckNoteLine note={{ kind: 'sample', reason: '', offerNew: false }} onLibrary={vi.fn()} />);
        expect(screen.queryByTestId('followed-take-new')).toBeNull();
        expect(screen.queryByTestId('followed-withdrawn')).toBeNull();
    });

    it('a followed sample once the crop has a checked schedule shows the button', () => {
        render(<FollowedCheckNoteLine note={{ kind: 'sample', reason: '', offerNew: true }} onLibrary={vi.fn()} />);
        expect(screen.getByTestId('followed-take-new')).toHaveTextContent('नवीन तपासलेलं शेड्यूल घ्या');
    });
});
