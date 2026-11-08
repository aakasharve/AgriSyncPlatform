// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 2; founder D-24c, D-26, D-29, D-30, TAP-1, CTX-1, R15) - the plan
 * form, over the real task commands and a fake-indexeddb phone database: the mic is the first control; the parse's first planned item
 * fills the work and the "when"; with none his words fill the box; "कुठे" is `CropSelector` (no other picker imported); the button
 * waits for काम + कुठे + कधी + कोणाला; "फक्त आठवण" makes it "आठवण ठेवा"; the crew fields appear only for a मुकादम; a seat without
 * AssignWork cannot pick another person; what is queued is exactly the form's words (a headcount stays a number, nothing else).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { PlanForm, type PlanFormProps } from '../components/PlanForm';
import type { PlanSpeechResult } from '../data/planVoice';

vi.mock('../components/PlanMic', () => ({
    PlanMic: ({ onAudio }: { onAudio: (a: { blob: Blob; base64: string; mimeType: string }) => void }) => (
        <button type="button" data-testid="plan-mic" onClick={() => onAudio({ blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm' })}>mic</button>
    ),
}));

const FARM = '55555555-5555-4555-8555-555555555551';
const ME = '22222222-2222-4222-8222-222222222222';
const SHANKAR = '11111111-1111-4111-8111-111111111112';
const RAJU = '11111111-1111-4111-8111-111111111111';
const TODAY = new Date(2026, 10, 8);

// The wire takes real ids for plots (the zod twin of the payload says so).
const PLOT = { cane: ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442'], grape: ['44444444-4444-4444-8444-444444444443'] };
const crop = (id: keyof typeof PLOT, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: PLOT[id][i], name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', ['ऊस 1', 'ऊस 2']), crop('grape', 'द्राक्ष', 'Grape', ['सोनाका'])];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;
const ASSIGNEES: PlannedWorkAssigneeDto[] = [
    { userId: SHANKAR, displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] },
    { userId: RAJU, displayName: 'राजू', role: 'Worker', plotScope: 'AllPlots', plotIds: [] },
];

const setup = (over: Partial<PlanFormProps> = {}) => {
    const onSaved = vi.fn();
    const utils = render(
        <PlanForm farmId={FARM} userId={ME} language="mr" crops={CROPS} farmerProfile={PROFILE} mayAssign assignees={ASSIGNEES} today={TODAY}
            onSaved={onSaved} {...over} />,
    );
    return { onSaved, ...utils };
};

const chooseWork = (text = 'युरिया टाकणे') => fireEvent.change(screen.getByTestId('plan-work-input'), { target: { value: text } });
const choosePlot = (cropId: keyof typeof PLOT, plotNo: number) => {
    if (!screen.queryByTestId('flow-step-plot')) fireEvent.click(screen.getByTestId(`flow-crop-${cropId}`));
    // a crop with ONE plot has it chosen as the crop is (the selector's own rule: `toggleCrop`)
    if (PLOT[cropId].length > 1) fireEvent.click(screen.getByTestId(`flow-plot-${PLOT[cropId][plotNo - 1]}`));
};
const queue = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.PlannedworkCreate);

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(cleanup);

describe('the mic and the type box (TAP-1)', () => {
    it('the mic is the first control of the form, and the type box is always there', () => {
        setup();
        const form = screen.getByTestId('plan-form');
        const first = form.querySelector('button, input, textarea, select, a[href]');
        expect(first).toBe(screen.getByTestId('plan-mic'));
        expect(screen.getByTestId('plan-work-input')).toBeInTheDocument();
        expect(screen.getByText('बोलता येत नसेल तर इथे लिहा')).toBeInTheDocument();
    });

    it('the first planned item fills the work and the "when" cue; his words are shown', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: 'उद्या ऊस S1 ला युरिया टाकायचा', title: 'युरिया टाकणे', dueHint: 'उद्या' } }));
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('युरिया टाकणे'));
        expect(screen.getByTestId('plan-when-tomorrow')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('plan-heard')).toHaveTextContent('उद्या ऊस S1 ला युरिया टाकायचा');
        // the speech picked no place: the form still asks "कुठे"
        expect(screen.getByTestId('plan-submit')).toBeDisabled();
        expect(screen.getByTestId('flow-step-crop')).toBeInTheDocument();
    });

    it('a spoken "8 दिवसांनी" lights that chip; a far day lights "तारीख निवडा" with the day in the box', async () => {
        const understand = vi.fn()
            .mockResolvedValueOnce({ ok: true, speech: { transcript: 't', title: 'फवारणी', dueHint: '8 दिवसांनी' } })
            .mockResolvedValueOnce({ ok: true, speech: { transcript: 't', title: 'फवारणी', dueHint: '3 दिवसांनी' } });
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('plan-when-in8')).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('plan-when-date')).toHaveAttribute('aria-pressed', 'true'));
        expect((screen.getByTestId('plan-date-input') as HTMLInputElement).value).toBe('2026-11-11');
    });

    it('no planned item: his own words fill the box, and no "when" is guessed', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: 'ऊसाला पाणी द्यायचं आहे', title: 'ऊसाला पाणी द्यायचं आहे', dueHint: null } }));
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('ऊसाला पाणी द्यायचं आहे'));
        for (const id of ['today', 'tomorrow', 'in8', 'date', 'week', 'month', 'anytime']) {
            expect(screen.getByTestId(`plan-when-${id}`)).toHaveAttribute('aria-pressed', 'false');
        }
    });

    it('when the parse cannot run, the form says so, the type box stays open, and nothing is queued as voice', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: false, reason: 'offline' }));
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('plan-voice-offline')).toHaveTextContent('नेट नाही, म्हणून बोललेलं समजून घेता आलं नाही. खाली लिहा.'));
        chooseWork('फवारणी');
        expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('फवारणी');
        expect(await getDatabase().mutationQueue.count()).toBe(0);
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
    });

    it('a failed understanding says so too', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: false, reason: 'failed' }));
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('plan-voice-failed')).toBeInTheDocument());
        expect(screen.getByTestId('plan-work-input')).toBeEnabled();
    });
});

