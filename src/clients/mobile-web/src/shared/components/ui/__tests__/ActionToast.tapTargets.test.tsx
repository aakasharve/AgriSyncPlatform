// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ActionToast — tap-target sizing (Task 21, spec: 2026-08-28-labour-v2-release-1).
 *
 * The Labour V2 UI audit found this toast's retry/action affordance sized at
 * ~34px, against the Labour feature's own floor: "no interactive element
 * below 56px tall" (`LabourHub.tsx`, "FARMER-FIRST SIZING" — Android's floor
 * is 48px; the feature adds headroom for imprecise touch and cracked
 * screens, same farmer, same cheap phone, same bright sun). Both of this
 * toast's interactive elements — the optional action/retry button and the
 * always-present dismiss button — must meet that floor.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ActionToast from '../ActionToast';

afterEach(cleanup);

describe('ActionToast — 56px tap targets', () => {
    it('the dismiss button meets the feature\'s 56px floor', () => {
        render(<ActionToast message="Saved" onDismiss={() => {}} />);
        const dismiss = screen.getByTestId('action-toast-dismiss');
        expect(dismiss.className).toContain('min-h-[56px]');
        expect(dismiss.className).toContain('min-w-[56px]');
    });

    it('the action (retry) button meets the feature\'s 56px floor', () => {
        render(
            <ActionToast
                message="Partial"
                type="partial"
                actionLabel="पुन्हा पाठवा"
                onAction={() => {}}
                onDismiss={() => {}}
            />
        );
        const action = screen.getByTestId('action-toast-action');
        expect(action.className).toContain('min-h-[56px]');
    });
});
