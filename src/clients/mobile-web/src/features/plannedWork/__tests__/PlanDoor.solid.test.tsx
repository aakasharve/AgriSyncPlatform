// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - the Home planning door is a SOLID blue card with white text, both kinds.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));
vi.mock('../data/usePlannedWork', () => ({ usePlannedWork: () => ({ items: [], loaded: true, parked: new Map(), reload: async () => undefined }) }));

import { PlanDoor } from '../components/PlanDoor';

afterEach(cleanup);

describe('PlanDoor is a solid blue card (D-146)', () => {
    for (const kind of ['plan', 'mine'] as const) {
        it(`kind ${kind}: blue fill, white text, white chip, same test ids`, () => {
            const onOpen = vi.fn();
            render(<PlanDoor kind={kind} farmId="f" userId="u" onOpen={onOpen} />);
            const door = screen.getByTestId('home-plan');
            expect(door).toHaveAttribute('data-kind', kind);
            expect(door.className).toContain('bg-[#1448E6]');
            expect(door.className).not.toContain('bg-white');
            expect(screen.getByTestId('home-plan-title').className).toContain('text-white');
            expect(screen.getByTestId('home-plan-count').className).toContain('bg-white');
            fireEvent.click(door);
            expect(onOpen).toHaveBeenCalledTimes(1);
        });
    }
});
