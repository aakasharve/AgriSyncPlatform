// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF; review B007)
 *
 * ▶ through the page's REAL listen hook (`useDayListen` → `listenModel`), not a stub: only the clips on this phone are
 * stubbed (the Dexie scan and the audio element). What must hold: the clip on this phone plays here; the server's
 * "मूळ आवाज ऐका" appears only where the server would allow it — never on a worker's phone for the owner's older
 * record, whatever the profile's active operator says (review B001: the signed-in session only); a typed entry has
 * nothing to hear; and every view of one recording plays the clip of the log that carries his words.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const phone = vi.hoisted(() => ({ clips: new Map<string, { id: string; durationMs: number }>(), toggle: vi.fn(), asked: [] as string[][] }));
vi.mock('../../logs/components/voiceResult/useClipPlayback', async importOriginal => ({
    ...(await importOriginal<typeof import('../../logs/components/voiceResult/useClipPlayback')>()),
    useLogClips: (ids: readonly string[]) => { phone.asked.push([...ids]); return { clips: phone.clips, ready: true }; },
    useClipPlayback: () => ({ playingId: null, progress: 0, lengths: new Map(), heard: new Set(), toggle: phone.toggle, stop: vi.fn() }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import type { DailyLog } from '../../../types';
import { anyLog, dayRecordings, type DayRecording } from '../day/dayRecordings';
import type { Viewer } from '../day/listenModel';
import { ListenControl } from '../day/RecordingParts';
import { useDayListen } from '../day/useDayListen';
import { reflectCopy } from '../reflectCopy';
import { CROPS, TODAY_KEY, log } from './reflectFixtures';

const copy = reflectCopy('mr');
const at = (hhmm: string) => `2026-10-25T${hhmm}:00.000Z`;
const said = (id: string, hhmm: string, who: string, extra: Partial<DailyLog> & { plotIds?: string[] } = {}): DailyLog =>
    log({ id, meta: { createdAtISO: at(hhmm), createdByOperatorId: who, farmId: 'farm-1' }, ...extra });

const OWNER = 'owner-1';
const WORKER = 'worker-1';
/** A worker's phone after its first sync: the profile's active operator is the OWNER's id (profileAndCropsReconciler). */
const workerPhone: Viewer = { sessionUserId: WORKER, farmRole: 'Worker', farmId: 'farm-1' };
const ownerPhone: Viewer = { sessionUserId: OWNER, farmRole: 'PrimaryOwner', farmId: 'farm-1' };

const Harness: React.FC<{ recs: DayRecording[]; viewer: Viewer }> = ({ recs, viewer }) => {
    const listen = useDayListen(recs, viewer);
    return <>{recs.map(r => <div key={r.key} data-testid={`h-${r.view.id}`}><ListenControl rec={r} listen={listen} testId={`p-${r.view.id}`} /></div>)}</>;
};

const recsOf = (logs: DailyLog[], sessionUserId: string) =>
    dayRecordings(logs, TODAY_KEY, anyLog, { youIds: new Set([sessionUserId]), nameOf: () => undefined, youLabel: copy.you, unknownLabel: copy.unknownPerson }, CROPS);

afterEach(() => { cleanup(); phone.clips.clear(); phone.toggle.mockClear(); phone.asked = []; });

describe('useDayListen — the real gate behind ▶', () => {
    const ownersOld = () => said('old', '04:00', OWNER, { legacyPartial: true });
    const ownersFull = (words?: string) => said('full', '05:00', OWNER, { legacyPartial: false, ...(words ? { fullTranscript: words } : {}) });
    const workersOwn = () => said('mine', '06:00', WORKER, { fullTranscript: 'पाणी दिलं' });
    const typed = () => said('typed', '07:00', WORKER, { typedEntry: true, fullTranscript: 'पाणी दिलं' });

    it('a worker\'s phone: no server voice on the owner\'s older record or on a record whose words the server kept back', () => {
        const recs = recsOf([ownersOld(), ownersFull()], WORKER);
        render(<Harness recs={recs} viewer={workerPhone} />);
        expect(screen.queryByTestId('p-old-listen')).toBeNull();
        expect(screen.queryByTestId('ov-play-old')).toBeNull();
        expect(screen.queryByTestId('p-full-listen')).toBeNull();
    });

    it('the owner\'s phone: his older record offers "मूळ आवाज ऐका"; a record the server sent with his words does too', () => {
        const recs = recsOf([ownersOld(), ownersFull('छाटणी केली')], OWNER);
        render(<Harness recs={recs} viewer={ownerPhone} />);
        expect(screen.getByTestId('p-old-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.getByTestId('ov-play-old')).toBeInTheDocument();
        expect(screen.getByTestId('p-full-listen')).toHaveAttribute('data-listen', 'server');
    });

    it('a worker\'s own record: his voice from the server (he is the speaker); a typed entry: nothing to hear', () => {
        const recs = recsOf([workersOwn(), typed()], WORKER);
        render(<Harness recs={recs} viewer={workerPhone} />);
        expect(screen.getByTestId('p-mine-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.queryByTestId('p-typed-listen')).toBeNull();
    });

    it('the clip on this phone plays here — keyed by the log that carries his words, for every plot it named', () => {
        const a = said('two-a', '08:00', WORKER, { plotIds: ['g1'], fullTranscript: 'दोन्ही प्लॉटला पाणी' });
        const b = said('two-b', '08:00', WORKER, { plotIds: ['g2'] });
        phone.clips.set('two-a', { id: 'clip-a', durationMs: 4000 });
        const recs = recsOf([b, a], WORKER);
        render(<Harness recs={recs} viewer={workerPhone} />);
        expect(phone.asked.at(-1)).toEqual(['two-a']); // the phone is asked for the clip of the log with his words
        // one recording, one row (its view is named by the log with his words), one clip
        expect(screen.getByTestId('p-two-a-listen')).toHaveAttribute('data-listen', 'clip');
        fireEvent.click(screen.getByTestId('p-two-a'));
        expect(phone.toggle).toHaveBeenCalledWith('two-a', expect.objectContaining({ id: 'clip-a' }));
    });
});
