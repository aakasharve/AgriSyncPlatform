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
 * anywhere in the Labour feature — LabourMic is a doorway to the generic
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
        expect(screen.getByText('कामगार व्यवस्थापन · Labour')).toBeInTheDocument();
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
        expect(screen.getByText('कामगार व्यवस्थापन · Labour')).toBeInTheDocument();
        expect(screen.queryByText(/उचल/)).toBeNull();
    });
});