describe('"कुठे" is the one crop -> plot selector (CTX-1)', () => {
    it('draws CropSelector\'s stepper, and the form imports no other picker', () => {
        setup();
        expect(screen.getByTestId('flow-step-crop')).toBeInTheDocument();
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeInTheDocument();
        const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'PlanForm.tsx'), 'utf8');
        const imports = source.split('\n').filter(l => /^import /.test(l)).join('\n');
        expect(imports).toMatch(/context\/components\/CropSelector'/);
        expect(imports).not.toMatch(/PlacePickerSheet|CropPlotStepper'|PlotPicker|PlotSelector|CropCarousel/);
    });
});

describe('the button waits for काम + कुठे + कधी + कोणाला', () => {
    it('each missing answer keeps it disabled; all four enable it', () => {
        setup();
        const button = screen.getByTestId('plan-submit');
        expect(button).toBeDisabled();
        chooseWork();
        expect(button).toBeDisabled();
        choosePlot('cane', 1);
        expect(button).toBeDisabled();
        fireEvent.click(screen.getByTestId('plan-when-today'));
        expect(button).toBeDisabled();
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        expect(button).toBeEnabled();
    });

    it('a one-letter work, or a date left blank, is not enough', () => {
        setup();
        chooseWork('क');
        choosePlot('cane', 1);
        fireEvent.click(screen.getByTestId('plan-assign-none'));
        fireEvent.click(screen.getByTestId('plan-when-date'));
        expect(screen.getByTestId('plan-submit')).toBeDisabled();
        chooseWork('खत');
        expect(screen.getByTestId('plan-submit')).toBeDisabled();
        fireEvent.change(screen.getByTestId('plan-date-input'), { target: { value: '2026-11-20' } });
        expect(screen.getByTestId('plan-submit')).toBeEnabled();
    });

    it('"फक्त आठवण" switches the button to "आठवण ठेवा"; a person switches it back to "काम सोपवा"', () => {
        setup();
        expect(screen.getByTestId('plan-submit')).toHaveTextContent('काम सोपवा');
        fireEvent.click(screen.getByTestId('plan-assign-none'));
        expect(screen.getByTestId('plan-submit')).toHaveTextContent('आठवण ठेवा');
        fireEvent.click(screen.getByTestId(`plan-assign-${RAJU}`));
        expect(screen.getByTestId('plan-submit')).toHaveTextContent('काम सोपवा');
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        expect(screen.getByTestId('plan-submit')).toHaveTextContent('आठवण ठेवा');
    });
});

describe('who can be chosen (D-24c, D-26, P5)', () => {
    it('a seat with AssignWork is offered "स्वतः", the listed people, and "फक्त आठवण"', () => {
        setup();
        expect(screen.getByTestId('plan-assign-self')).toBeInTheDocument();
        expect(screen.getByTestId(`plan-assign-${SHANKAR}`)).toHaveTextContent('शंकर · मुकादम');
        expect(screen.getByTestId(`plan-assign-${RAJU}`)).toHaveTextContent('राजू · कामगार');
        expect(screen.getByTestId('plan-assign-none')).toBeInTheDocument();
    });

    it('a seat without AssignWork can pick another person? No: only "स्वतः" and "फक्त आठवण", even if a list is in hand', () => {
        setup({ mayAssign: false });
        const chips = screen.getByTestId('plan-assignees');
        expect(Array.from(chips.querySelectorAll('button')).map(b => b.textContent)).toEqual(['स्वतः', 'फक्त आठवण (कोणालाही नाही)']);
        expect(screen.queryByTestId(`plan-assign-${SHANKAR}`)).toBeNull();
        expect(screen.queryByTestId(`plan-assign-${RAJU}`)).toBeNull();
    });

    it('the list kept on the phone is said so', () => {
        setup({ assigneesFromCache: true });
        expect(screen.getByTestId('plan-assignees-cached')).toHaveTextContent('ही यादी नेट असताना घेतली होती.');
    });
});

