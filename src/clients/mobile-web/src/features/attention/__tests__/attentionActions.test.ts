/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, H16)
 *
 * A लक्ष द्या button goes where its action can be done and SAYS where it goes. A compliance-signal card carries
 * the server label "अनुपालन सिग्नल पहा" whatever its action; its page is still English, so the card goes by its
 * action and is labelled with the server's own words for that action (I14-V2F-01).
 */
import { describe, expect, it } from 'vitest';
import { attentionButtonLabelMr, attentionTargetFor, isComplianceSignalCard } from '../attentionActions';

const signal = (suggestedAction: unknown, plotId = 'p1') =>
    ({ suggestedAction, suggestedActionLabelEn: 'View compliance signal', suggestedActionLabelMr: 'अनुपालन सिग्नल पहा', plotId }) as never;

describe('attentionTargetFor / attentionButtonLabelMr', () => {
    it('no action ever opens the चेतावण्या (compliance) page', () => {
        for (const action of [0, 1, 2, 3, 4, 5, 'OpenPlot', 'AssignTest', 99, null]) {
            const target = attentionTargetFor(signal(action));
            expect(target && target.kind === 'route' ? target.route : null).not.toBe('compliance');
        }
    });

    it('a compliance-signal card is labelled by its real destination, in the server\'s own words', () => {
        expect(isComplianceSignalCard(signal(2))).toBe(true);
        expect(attentionButtonLabelMr(signal(2))).toBe('चाचण्या नियुक्त करा');
        expect(attentionButtonLabelMr(signal(1))).toBe('टप्पा तुलना पहा');
        expect(attentionButtonLabelMr(signal(4))).toBe('थकलेली कामे पहा');
        expect(attentionButtonLabelMr(signal(0))).toBe('तुकडा पहा');
        // a dispute, or an action we cannot read: no words, no button
        expect(attentionButtonLabelMr(signal(3))).toBeNull();
        expect(attentionButtonLabelMr(signal(99))).toBeNull();
    });

    it('any other card keeps the server\'s Marathi label', () => {
        expect(attentionButtonLabelMr({ suggestedAction: 4, suggestedActionLabelEn: 'Review overdue tasks', suggestedActionLabelMr: 'थकलेली कामे पहा' } as never)).toBe('थकलेली कामे पहा');
        expect(attentionButtonLabelMr({ suggestedAction: 5, suggestedActionLabelMr: '  ' } as never)).toBeNull();
    });

    it('"तुकडा पहा" carries the card\'s plot; a card without one opens the whole farm', () => {
        expect(attentionTargetFor(signal(0, 'plot-9'))).toEqual({ kind: 'view', view: 'reflect', plotId: 'plot-9' });
        expect(attentionTargetFor({ suggestedAction: 0 } as never)).toEqual({ kind: 'view', view: 'reflect' });
    });
});
