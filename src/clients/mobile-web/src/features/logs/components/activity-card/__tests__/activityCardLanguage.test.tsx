// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-27, round 3 — I13-V2-M1/M2) — the review / edit
 * form's BODY speaks his language only. The form opens for typed entries, labour entries, a parse that was not
 * auto-saved and "बदला" on the result screen; its activity card and every sheet it opens used to be English in
 * Marathi mode ("Work Done", "YOU SAID:", "Labour & Wages", "Tap to add details", "Drip/Flood/Sprinkler"…).
 *
 * Pinned here on a REAL ActivityCard with every bucket filled (not an empty ledger): a Marathi user reads no
 * English letter on the card or in any sheet — labels, sublabels, options, placeholders, tooltips — while an
 * English user keeps the English he had. Values he or the parser wrote stay as written (they are his record).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { lang } = vi.hoisted(() => ({ lang: { value: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../../../services/procurementRepository', () => ({ procurementRepository: { getExpenses: () => [] } }));

import type { ActivityExpenseEvent, CropActivityEvent, DisturbanceEvent, FarmerProfile, InputEvent, IrrigationEvent, LabourEvent, MachineryEvent, ObservationNote, PlannedTask } from '../../../../../types';
import ActivityCard from '../ActivityCard';
import IssueFormSheet from '../../IssueFormSheet';
import { activityCardStrings } from '../activityCardStrings';
import { SAFE_DEFAULTS } from '../../manual-entry/types';

afterEach(() => { cleanup(); lang.value = 'mr'; });

const LATIN = /[A-Za-z]/;
const profile = { name: 'पुर्वेश', motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;

const activity = {
    id: 'act', title: 'Crop Activity', status: 'completed', workTypes: [],
    sourceText: 'छाटणी केली', systemInterpretation: 'Pruning was done in the plot',
} as unknown as CropActivityEvent;
const labour = { id: 'lab', type: 'HIRED', maleCount: 3, femaleCount: 2, totalCost: 1500, sourceText: 'पाच मजूर आले', systemInterpretation: '5 workers hired' } as LabourEvent;
const irrigation = { id: 'irr', method: 'Drip', source: 'Well', durationHours: 2, sourceText: 'दोन तास पाणी' } as IrrigationEvent;
const machinery = { id: 'm', type: 'tractor', ownership: 'rented', hoursUsed: 1, rentalCost: 800 } as MachineryEvent;
const inputs = [{ id: 'i', method: 'Spray', carrierType: 'Blower', carrierCount: 2, reason: 'Preventive', mix: [{ id: 'x', productName: 'गंधक', unit: 'ml/L' }] }] as InputEvent[];
const expenses = [{ id: 'e', reason: 'डिझेल', totalAmount: 500, items: [], linkedActivityId: 'act' }] as unknown as ActivityExpenseEvent[];
const observations = [
    { id: 'o', noteType: 'observation', textRaw: 'वाढ चांगली' },
    { id: 'r', noteType: 'reminder', textRaw: 'उद्या पाणी' },
] as unknown as ObservationNote[];
const plannedTasks = [{ id: 't', title: 'उद्या फवारणी' }] as unknown as PlannedTask[];
const disturbance = {
    scope: 'PARTIAL', group: 'Weather', reason: 'पाऊस', blockedSegments: ['irrigation', 'labour'],
    sourceText: 'पाऊस आला', systemInterpretation: 'Rain stopped the work',
} as DisturbanceEvent;

const card = (over: Partial<React.ComponentProps<typeof ActivityCard>> = {}) => (
    <ActivityCard activity={activity} linkedData={{ labour, irrigation, machinery }} inputs={inputs} onUpdateDetails={() => undefined}
        onDeleteActivity={() => undefined} defaults={SAFE_DEFAULTS} profile={profile} expenses={expenses} observations={observations}
        plannedTasks={plannedTasks} draftDisturbance={disturbance} crops={[]} todayLogs={[]} {...over} />
);

/** Every word the farmer can read: text, placeholders, tooltips, picture names. */
const shownText = (root: ParentNode = document.body): string => [
    (root as HTMLElement).textContent ?? '',
    ...[...root.querySelectorAll('input,textarea')].map(i => (i as HTMLInputElement).placeholder),
    ...[...root.querySelectorAll('[title],[alt],[aria-label]')].flatMap(el => ['title', 'alt', 'aria-label'].map(a => el.getAttribute(a) ?? '')),
].join(' ');

const S = activityCardStrings('mr');
/** Opens a bucket's sheet by its label (the bucket comes first; the reminders list repeats its heading below). */
const open = (label: string) => fireEvent.click(screen.getAllByText(label)[0]);

describe('the activity card in Marathi — a real card, every bucket filled', () => {
    it('has no English letter anywhere on the card', () => {
        render(card());
        expect(shownText()).not.toMatch(LATIN);
    });

    it('uses the founder\'s ring words and the approved app words for the buckets, and says what it read', () => {
        render(card());
        const text = shownText();
        for (const label of ['झालेली कामे', 'मजुरी', 'खते आणि औषधे', 'पाणी / सिंचन', 'यंत्र / मशीनरी', 'इतर खर्च', 'अडथळे / अडचणी', 'आठवणीत ठेवायची कामे']) {
            expect(text).toContain(label);
        }
        expect(text).toContain('3 पुरुष + 2 महिला • ₹1500'); // labour as stated, never summed
        expect(text).toContain('2 तास ठिबक • विहीर'); // the app's own English values, in Marathi
        expect(text).toContain('ट्रॅक्टर • 1 तास');
        expect(text).toContain('₹500 · आपोआप मोजलं'); // a total the card adds up itself says so
        expect(text).toContain('तुम्ही म्हणालात:');
        expect(text).not.toContain('Pruning was done'); // the parser's English explanation is not shown to him
        expect(screen.getByText('आजचं काम')).toBeTruthy(); // the form's own "Crop Activity" default title
    });

    it('every sheet the card opens is Marathi only', () => {
        const sheets: Array<[string, (() => void) | null]> = [
            [S.work, null], [S.labour, () => { fireEvent.click(screen.getByText('उक्ते')); fireEvent.click(screen.getByText('स्वतः')); }],
            [S.irrigation, null], [S.machinery, null], [S.inputs, null], [S.expenses, null], [S.observations, null], [S.reminders, null], [S.blockers, null],
        ];
        for (const [label, more] of sheets) {
            render(card());
            open(label);
            more?.();
            expect([label, shownText()]).toEqual([label, expect.not.stringMatching(LATIN)]);
            cleanup();
        }
    });

    it('the problem sheet (opened from any detail sheet) is Marathi only, with the approved cause words', () => {
        render(<IssueFormSheet isOpen onSave={() => undefined} onClose={() => undefined} />);
        const text = shownText();
        expect(text).not.toMatch(LATIN);
        expect(text).toContain('वीज नव्हती'); // dfes.noWorkReason.electricity
        expect(text).toContain('जतन करा');
    });
});

describe('the activity card in English (an English user keeps English)', () => {
    it('shows the card\'s English exactly as it was, and the parser\'s explanation', () => {
        lang.value = 'en';
        render(card());
        const text = shownText();
        for (const label of ['Work Done', 'Labour & Wages', 'Inputs & Protection', 'Irrigation', 'Machinery', 'Expenses', 'Observations / Notes', 'Issues & Blockers', 'Reminders', 'PLANNED REMINDERS']) {
            expect(text).toContain(label);
        }
        expect(text).toContain('3M + 2F • ₹1500');
        expect(text).toContain('2h Drip • Well');
        expect(text).toContain('₹500 Total');
        expect(text).toContain('YOU SAID:');
        expect(text).toContain('Pruning was done in the plot');
        expect(screen.getByText('Crop Activity')).toBeTruthy();
        open('Labour & Wages');
        expect(shownText()).toContain('Confirm Details');
        expect(shownText()).toContain('Hours worked');
    });
});

describe('F23 (lane AI-1) — a labour count of 0 is never "0 जण" on the card', () => {
    it('shows no "0 जण" for a parser 0, and still shows a real count', () => {
        const zero = { id: 'lab0', type: 'HIRED', count: 0, sourceText: 'मजुरांनी छाटणी केली' } as LabourEvent;
        const { unmount } = render(card({ linkedData: { labour: zero, irrigation, machinery } }));
        expect(shownText()).not.toMatch(/(^|[^0-9०-९])[0०]\s*जण/);
        unmount();

        const four = { id: 'lab4', type: 'HIRED', count: 4, sourceText: 'चार मजूर' } as LabourEvent;
        render(card({ linkedData: { labour: four, irrigation, machinery } }));
        expect(shownText()).toContain(S.workers(4));
    });
});
