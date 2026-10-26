/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H16)
 *
 * The server sends `AttentionRank` and `SuggestedActionKind` as ORDINAL NUMBERS (C# enums, no string enum
 * converter registered — `AttentionCardDto.cs`, `SuggestedActionKind.cs`). These pin the ordinal → name
 * tables to the C# declarations and the button each action gets.
 */
import { describe, expect, it } from 'vitest';
import { attentionRankOf, attentionRankOrder, suggestedActionOf } from '../attentionWire';
import { attentionTargetFor, isComplianceSignalCard } from '../attentionActions';

describe('reading the wire', () => {
    it('rank ordinals follow `enum AttentionRank { Critical = 0, NeedsAttention = 1, Watch = 2, Healthy = 3 }`', () => {
        expect([0, 1, 2, 3].map(attentionRankOf)).toEqual(['Critical', 'NeedsAttention', 'Watch', 'Healthy']);
    });

    it('action ordinals follow `SuggestedActionKind` (OpenPlot = 0 … RetryFailedSync = 5)', () => {
        expect([0, 1, 2, 3, 4, 5].map(suggestedActionOf)).toEqual(
            ['OpenPlot', 'OpenStageCompare', 'AssignTest', 'ResolveDispute', 'ReviewOverdueTasks', 'RetryFailedSync'],
        );
    });

    it('names (any case) and ordinals as text are read too — old rows and a later server keep working', () => {
        expect(attentionRankOf('Critical')).toBe('Critical');
        expect(attentionRankOf('needsAttention')).toBe('NeedsAttention');
        expect(attentionRankOf('2')).toBe('Watch');
        expect(suggestedActionOf('assignTest')).toBe('AssignTest');
        expect(suggestedActionOf(' 4 ')).toBe('ReviewOverdueTasks');
    });

    it('anything else is unknown — never guessed into a band or an action', () => {
        for (const v of [4, -1, 1.5, 'Severe', '', null, undefined, {}]) expect(attentionRankOf(v)).toBeNull();
        for (const v of [6, 'Open', null]) expect(suggestedActionOf(v)).toBeNull();
    });

    it('most serious first; an unreadable rank last', () => {
        const ranks = [2, 'Healthy', 'Severe', 0, 1];
        expect([...ranks].sort((a, b) => attentionRankOrder(a) - attentionRankOrder(b))).toEqual([0, 1, 2, 'Healthy', 'Severe']);
    });
});

describe('where each numeric action leads (H16)', () => {
    const go = (suggestedAction: number, hidden: ('compare' | 'reflect' | 'log')[] = []) =>
        attentionTargetFor({ suggestedAction, suggestedActionLabelEn: 'x', suggestedActionLabelMr: 'x' }, hidden);

    it('maps every ordinal the server sends', () => {
        expect(go(0)).toEqual({ kind: 'view', view: 'reflect' });
        expect(go(1)).toEqual({ kind: 'view', view: 'compare' });
        expect(go(2)).toEqual({ kind: 'tests' });
        expect(go(3)).toBeNull();
        expect(go(4)).toEqual({ kind: 'route', route: 'schedule' });
        expect(go(5)).toEqual({ kind: 'sync' });
        expect(go(9)).toBeNull();
    });

    it('a worker (तुलना hidden) gets no तुलना button', () => {
        expect(go(1, ['compare'])).toBeNull();
    });

    it('a compliance-signal card goes by the action it maps to — never to the still-English चेतावण्या page (I14-V2F-01)', () => {
        const signal = { suggestedAction: 2, suggestedActionLabelEn: 'View compliance signal', suggestedActionLabelMr: 'अनुपालन सिग्नल पहा' };
        expect(isComplianceSignalCard(signal)).toBe(true);
        expect(isComplianceSignalCard({ ...signal, suggestedActionLabelEn: undefined })).toBe(true);
        expect(attentionTargetFor(signal)).toEqual({ kind: 'tests' });
        expect(attentionTargetFor({ ...signal, suggestedAction: 3 })).toBeNull();
    });
});
