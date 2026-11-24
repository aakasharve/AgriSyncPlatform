/**
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-23: "there is no field called पीक and it would always remain blank, so remove
 * that, and instead add Disturbance - अडथळा". The v2 ring: no 'cropNote' orb; 'blockers' always present, grey when not told.
 */
import { describe, expect, it } from 'vitest';
import { ringNodesV2 } from '../resultModel';

describe('ringNodesV2', () => {
    it('drops पीक निरीक्षण and always shows अडथळा', () => {
        const nodes = ringNodesV2({ work: 'told', labour: 'neutral', cropNote: 'neutral', observations: 'told' });
        const ids = nodes.map(n => n.id);
        expect(ids).not.toContain('cropNote');
        expect(ids).toContain('blockers');
        expect(nodes.find(n => n.id === 'blockers')).toMatchObject({ label: 'अडथळा', state: 'neutral' });
    });
    it('a not-told part is the red invitation, but अडथळा stays grey', () => {
        const nodes = ringNodesV2({ work: 'told', labour: 'neutral' });
        expect(nodes.find(n => n.id === 'labour')?.state).toBe('missed');
        expect(nodes.find(n => n.id === 'blockers')?.state).toBe('neutral');
    });
    it('a told disturbance lights अडथळा', () => {
        expect(ringNodesV2({ blockers: 'told' }).find(n => n.id === 'blockers')?.state).toBe('told');
    });
});
