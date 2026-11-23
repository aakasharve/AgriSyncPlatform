/** spec: voice-flow-v2-2026-11-23 — the step list's signal: real events only, never throws. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteVoiceJourney, readVoiceJourney, resetVoiceJourneyForTests, subscribeVoiceJourney } from '../voiceJourneySignal';
import type { AgriLogResponse } from '../../../domain/types/log.types';

const draft = { summary: 'x' } as unknown as AgriLogResponse;

afterEach(() => resetVoiceJourneyForTests());

describe('voiceJourneySignal', () => {
    it('kept starts a journey; the others fill it in order', () => {
        noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 4000 }, 100);
        expect(readVoiceJourney()).toMatchObject({ startedAt: 100, keptAt: 100, input: 'audio', durationMs: 4000 });
        noteVoiceJourney({ kind: 'understood', draft }, 200);
        noteVoiceJourney({ kind: 'placeChecked', result: 'same' }, 210);
        noteVoiceJourney({ kind: 'written', logIds: ['a', 'b'] }, 300);
        expect(readVoiceJourney()).toMatchObject({ understoodAt: 200, place: 'same', placeAt: 210, writtenAt: 300, logIds: ['a', 'b'] });
    });
    it('events without a journey are ignored', () => {
        noteVoiceJourney({ kind: 'written', logIds: ['a'] }, 1);
        expect(readVoiceJourney()).toBeNull();
    });
    it('a second kept replaces the journey (a new snapshot object each time)', () => {
        noteVoiceJourney({ kind: 'kept', input: 'audio' }, 1);
        const first = readVoiceJourney();
        noteVoiceJourney({ kind: 'understood', draft }, 2);
        expect(readVoiceJourney()).not.toBe(first);
        noteVoiceJourney({ kind: 'kept', input: 'text' }, 3);
        expect(readVoiceJourney()).toEqual({ startedAt: 3, input: 'text', durationMs: undefined, keptAt: 3 });
    });
    it('a throwing listener neither stops the others nor throws out', () => {
        const good = vi.fn();
        subscribeVoiceJourney(() => { throw new Error('boom'); });
        subscribeVoiceJourney(good);
        expect(() => noteVoiceJourney({ kind: 'kept', input: 'audio' })).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
    });
    it('unsubscribe stops the calls', () => {
        const l = vi.fn();
        const off = subscribeVoiceJourney(l);
        off();
        noteVoiceJourney({ kind: 'kept', input: 'audio' });
        expect(l).not.toHaveBeenCalled();
    });
});
