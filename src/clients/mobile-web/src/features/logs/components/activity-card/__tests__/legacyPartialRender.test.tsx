// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1, review S7) — a LEGACY-PARTIAL log on screen.
 *
 * Since lane F1 a log the server holds only as task lines is rebuilt with nothing made up: no method, source, unit,
 * reason, type, severity, status or totals it did not state. Every screen that used to read those fields as if they
 * were always there must now show such a log without "undefined", without "NaN", and without "₹0" standing for an
 * amount nobody said. Pinned on the REAL rebuild (`detailsFromTasks`, the reconciler's source 3) feeding the REAL
 * activity card in both languages, the work-done list, and the compare screen's executed water row.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const { lang } = vi.hoisted(() => ({ lang: { value: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../../../services/procurementRepository', () => ({ procurementRepository: { getExpenses: () => [] } }));

import type { CropProfile, DailyLog, FarmerProfile, Plot } from '../../../../../types';
import type { DailyLogDto } from '../../../../../infrastructure/api/AgriSyncClient';
import { detailsFromTasks } from '../../../../sync/pull/helpers/rebuildLogDetails';
import { buildWorkDoneProjection } from '../../../services/workDoneProjection';
import { generatePlotComparison } from '../../../../compare/plotComparisonService';
import ActivityCard from '../ActivityCard';
import { activityCardStrings } from '../activityCardStrings';
import { SAFE_DEFAULTS } from '../../manual-entry/types';

afterEach(() => { cleanup(); lang.value = 'mr'; });

const PLOT = 'plot-legacy';
const AT = '2026-10-20T05:00:00.000Z';

/** An older phone's record, as the server holds it: task lines only, some with no note at all. */
const serverRecord = {
    id: 'legacy-1', logDate: '2026-10-20',
    tasks: [
        { id: 't-water', activityType: 'Irrigation', occurredAtUtc: AT },
        { id: 't-spray', activityType: 'Spray Input', occurredAtUtc: AT },
        { id: 't-mach', activityType: 'Machinery tractor', occurredAtUtc: AT },
        { id: 't-obs', activityType: 'Observation', occurredAtUtc: AT },
        { id: 't-work', activityType: 'Pruning', occurredAtUtc: AT },
    ],
} as unknown as DailyLogDto;

const details = detailsFromTasks(serverRecord, PLOT, 'crop-1');
const legacyLog = {
    id: 'legacy-1', date: '2026-10-20', dayOutcome: null, labour: [], legacyPartial: true,
    context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: [PLOT], selectedPlotNames: ['P'] }] },
    ...details,
} as unknown as DailyLog;

const profile = { name: 'पुर्वेश', motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;

/** Every word the farmer can read: text, placeholders, tooltips. */
const shownText = (): string => [
    document.body.textContent ?? '',
    ...[...document.querySelectorAll('input,textarea')].map(i => (i as HTMLInputElement).placeholder),
    ...[...document.querySelectorAll('[title],[alt],[aria-label]')].flatMap(el => ['title', 'alt', 'aria-label'].map(a => el.getAttribute(a) ?? '')),
].join(' ');

/** "undefined", "NaN", or a ₹0 standing for an amount nobody said. */
const INVENTED = /undefined|NaN|₹\s*0(?![\d.,])/;

describe('a legacy-partial log on screen — nothing invented, nothing broken (review S7)', () => {
    it('the rebuild itself states no method, source, product or totals', () => {
        expect(legacyLog.irrigation[0]).toEqual({ id: 't-water' });
        expect(legacyLog.inputs[0]).toEqual({ id: 't-spray', mix: [] });
        expect(legacyLog.financialSummary).toBeUndefined();
    });

    it.each(['mr', 'en'] as const)('the activity card (%s) shows no "undefined", "NaN" or "₹0"', language => {
        lang.value = language;
        render(
            <ActivityCard activity={legacyLog.cropActivities[0]}
                linkedData={{ irrigation: legacyLog.irrigation[0], machinery: legacyLog.machinery[0] }}
                inputs={legacyLog.inputs} observations={legacyLog.observations ?? []}
                onUpdateDetails={() => undefined} onDeleteActivity={() => undefined} defaults={SAFE_DEFAULTS}
                profile={profile} expenses={[]} plannedTasks={[]} crops={[]} todayLogs={[]} />,
        );
        const text = shownText();
        expect(text).not.toMatch(INVENTED);
    });

    it('the card\'s own lines, in both languages, say "—" for what was not stated', () => {
        for (const language of ['mr', 'en'] as const) {
            const s = activityCardStrings(language);
            const lines = [s.irrigationLine(undefined, undefined, undefined), s.machineLine(undefined, undefined), s.items(undefined)];
            expect(lines.join(' | ')).not.toMatch(INVENTED);
        }
        expect(activityCardStrings('en').irrigationLine(undefined, undefined, undefined)).toBe('—');
        expect(activityCardStrings('en').irrigationLine(2, 'Drip', 'Well')).toBe('2h Drip • Well'); // a stated one is unchanged
    });

    it('the work-done list shows no "undefined", "NaN" or "₹0"', () => {
        const items = buildWorkDoneProjection(legacyLog);
        expect(JSON.stringify(items)).not.toMatch(INVENTED);
    });

    it('the compare screen names the water it ran as "—", never "undefined - 0hrs"', () => {
        const plot = { id: PLOT, name: 'P', startDate: '2026-10-01' } as unknown as Plot;
        const crop = { id: 'crop-1', name: 'Grapes', activeScheduleId: null, plots: [plot] } as unknown as CropProfile;
        const summary = generatePlotComparison(plot, crop, [legacyLog]);
        const names = JSON.stringify(summary);
        expect(names).not.toMatch(/undefined - |0hrs/);
        expect(names).toContain('"name":"—"');
    });
});
