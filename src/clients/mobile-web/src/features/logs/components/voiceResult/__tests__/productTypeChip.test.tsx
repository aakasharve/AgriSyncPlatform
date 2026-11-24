// @vitest-environment jsdom
/**
 * spec: voice-flow-v2-2026-11-23 (round 4) - a product Sathi understood is never labelled "ओळख नाही". An N-P-K grade name is a fertiliser
 * (the phone's own grade reader, `normaliseNpkGrade`); any other product whose type is unknown shows NO type chip, in both languages.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { lng } = vi.hoisted(() => ({ lng: { v: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { LogFactory } from '../../../../../core/domain/LogFactory';
import type { Clock } from '../../../../../core/domain/services/Clock';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../../types';
import { productBoxesOf } from '../productModel';
import { SavedProductRow } from '../../voiceFlowV2/SavedProducts';
import { ProductRow } from '../ProductRows';
import job from './fixtures/job_23d384ea.json';

const AT = '2026-11-24T05:00:00.000Z';
const clock: Clock = { now: () => new Date(AT), nowISO: () => AT, nowEpoch: () => Date.parse(AT) };
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const crops = [{ id: 'crop-g', name: 'Grapes', iconName: 'grapes', color: 'purple', supportedTasks: [], workflow: [], plots: [{ id: 'plot-a', name: 'प्लॉट १', baseline: { unit: 'Acre' } }] }] as unknown as CropProfile[];
const scope: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };

const itemOf = (answer: AgriLogResponse) => {
    const [log] = LogFactory.createFromVoiceResult(answer, scope, crops, profile, undefined, undefined, clock);
    return { log, item: productBoxesOf(log)[0].items[0] };
};
const kitOf = (log: unknown) => ({ logById: new Map([[(log as { id: string }).id, log]]), canCheck: false }) as never;
afterEach(() => { cleanup(); lng.v = 'mr'; });

describe.each([['saved', SavedProductRow], ['detail', ProductRow]] as const)('%s product row', (_n, Row) => {
    it('job_23d384ea: 0-52-34 shows "खत" and never "ओळख नाही"', () => {
        const { log, item } = itemOf(job.result as unknown as AgriLogResponse);
        render(<Row item={item} logId={log.id} kit={kitOf(log)} onOpen={() => undefined} />);
        expect(screen.getByTestId('vr-prow-type').textContent).toBe('खत');
        expect(document.body.textContent).not.toContain('ओळख नाही');
    });
    it('English: "Fertiliser", never "Not identified"', () => {
        lng.v = 'en';
        const { log, item } = itemOf(job.result as unknown as AgriLogResponse);
        render(<Row item={item} logId={log.id} kit={kitOf(log)} onOpen={() => undefined} />);
        expect(screen.getByTestId('vr-prow-type').textContent).toBe('Fertiliser');
        expect(document.body.textContent).not.toContain('Not identified');
    });
    it.each(['19-19-19', '12:61:00', '००:५२:३४'])('grade "%s" is a fertiliser', name => {
        const answer = { ...(job.result as object), inputs: [{ type: 'fertilizer', method: 'Soil', sourceText: name, productName: name, provenanceVerified: true }] } as unknown as AgriLogResponse;
        const { log, item } = itemOf(answer);
        render(<Row item={item} logId={log.id} kit={kitOf(log)} onOpen={() => undefined} />);
        expect(screen.getByTestId('vr-prow-type').textContent).toBe('खत');
    });
    it('a non-grade product with an unknown type shows NO type chip, in both languages', () => {
        const answer = { ...(job.result as object), inputs: [{ method: 'Spray', sourceText: 'झिंगाबिंगा', productName: 'झिंगाबिंगा', provenanceVerified: true }] } as unknown as AgriLogResponse;
        const { log, item } = itemOf(answer);
        render(<Row item={item} logId={log.id} kit={kitOf(log)} onOpen={() => undefined} />);
        expect(screen.queryByTestId('vr-prow-type')).toBeNull();
        expect(document.body.textContent).not.toContain('ओळख नाही');
        cleanup(); lng.v = 'en';
        render(<Row item={item} logId={log.id} kit={kitOf(log)} onOpen={() => undefined} />);
        expect(screen.queryByTestId('vr-prow-type')).toBeNull();
        expect(document.body.textContent).not.toContain('Not identified');
    });
});