describe('the crew fields (D-24c, D-24a): words only, and only for a मुकादम', () => {
    it('appear for a chosen मुकादम; not for a worker, himself, or nobody', () => {
        setup();
        expect(screen.queryByTestId('plan-crew-fields')).toBeNull();
        fireEvent.click(screen.getByTestId(`plan-assign-${RAJU}`));
        expect(screen.queryByTestId('plan-crew-fields')).toBeNull();
        fireEvent.click(screen.getByTestId(`plan-assign-${SHANKAR}`));
        expect(screen.getByTestId('plan-crew-fields')).toBeInTheDocument();
        expect(screen.getByLabelText('टीम')).toBeInTheDocument();
        expect(screen.getByLabelText('किती जण')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        expect(screen.queryByTestId('plan-crew-fields')).toBeNull();
        fireEvent.click(screen.getByTestId('plan-assign-none'));
        expect(screen.queryByTestId('plan-crew-fields')).toBeNull();
    });

    it('the pay choice is said to be words only', () => {
        setup();
        fireEvent.click(screen.getByTestId('plan-pay-contract'));
        expect(screen.getByTestId('plan-pay-words-only')).toHaveTextContent('हे फक्त शब्द आहेत; यातून हजेरी, मजुरी किंवा खर्च आपोआप होत नाही.');
    });
});

describe('what is queued', () => {
    it('a crew task for a मुकादम: PlanForm, the plots, the crew words and the headcount as a number, no voice reference, no money', async () => {
        const { onSaved } = setup();
        chooseWork('खत टाकणे');
        choosePlot('cane', 1);
        choosePlot('cane', 2);
        fireEvent.click(screen.getByTestId('plan-when-tomorrow'));
        fireEvent.click(screen.getByTestId(`plan-assign-${SHANKAR}`));
        fireEvent.change(screen.getByTestId('plan-crew'), { target: { value: 'रोकडेची टीम' } });
        fireEvent.change(screen.getByTestId('plan-headcount'), { target: { value: '10' } });
        fireEvent.change(screen.getByTestId('plan-qty'), { target: { value: 'प्रत्येक ओळीला ३ पोती' } });
        fireEvent.click(screen.getByTestId('plan-pay-contract'));
        await act(async () => { fireEvent.click(screen.getByTestId('plan-submit')); });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ reminder: false, assignedTo: 'शंकर' }));

        const rows = await queue();
        expect(rows).toHaveLength(1);
        const p = rows[0].payload as Record<string, unknown>;
        expect(p).toMatchObject({
            farmId: FARM, title: 'खत टाकणे', scope: 'MultiPlot', plotIds: PLOT.cane, plannedDate: '2026-11-09',
            assigneeUserId: SHANKAR, crewText: 'रोकडेची टीम', expectedHeadcount: 10, quantityText: 'प्रत्येक ओळीला ३ पोती', payMode: 'Contract',
            sourceKind: 'PlanForm', recordedOn: '2026-11-08',
        });
        expect(p.looseWhen).toBeUndefined();
        expect(Object.keys(p).filter(k => /voice|audio|clip|attendance|wage|cost|amount/i.test(k))).toEqual([]);
        expect(rows[0].clientRequestId).toBe(`${SyncMutationName.PlannedworkCreate}:${p.plannedWorkId as string}`);
        // the form is empty again
        expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('');
    });

    it('the whole farm is alone (no plots), a loose "when" has no date, "स्वतः" is his own id, a spoken task is still PlanForm', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: 'सगळ्या शेताला पाणी', title: 'पाणी सोडणे', dueHint: null } }));
        const { onSaved } = setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('पाणी सोडणे'));
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        fireEvent.click(screen.getByTestId('plan-when-anytime'));
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        await act(async () => { fireEvent.click(screen.getByTestId('plan-submit')); });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ reminder: true, assignedTo: null }));
        const p = (await queue())[0].payload as Record<string, unknown>;
        expect(p).toMatchObject({ title: 'पाणी सोडणे', scope: 'Farm', looseWhen: 'Anytime', assigneeUserId: ME, sourceKind: 'PlanForm' });
        expect(p.plotIds).toBeUndefined();
        expect(p.plannedDate).toBeUndefined();
        expect(p.crewText).toBeUndefined();
    });

    it('"फक्त आठवण" sends no assignee; one plot is `Plot`', async () => {
        const { onSaved } = setup();
        chooseWork('छाटणी');
        choosePlot('grape', 1);
        fireEvent.click(screen.getByTestId('plan-when-week'));
        fireEvent.click(screen.getByTestId('plan-assign-none'));
        await act(async () => { fireEvent.click(screen.getByTestId('plan-submit')); });
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        const p = (await queue())[0].payload as Record<string, unknown>;
        expect(p).toMatchObject({ scope: 'Plot', plotIds: PLOT.grape, looseWhen: 'Week' });
        expect(p.assigneeUserId).toBeUndefined();
    });
});

