/**
 * safeTrim tests — voice-safetrim-harden-2026-06-10.
 *
 * Regression guard for the voice crash "x.trim is not a function": a
 * non-string response/input/session field reaching a `.trim()` call threw
 * synchronously and was surfaced to the farmer as "इनपुट तपासा /
 * e.trim is not a function", blocking the log. `safeTrim` must coerce any
 * non-string to '' (never throw) while preserving exact behavior for
 * legitimate string inputs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeTrim } from '../BackendAiClient';

describe('safeTrim', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('trims a normal string (behavior identical to .trim())', () => {
        expect(safeTrim(' a ', 'x')).toBe('a');
    });

    it('returns "" for a number without throwing', () => {
        expect(() => safeTrim(123, 'x')).not.toThrow();
        expect(safeTrim(123, 'x')).toBe('');
    });

    it('returns "" for null and undefined without warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(safeTrim(null, 'x')).toBe('');
        expect(safeTrim(undefined, 'x')).toBe('');
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns with the label when a non-string non-nullish value is passed', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        safeTrim({ id: 1 }, 'culpritField');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('culpritField');
    });

    it('does not warn for valid strings', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        safeTrim('hello', 'x');
        expect(warn).not.toHaveBeenCalled();
    });
});
