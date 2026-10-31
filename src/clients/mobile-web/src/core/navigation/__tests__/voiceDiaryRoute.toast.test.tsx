// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 2, N4) — the आवाज नोंदी page's toasts go out as
 * what they are: a failure is a failure (red), never a green success.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { VoiceNoteCheckDeps } from '../../../features/voiceDiary/waiting/WaitingVoiceNotes';

const seen = vi.hoisted(() => ({ waiting: undefined as VoiceNoteCheckDeps | undefined }));
vi.mock('../lazyComponents', async (orig) => ({
    ...(await orig<typeof import('../lazyComponents')>()),
    VoiceDiaryPage: (p: { waiting?: VoiceNoteCheckDeps }) => { seen.waiting = p.waiting; return null; },
}));

import { renderVoiceDiaryRoute } from '../simpleRoutes';
import type { AppRouterContext } from '../routeContext';

const ctx = {
    currentRoute: 'voiceDiary', mainView: 'log', activeFarmId: 'farm-1', crops: [], farmerProfile: {}, history: [],
    saveCheckedDraft: vi.fn(), goBackOr: vi.fn(),
} as unknown as AppRouterContext;

afterEach(() => { cleanup(); seen.waiting = undefined; });

describe('the आवाज नोंदी route — toasts keep their kind (N4)', () => {
    it.each(['error', 'partial', 'success'] as const)('a %s toast keeps its kind', (type) => {
        render(<>{renderVoiceDiaryRoute(ctx)}</>);
        const got: Array<{ message: string; type: string }> = [];
        const listen = (e: Event) => got.push((e as CustomEvent).detail);
        window.addEventListener('agrisync:toast', listen);
        seen.waiting?.toast('words', type);
        window.removeEventListener('agrisync:toast', listen);
        expect(got).toEqual([{ message: 'words', type }]);
    });
});