describe('length caps: nothing is cut silently (P004, P005)', () => {
    const fillAll = () => {
        choosePlot('cane', 1);
        fireEvent.click(screen.getByTestId('plan-when-today'));
        fireEvent.click(screen.getByTestId('plan-assign-none'));
    };

    it('a long transcript in the work box is kept whole, the button stays off, and the form says which box is too long', async () => {
        const long = 'ऊसाला पाणी '.repeat(30); // 330 letters, over the 200 the server takes
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: long, title: long, dueHint: null } }));
        setup({ understand });
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe(long));
        fillAll();
        expect(screen.getByTestId('plan-submit')).toBeDisabled();
        expect(screen.getByTestId('plan-too-long')).toHaveTextContent('काम काय');
        expect(screen.getByTestId('plan-too-long')).toHaveTextContent('200');
        // he shortens it: the box and the button come back; nothing was cut for him
        chooseWork('ऊसाला पाणी');
        expect(screen.queryByTestId('plan-too-long')).toBeNull();
        expect(screen.getByTestId('plan-submit')).toBeEnabled();
    });

    it('exactly at the limit is fine; one over is not (work 200, team 100, quantity 200, instructions 1000)', () => {
        setup({ assignees: [{ userId: SHANKAR, displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] }] });
        choosePlot('cane', 1);
        fireEvent.click(screen.getByTestId('plan-when-today'));
        fireEvent.click(screen.getByTestId(`plan-assign-${SHANKAR}`));
        chooseWork('क'.repeat(200));
        expect(screen.getByTestId('plan-submit')).toBeEnabled();
        chooseWork('क'.repeat(201));
        expect(screen.getByTestId('plan-submit')).toBeDisabled();
        chooseWork('खत');
        const cases: Array<[string, number, string]> = [['plan-crew', 100, 'टीम'], ['plan-qty', 200, 'प्रमाण'], ['plan-note', 1000, 'सूचना']];
        for (const [testId, max, label] of cases) {
            fireEvent.change(screen.getByTestId(testId), { target: { value: 'क'.repeat(max) } });
            expect(screen.getByTestId('plan-submit')).toBeEnabled();
            fireEvent.change(screen.getByTestId(testId), { target: { value: 'क'.repeat(max + 1) } });
            expect(screen.getByTestId('plan-submit')).toBeDisabled();
            expect(screen.getByTestId('plan-too-long')).toHaveTextContent(label);
            expect((screen.getByTestId(testId) as HTMLInputElement).value).toHaveLength(max + 1);
            fireEvent.change(screen.getByTestId(testId), { target: { value: '' } });
            expect(screen.getByTestId('plan-submit')).toBeEnabled();
        }
    });

    it('the headcount takes at most three digits (999 at most)', () => {
        setup({ assignees: [{ userId: SHANKAR, displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] }] });
        fireEvent.click(screen.getByTestId(`plan-assign-${SHANKAR}`));
        fireEvent.change(screen.getByTestId('plan-headcount'), { target: { value: '12345' } });
        expect((screen.getByTestId('plan-headcount') as HTMLInputElement).value).toBe('123');
    });

    it('English mode says it in English', async () => {
        setup({ language: 'en' });
        chooseWork('k'.repeat(201));
        expect(screen.getByTestId('plan-too-long')).toHaveTextContent(/too long/i);
        expect(screen.getByTestId('plan-too-long').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('English mode: English only', () => {
    it('no Devanagari letter is drawn by the form itself (the recorder and the selector are the log\'s own)', () => {
        setup({ language: 'en', assignees: [{ userId: SHANKAR, displayName: 'Shankar', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] }] });
        const own = ['plan-work-input', 'plan-assignees', 'plan-submit'].map(id => screen.getByTestId(id).textContent ?? '').join(' ');
        expect(own).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByText('If you cannot speak, write here')).toBeInTheDocument();
        expect(screen.getByText('4. Who is it for?')).toBeInTheDocument();
        expect(screen.getByTestId('plan-assign-self')).toHaveTextContent('Myself');
    });
});
