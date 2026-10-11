// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 (labour-v2-release-1) — the Profile menu's "कामगार व्यवस्थापन ·
 * Labour" row carried "हजेरी · मजुरी · उचल" as its subtitle, live and
 * reachable from every account with a farm (not behind any SHOW_* flag).
 * "हजेरी" (attendance) is one of three headline words the row uses to
 * describe the feature it opens, but there is no attendance capture
 * anywhere in the Labour feature — the hub hero is a doorway to the generic
 * log mic, not a recorder. P4/P5.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SetupHubMenu } from '../SetupHubMenu';

const baseProps = () => ({
    farmerName: 'Test Farmer',
    verified: false,
    items: [],
    onSelect: vi.fn(),
    logout: vi.fn(),
});

describe('SetupHubMenu — Labour row honesty (Task 7)', () => {
    afterEach(() => cleanup());

    it('does not claim हजेरी (attendance) in the Labour row subtitle', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText('कामाचा हिशोब')).toBeInTheDocument();
        expect(screen.queryByText(/हजेरी/)).toBeNull();
    });

    it('keeps मजुरी in the subtitle — the surgical deletion removes only हजेरी', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText(/मजुरी/)).toBeInTheDocument();
    });

    // Task 7b (labour-v2-release-1) — उचल (advance) does not exist as a
    // system: no table, no write path, no engine (GetLabourDataHandler.cs:205
    // hardcodes `advance = 0m` server-side). This subtitle promised it as a
    // headline capability of Labour Management, standing beside the हजेरी
    // claim Task 7 already removed from this same string.
    it('does not claim उचल (advance) in the Labour row subtitle', () => {
        render(<SetupHubMenu {...baseProps()} onOpenLabour={vi.fn()} />);
        expect(screen.getByText('कामाचा हिशोब')).toBeInTheDocument();
        expect(screen.queryByText(/उचल/)).toBeNull();
    });
});

// Journey fix D10 - Marathi `X पैकी Y` means "Y out of X": the TOTAL comes
// before पैकी. The card said `{done} पैकी {total}`, i.e. "4 पैकी 5 पूर्ण" for
// 4 done of 5, which reads as "5 of 4 complete".
describe('SetupHubMenu - the setup progress count reads the right way round', () => {
    afterEach(() => cleanup());

    it('4 of 5 done: Marathi says 5 पैकी 4 पूर्ण, never 4 पैकी 5 पूर्ण; English agrees', () => {
        render(<SetupHubMenu {...baseProps()} setupProgress={{ done: 4, total: 5, percent: 80, nextLabel: 'x' }} />);
        expect(screen.getByText(/5 पैकी 4 पूर्ण/)).toBeInTheDocument();
        expect(screen.getByText(/4 of 5 complete/)).toBeInTheDocument();
        expect(screen.queryByText(/4 पैकी 5/)).toBeNull();
    });
});
