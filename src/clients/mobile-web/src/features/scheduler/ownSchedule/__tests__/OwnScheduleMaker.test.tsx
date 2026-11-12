// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 2; founder D-132 Q2 = 1 "both start buttons", Q3 = 1 "three things: काम, कधी,
 * किती वेळा", D-136/D-137 made-for block; TAP-1 voice first never voice only; P4, P5, P9, P10) - the maker, as the founder ticked it on the v3 page:
 *   screen 3 the two start buttons, screen 4 "यासाठी बनवलं", screen 5 the stage list + change list + save, screen 6 adding one work (mic first, then the
 *   type box, the three boxes always there). NOTHING is saved until he taps जतन करा; then the existing outbox gets the contract's mutations.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../../../plannedWork/components/PlanMic', () => ({
    PlanMic: ({ onAudio }: { onAudio: (a: { blob: Blob; base64: string; mimeType: string }) => void }) => (
        <button type="button" data-testid="plan-mic" onClick={() => onAudio({ blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm' })}>mic</button>
    ),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => ({ userId: '0a0a0a0a-0000-4000-8000-00000000000a' }),
}));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { CropProfile, FarmerProfile } from '../../../../types';
import type { PlanSpeechResult } from '../../../plannedWork/data/planVoice';
import { OwnScheduleFlow, type OwnFlow } from '../OwnScheduleFlow';
import { FARM, OWNER, STAGES_A, TYPIST, WORKS_A, id, ownRow } from './ownFixtures';

const PLOT_G1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLOT_G2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const PLOT_T1 = 'aaaaaaaa-0000-4000-8000-000000000003';
const T_UNI = '10000000-0000-4000-8000-000000000002';

const CROPS = [
    { id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT_G1, name: 'G1' }, { id: PLOT_G2, name: 'G2' }] },
    { id: 'tomato', name: 'Tomato', iconName: 'Tomato', color: 'red', plots: [{ id: PLOT_T1, name: 'T1' }] },
] as unknown as CropProfile[];
const PROFILE = { operators: [{ id: OWNER, name: 'संजय' }, { id: TYPIST, name: 'सुनील' }], activeOperatorId: '' } as unknown as FarmerProfile;

const CHECKED = {
    id: T_UNI, name: 'द्राक्ष — कृषी विद्यापीठ शेड्यूल', cropType: 'Grapes', totalDays: 40, versionHash: 'h', ownerType: 'INSTITUTION', sourceLabel: 'कृषी विद्यापीठ', scope: 'Public',
    check: { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null }, hasStoredDays: true,
    stages: [{ name: 'छाटणीनंतर', startDay: 0, endDay: 15 }, { name: 'फुलोरा', startDay: 16, endDay: 39 }],
    activities: [
        { name: 'ठिबक सिंचन', category: 'Irrigation', stageName: 'छाटणीनंतर', startDay: 0, endDay: 15, frequencyMode: 'every_n_days', intervalDays: 3, part: 'Irrigation', operationKey: 'op_irrigation' },
        { name: 'बुरशीनाशक फवारणी', category: 'Spraying', stageName: 'फुलोरा', startDay: 20, endDay: 20, frequencyMode: 'one_time', intervalDays: null, part: 'Spray' },
    ],
};

async function seedRows(rows: unknown[]) {
    await getDatabase().referenceData.put({ key: 'scheduleTemplates', data: rows, versionHash: 'h', updatedAt: '2026-11-12T00:00:00Z' } as never);
}
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

interface HostProps { initial: OwnFlow; understand?: (a: unknown) => Promise<PlanSpeechResult>; onLeave?: () => void; extraCrop?: boolean }
const MYSTERY = { id: 'mystery', name: 'Zzyzx unknown crop', iconName: 'Leaf', color: 'green', plots: [] } as unknown as CropProfile;
const Host: React.FC<HostProps> = ({ initial, understand, onLeave, extraCrop }) => {
    const [flow, setFlow] = useState<OwnFlow | null>(initial);
    if (!flow) return <p data-testid="flow-closed">closed</p>;
    return (
        <OwnScheduleFlow flow={flow} setFlow={setFlow} farmId={FARM} userId={OWNER} language={language.current} crops={extraCrop ? [...CROPS, MYSTERY] : CROPS} farmerProfile={PROFILE}
            understand={understand as never} onLeave={onLeave ?? (() => undefined)} />
    );
};
const open = (props: Partial<HostProps> = {}) => render(<Host initial={{ page: 'start', cropId: 'grape' }} {...props} />);

beforeEach(async () => {
    language.current = 'mr';
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.referenceData.clear(), db.scheduleSubscriptions.clear(), db.appMeta.clear()]);
    await seedRows([CHECKED]);
});
afterEach(cleanup);

const toStages = async () => {
    fireEvent.click(await screen.findByTestId('own-start-blank'));
    fireEvent.click(await screen.findByTestId('own-mf-next'));
    await screen.findByTestId('own-stages');
};
const addStage = (name = 'फुलोरा ते फळधारणा', from = 31, to = 60) => {
    fireEvent.click(screen.getByTestId('own-add-stage'));
    fireEvent.change(screen.getByTestId('own-stage-name'), { target: { value: name } });
    fireEvent.change(screen.getByTestId('own-stage-from'), { target: { value: String(from) } });
    fireEvent.change(screen.getByTestId('own-stage-to'), { target: { value: String(to) } });
    fireEvent.click(screen.getByTestId('own-stage-ok'));
};
const addWork = (name = 'ठिबक सिंचन', from = 31, to = 60, every = 5) => {
    fireEvent.click(screen.getByTestId('own-add-work-0'));
    fireEvent.change(screen.getByTestId('own-work-name'), { target: { value: name } });
    fireEvent.click(screen.getByTestId('own-part-irrigation'));
    fireEvent.change(screen.getByTestId('own-from'), { target: { value: String(from) } });
    fireEvent.change(screen.getByTestId('own-to'), { target: { value: String(to) } });
    fireEvent.click(screen.getByTestId('own-mode-every_n_days'));
    fireEvent.change(screen.getByTestId('own-interval'), { target: { value: String(every) } });
    fireEvent.click(screen.getByTestId('own-work-ok'));
};

describe('screen 3: the two ways to start', () => {
    it('Crops_of_the_farm_the_name_and_both_start_buttons_with_their_words', async () => {
        open();
        const start = await screen.findByTestId('own-start');
        expect(start).toHaveTextContent('तुमचं स्वतःचं शेड्यूल');
        expect(screen.getByTestId('own-crop-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('own-crop-tomato')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-name')).toHaveValue('माझं द्राक्ष शेड्यूल');
        expect(screen.getByTestId('own-start-blank')).toHaveTextContent('रिकाम्यापासून सुरू करा');
        expect(screen.getByTestId('own-start-blank')).toHaveTextContent('कामं तुम्ही एक एक करून जोडता.');
        expect(screen.getByTestId('own-start-checked')).toHaveTextContent('तपासलेल्या शेड्यूलवरून सुरू करा');
        await waitFor(() => expect(screen.getByTestId('own-start-checked')).toBeEnabled()); // the pulled rows arrive from the phone's database
        expect(start).toHaveTextContent('स्वतःच्या शेड्यूलला तपासणी लागत नाही');
    });

    it('A_crop_with_no_checked_schedule_disables_that_button_with_its_honest_line (blank still works)', async () => {
        open();
        fireEvent.click(await screen.findByTestId('own-crop-tomato'));
        expect(screen.getByTestId('own-start-checked')).toBeDisabled();
        expect(screen.getByTestId('own-no-checked')).toHaveTextContent('या पिकासाठी अजून तपासलेलं शेड्यूल नाही');
        expect(screen.getByTestId('own-start-blank')).toBeEnabled();
        expect((screen.getByTestId('own-name') as HTMLInputElement).value).toMatch(/^माझं .+ शेड्यूल$/);
    });

    it('A_crop_the_phone_cannot_name_to_the_server_cannot_start_a_schedule: both buttons off with an honest line, never "the farm has no such crop" (P007)', async () => {
        open({ extraCrop: true });
        fireEvent.click(await screen.findByTestId('own-crop-mystery'));
        expect(screen.getByTestId('own-start-blank')).toBeDisabled();
        expect(screen.getByTestId('own-start-checked')).toBeDisabled();
        expect(screen.getByTestId('own-crop-unknown')).toHaveTextContent('श्रमसफलला ओळखता आलं नाही');
        expect(screen.getByTestId('own-crop-unknown').textContent).not.toContain('या शेतात हे पीक नाही');
        expect(screen.queryByTestId('own-no-checked')).toBeNull();
        fireEvent.click(screen.getByTestId('own-crop-grape'));
        expect(screen.queryByTestId('own-crop-unknown')).toBeNull();
        expect(screen.getByTestId('own-start-blank')).toBeEnabled();
    });

    it('The_back_of_the_first_screen_leaves_(to_the_page_he_came_from)', async () => {
        const onLeave = vi.fn();
        open({ onLeave });
        fireEvent.click(await screen.findByTestId('own-back'));
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('Tap_targets_are_at_least_44px', async () => {
        open();
        await screen.findByTestId('own-start');
        for (const t of ['own-start-blank', 'own-start-checked', 'own-crop-grape', 'own-back']) {
            expect(screen.getByTestId(t).className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        }
    });
});

describe('screen 4: "यासाठी बनवलं"', () => {
    const toMadeFor = async () => { fireEvent.click(await screen.findByTestId('own-start-blank')); await screen.findByTestId('own-madefor'); };

    it('Crop_shown_days_derived_never_a_box_and_the_honest_voice_note', async () => {
        open();
        await toMadeFor();
        const page = screen.getByTestId('own-madefor');
        expect(page).toHaveTextContent('यासाठी बनवलं');
        expect(screen.getByTestId('own-mf-crop')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('own-mf-days')).toHaveTextContent('स्टेज जोडल्यावर दिवस इथे दिसतील'); // before any stage exists
        expect(page.querySelectorAll('input[type="number"]')).toHaveLength(0); // never a number box for the days
        expect(screen.getByTestId('own-mf-voice-note')).toHaveTextContent('बोलण्यातून हे अजून भरत नाही. खाली निवडा.');
        expect(page).toHaveTextContent('जतन करा दाबेपर्यंत काहीही जतन होत नाही.');
        expect(await queue()).toEqual([]); // nothing saved
    });

    it('The_mic_comes_first_then_the_four_optional_picks', async () => {
        open();
        await toMadeFor();
        const mic = screen.getByTestId('plan-mic');
        const firstPick = screen.getByTestId('own-mf-variety-Thompson Seedless');
        expect(mic.compareDocumentPosition(firstPick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const page = screen.getByTestId('own-madefor');
        expect(page.textContent).toContain('ऐच्छिक');
    });

    it('Variety_is_the_apps_own_list_without_Other: six grapes (and the fallback for a crop the catalog does not list)', async () => {
        open();
        await toMadeFor();
        const varieties = [...screen.getByTestId('own-mf-variety').querySelectorAll('button')].map(b => b.textContent);
        expect(varieties).toEqual(['Super Sonaka', 'Sharad Seedless', 'Thompson Seedless', 'Crimson Seedless', 'Flame Seedless', 'Manik Chaman']);
    });

    it('Soil_region_climate_are_short_lists_with_Marathi_labels_and_the_files_codes', async () => {
        open();
        await toMadeFor();
        expect([...screen.getByTestId('own-mf-soilType').querySelectorAll('button')].map(b => b.textContent)).toEqual(['काळी', 'तांबडी', 'मध्यम', 'मुरमाड', 'रेताड']);
        expect([...screen.getByTestId('own-mf-region').querySelectorAll('button')].map(b => b.textContent)).toEqual(['महाराष्ट्र', 'नाशिक', 'सोलापूर', 'पुणे', 'सांगली', 'सातारा']);
        expect([...screen.getByTestId('own-mf-climate').querySelectorAll('button')].map(b => b.textContent)).toEqual(['कोरडं', 'दमट', 'थंड', 'उष्ण', 'जास्त पावसाचं']);
        expect(screen.getByTestId('own-mf-climate-heavy_rain')).toHaveTextContent('जास्त पावसाचं');
    });

    it('A_pick_is_marked_and_a_second_tap_clears_it', async () => {
        open();
        await toMadeFor();
        const soil = screen.getByTestId('own-mf-soilType-black');
        fireEvent.click(soil);
        expect(soil).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('own-mf-summary')).toHaveTextContent('माती: काळी');
        fireEvent.click(soil);
        expect(soil).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-mf-summary')).not.toHaveTextContent('माती');
    });

    it('The_mic_shows_what_he_said_and_picks_nothing', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: 'थॉम्पसन सीडलेस, काळी माती, नाशिक, कोरडं हवामान', title: 'थॉम्पसन सीडलेस', dueHint: null } }));
        open({ understand: understand as never });
        await toMadeFor();
        await act(async () => { fireEvent.click(screen.getByTestId('plan-mic')); });
        await waitFor(() => expect(screen.getByTestId('own-heard')).toHaveTextContent('थॉम्पसन सीडलेस, काळी माती, नाशिक, कोरडं हवामान'));
        expect(screen.getByTestId('own-madefor').querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    });

    it('The_voice_lines_for_no_net_and_a_failed_hearing_are_the_plan_forms_own_words', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: false, reason: 'offline' }));
        open({ understand: understand as never });
        await toMadeFor();
        await act(async () => { fireEvent.click(screen.getByTestId('plan-mic')); });
        expect(await screen.findByTestId('own-voice-offline')).toHaveTextContent('नेट नाही, म्हणून बोललेलं समजून घेता आलं नाही. खाली लिहा.');
    });
});

describe('screens 5 and 6: stages, and adding one work', () => {
    it('Empty_stage_list_says_so_and_a_stage_with_its_last_day_before_its_first_is_refused_in_words', async () => {
        open();
        await toStages();
        expect(screen.getByTestId('own-stages')).toHaveTextContent('अजून स्टेज नाही');
        expect(screen.getByTestId('own-save')).toBeEnabled(); // a blank schedule may be saved with no stage yet ("आधी कामं जोडा" answers later)
        fireEvent.click(screen.getByTestId('own-add-stage'));
        fireEvent.change(screen.getByTestId('own-stage-name'), { target: { value: 'फुलोरा' } });
        fireEvent.change(screen.getByTestId('own-stage-from'), { target: { value: '40' } });
        fireEvent.change(screen.getByTestId('own-stage-to'), { target: { value: '30' } });
        expect(screen.getByTestId('own-stage-err')).toHaveTextContent('शेवटचा दिवस सुरुवातीच्या दिवसाआधी असू शकत नाही');
        expect(screen.getByTestId('own-stage-ok')).toBeDisabled();
    });

    it('A_stage_is_added_with_its_days_and_the_made_for_days_are_worked_out_from_it', async () => {
        open();
        await toStages();
        addStage('फुलोरा ते फळधारणा', 31, 60);
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('फुलोरा ते फळधारणा');
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('दिवस 31–60');
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('या स्टेजमध्ये अजून काम नाही');
        expect(screen.getByTestId('own-mf-box')).toHaveTextContent('61 दिवस');
    });

    it('The_work_form_has_the_mic_first_then_the_type_box_and_the_three_boxes_always_there (TAP-1, Q3 = 1)', async () => {
        open();
        await toStages();
        addStage();
        fireEvent.click(screen.getByTestId('own-add-work-0'));
        const form = await screen.findByTestId('own-work');
        const first = form.querySelector('button, input, textarea, select');
        expect(first).toBe(screen.getByTestId('plan-mic'));
        expect(form).toHaveTextContent('बोलता येत नसेल तर इथे लिहा');
        expect(screen.getByTestId('own-box-what')).toHaveTextContent('काम');
        expect(screen.getByTestId('own-box-when')).toHaveTextContent('कधी');
        expect(screen.getByTestId('own-box-often')).toHaveTextContent('किती वेळा');
        expect(screen.getByTestId('own-work-voice-note')).toHaveTextContent('बोलण्यातून फक्त काम भरतं. कधी (दिवस) आणि किती वेळा खाली हाताने भरा.');
        // the days start on the stage's own days
        expect(screen.getByTestId('own-from')).toHaveValue(31);
        expect(screen.getByTestId('own-to')).toHaveValue(60);
        expect(screen.getByTestId('own-work-need')).toHaveTextContent('आधी काम सांगा किंवा लिहा');
        expect(screen.getByTestId('own-work-ok')).toBeDisabled();
    });

    it('Voice_fills_ONLY_the_work_box: the days and how often stay as they were, even when he said "उद्या"', async () => {
        const understand = vi.fn(async (): Promise<PlanSpeechResult> => ({ ok: true, speech: { transcript: 'बुरशीनाशक फवारणी, दिवस 34 ते 55, दर 7 दिवसांनी', title: 'बुरशीनाशक फवारणी', dueHint: 'उद्या' } }));
        open({ understand: understand as never });
        await toStages();
        addStage();
        fireEvent.click(screen.getByTestId('own-add-work-0'));
        await act(async () => { fireEvent.click(await screen.findByTestId('plan-mic')); });
        await waitFor(() => expect(screen.getByTestId('own-work-name')).toHaveValue('बुरशीनाशक फवारणी'));
        expect(screen.getByTestId('own-heard')).toHaveTextContent('बुरशीनाशक फवारणी, दिवस 34 ते 55, दर 7 दिवसांनी');
        expect(screen.getByTestId('own-from')).toHaveValue(31);
        expect(screen.getByTestId('own-to')).toHaveValue(60);
        expect(screen.getByTestId('own-mode-one_time')).toHaveAttribute('aria-checked', 'true');
    });

    it('A_work_that_ends_before_it_starts_is_refused_in_words_and_cannot_be_added', async () => {
        open();
        await toStages();
        addStage();
        fireEvent.click(screen.getByTestId('own-add-work-0'));
        fireEvent.change(screen.getByTestId('own-work-name'), { target: { value: 'सिंचन' } });
        fireEvent.change(screen.getByTestId('own-from'), { target: { value: '50' } });
        fireEvent.change(screen.getByTestId('own-to'), { target: { value: '40' } });
        expect(screen.getByTestId('own-work-err')).toHaveTextContent('शेवटचा दिवस सुरुवातीच्या दिवसाआधी असू शकत नाही');
        expect(screen.getByTestId('own-work-ok')).toBeDisabled();
    });

    it('Adding_a_work_shows_its_row_(part, days, how often) and the first line of the change list', async () => {
        open();
        await toStages();
        addStage();
        addWork('ठिबक सिंचन', 31, 60, 5);
        const row = screen.getByTestId('own-work-row-0-0');
        expect(row).toHaveTextContent('ठिबक सिंचन');
        expect(row).toHaveTextContent('सिंचन');
        expect(row).toHaveTextContent('दिवस 31–60');
        expect(row).toHaveTextContent('दर 5 दिवसांनी');
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('1 कामं');
        const lines = within(screen.getByTestId('own-changes')).getAllByRole('listitem').map(li => li.textContent);
        expect(lines.some(l => l?.includes('शेड्यूल बनवलं'))).toBe(true);
        expect(lines.some(l => l?.includes('ठिबक सिंचन जोडलं — दिवस 31–60 · दर 5 दिवसांनी'))).toBe(true);
        expect(await queue()).toEqual([]); // still nothing saved
    });

    it('A_work_can_be_changed_and_removed_before_saving', async () => {
        open();
        await toStages();
        addStage();
        addWork('ठिबक सिंचन', 31, 60, 5);
        fireEvent.click(screen.getByTestId('own-work-edit-0-0'));
        expect(await screen.findByTestId('own-work')).toBeInTheDocument();
        expect(screen.getByTestId('own-title')).toHaveTextContent('काम बदला');
        fireEvent.change(screen.getByTestId('own-interval'), { target: { value: '7' } });
        expect(screen.getByTestId('own-work-ok')).toHaveTextContent('हे काम बदला');
        fireEvent.click(screen.getByTestId('own-work-ok'));
        expect(screen.getByTestId('own-work-row-0-0')).toHaveTextContent('दर 7 दिवसांनी');
        fireEvent.click(screen.getByTestId('own-work-del-0-0'));
        expect(screen.queryByTestId('own-work-row-0-0')).toBeNull();
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('या स्टेजमध्ये अजून काम नाही');
    });

    it('A_draft_the_server_would_refuse_for_good_cannot_be_saved: a work that starts outside every stage is named in words', async () => {
        open();
        await toStages();
        addStage('फुलोरा', 31, 60);
        addWork('सिंचन', 31, 60, 5);
        fireEvent.click(screen.getByTestId('own-stage-edit-0'));
        fireEvent.change(await screen.findByTestId('own-stage-from'), { target: { value: '45' } });
        fireEvent.click(screen.getByTestId('own-stage-ok'));
        expect(screen.getByTestId('own-problem')).toHaveTextContent('कामाचे दिवस स्टेजच्या दिवसांत बसत नाहीत');
        expect(screen.getByTestId('own-save')).toBeDisabled();
    });
});

describe('जतन करा: nothing before it, the contract\'s mutations after it', () => {
    it('Blank_start_saves_one_create_and_one_edit_with_the_picks_and_says_it_waits_for_the_net', async () => {
        open();
        fireEvent.change(await screen.findByTestId('own-name'), { target: { value: 'माझं द्राक्ष' } });
        fireEvent.click(screen.getByTestId('own-start-blank'));
        fireEvent.click(await screen.findByTestId('own-mf-variety-Thompson Seedless'));
        fireEvent.click(screen.getByTestId('own-mf-soilType-black'));
        fireEvent.click(screen.getByTestId('own-mf-next'));
        await screen.findByTestId('own-stages');
        addStage();
        addWork();
        expect(await queue()).toEqual([]);
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleCreate, SyncMutationName.ScheduleEdit]));
        const [create, edit] = (await queue()).map(r => r.payload as Record<string, unknown>);
        expect(create).toMatchObject({ farmId: FARM, cropKey: 'grape', name: 'माझं द्राक्ष', variety: 'Thompson Seedless', soilType: 'black' });
        expect(edit).toMatchObject({ scheduleTemplateId: create.scheduleTemplateId, farmId: FARM, variety: 'Thompson Seedless', soilType: 'black' });
        expect(edit.stages).toEqual([{ name: 'फुलोरा ते फळधारणा', startDay: 31, endDay: 60 }]);
        expect(edit.activities).toEqual([{ name: 'ठिबक सिंचन', part: 'irrigation', startDay: 31, endDay: 60, frequencyMode: 'every_n_days', intervalDays: 5 }]);
        expect(await screen.findByTestId('flow-closed')).toBeInTheDocument(); // the maker closes; the library tells the rest
    });

    it('A_blank_schedule_with_no_stage_saves_only_the_create', async () => {
        open();
        await toStages();
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleCreate]));
    });

    it('The_save_button_cannot_be_tapped_twice_into_two_schedules', async () => {
        open();
        await toStages();
        const save = screen.getByTestId('own-save');
        await act(async () => { fireEvent.click(save); fireEvent.click(save); });
        await waitFor(async () => expect((await queue()).length).toBeGreaterThan(0));
        expect((await queue()).filter(r => r.mutationType === SyncMutationName.ScheduleCreate)).toHaveLength(1);
    });
});

describe('start from a checked schedule', () => {
    const startChecked = async () => {
        const button = await screen.findByTestId('own-start-checked');
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
    };

    it('Takes_the_checked_schedules_stages_and_works_as_the_base_and_a_plain_copy_is_ONE_clone_with_no_check', async () => {
        open();
        await startChecked();
        fireEvent.click(await screen.findByTestId('own-mf-next'));
        await screen.findByTestId('own-stages');
        expect(screen.getByTestId('own-stage-0')).toHaveTextContent('छाटणीनंतर');
        expect(screen.getByTestId('own-stage-1')).toHaveTextContent('फुलोरा');
        expect(screen.getByTestId('own-work-row-0-0')).toHaveTextContent('ठिबक सिंचन');
        expect(screen.getByTestId('own-work-row-1-0')).toHaveTextContent('बुरशीनाशक फवारणी');
        expect(within(screen.getByTestId('own-changes')).getAllByRole('listitem')[0]).toHaveTextContent('तपासलेल्या शेड्यूलवरून बनवलं');
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleClone]));
        expect((await queue())[0].payload).toMatchObject({ sourceScheduleTemplateId: T_UNI, farmId: FARM, intoFarmOwn: true, newScope: 'Team' });
    });

    it('Taking_a_pick_or_changing_a_work_adds_ONE_edit_of_the_copy', async () => {
        open();
        await startChecked();
        fireEvent.click(await screen.findByTestId('own-mf-region-mh_nashik'));
        fireEvent.click(screen.getByTestId('own-mf-next'));
        await screen.findByTestId('own-stages');
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleClone, SyncMutationName.ScheduleEdit]));
        const edit = (await queue())[1].payload as Record<string, unknown>;
        expect(edit).toMatchObject({ region: 'mh_nashik', farmId: FARM });
        expect(edit.stages).toHaveLength(2);
        expect(edit.activities).toHaveLength(2);
        expect((edit.activities as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'ठिबक सिंचन', operationKey: 'op_irrigation' });
    });
});

describe('the server\'s day rules bind a version written whole, not a plain copy', () => {
    const ODD = { ...CHECKED, activities: [...CHECKED.activities, { name: 'लांब काम', category: 'Work', stageName: 'फुलोरा', startDay: 20, endDay: 90, frequencyMode: 'one_time', intervalDays: null, part: 'Work' }] };

    it('A_plain_copy_of_a_checked_schedule_is_never_blocked_by_them (the server copies the days as they are)', async () => {
        await seedRows([ODD]);
        open();
        const button = await screen.findByTestId('own-start-checked');
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        fireEvent.click(await screen.findByTestId('own-mf-next'));
        await screen.findByTestId('own-stages');
        expect(screen.queryByTestId('own-problem')).toBeNull();
        expect(screen.getByTestId('own-save')).toBeEnabled();
    });

    it('Once_something_is_changed_the_whole_version_is_written_and_the_phone_asks_the_rules_first', async () => {
        await seedRows([ODD]);
        open();
        const button = await screen.findByTestId('own-start-checked');
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        fireEvent.click(await screen.findByTestId('own-mf-region-mh_nashik'));
        fireEvent.click(screen.getByTestId('own-mf-next'));
        await screen.findByTestId('own-stages');
        expect(screen.getByTestId('own-problem')).toHaveTextContent('कामाचे दिवस स्टेजच्या दिवसांत बसत नाहीत');
        expect(screen.getByTestId('own-save')).toBeDisabled();
    });
});

describe('changing one of his own schedules writes a NEW version (never in place)', () => {
    const V1 = ownRow({ id: id(1), name: 'माझं द्राक्ष शेड्यूल', stages: STAGES_A, activities: WORKS_A, version: 1 });
    const V2 = ownRow({ id: id(2), name: 'माझं द्राक्ष शेड्यूल', stages: STAGES_A, activities: WORKS_A.slice(0, 2), version: 2, previousVersionId: id(1), madeByUserId: TYPIST, madeAtUtc: '2026-11-07T05:00:00Z' });
    const openEdit = async () => {
        await seedRows([CHECKED, V1, V2]);
        render(<Host initial={{ page: 'edit', chainId: id(1) }} />);
        await screen.findByTestId('own-stages');
    };

    it('Opens_on_the_newest_version_with_nothing_to_save_yet', async () => {
        await openEdit();
        expect(screen.getByTestId('own-save')).toBeDisabled(); // nothing changed
        expect(screen.getByTestId('own-changes')).toHaveTextContent('अजून काही बदललं नाही');
        expect(screen.getByTestId('own-stages')).toHaveTextContent('ठिबक सिंचन');
        expect(screen.getByTestId('own-stages')).not.toHaveTextContent('घड विरळणी'); // V2 dropped it
    });

    it('A_removed_work_is_a_line_of_the_change_list_and_the_save_is_ONE_schedule_edit_that_names_the_version_it_changes', async () => {
        await openEdit();
        fireEvent.click(screen.getByTestId('own-work-del-2-1'));
        expect(within(screen.getByTestId('own-changes')).getAllByRole('listitem')[0]).toHaveTextContent('बुरशीनाशक फवारणी काढली');
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleEdit]));
        const edit = (await queue())[0].payload as Record<string, unknown>;
        expect(edit.scheduleTemplateId).toBe(id(2));
        expect(edit.newScheduleTemplateId).not.toBe(id(2));
        expect(edit.farmId).toBe(FARM);
        expect((edit.activities as Array<{ name: string }>).map(a => a.name)).toEqual(['ठिबक सिंचन']);
        expect(Object.keys(edit)).not.toContain('newName'); // the name did not change
    });

    it('While_an_earlier_change_of_this_schedule_is_still_queued_a_new_one_is_refused_in_words_and_nothing_is_written (P001)', async () => {
        await seedRows([CHECKED, V1, V2]);
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'schedule.edit:queued', clientCommandId: 'schedule.edit:queued', mutationType: SyncMutationName.ScheduleEdit,
            payload: { scheduleTemplateId: id(2), newScheduleTemplateId: id(3), farmId: FARM, stages: [{ name: 'a', startDay: 0, endDay: 5 }] },
            status: 'FAILED', retryCount: 5, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
        });
        render(<Host initial={{ page: 'edit', chainId: id(1) }} />);
        await screen.findByTestId('own-stages');
        const note = await screen.findByTestId('own-blocked');
        expect(note).toHaveTextContent('आधीचा बदल अजून सर्व्हरपर्यंत पोहोचलेला नाही');
        fireEvent.click(screen.getByTestId('own-work-del-2-1'));
        expect(screen.getByTestId('own-save')).toBeDisabled();
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        expect((await queue()).map(r => r.clientRequestId)).toEqual(['schedule.edit:queued']);
    });

    it('The_refusal_is_English_only_in_English_mode (P001)', async () => {
        language.current = 'en';
        await seedRows([CHECKED, V1, V2]);
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'schedule.edit:queued', clientCommandId: 'schedule.edit:queued', mutationType: SyncMutationName.ScheduleEdit,
            payload: { scheduleTemplateId: id(2), newScheduleTemplateId: id(3), farmId: FARM, stages: [{ name: 'a', startDay: 0, endDay: 5 }] },
            status: 'PENDING', retryCount: 0, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
        });
        render(<Host initial={{ page: 'edit', chainId: id(1) }} />);
        const note = await screen.findByTestId('own-blocked');
        expect(note.textContent).toMatch(/^[\x20-\x7E]+$/);
        expect(note).toHaveTextContent('has not reached the server yet');
    });

    it('A_stage_edit_and_the_made_for_block_can_be_changed_from_here_too', async () => {
        await openEdit();
        fireEvent.click(screen.getByTestId('own-edit-madefor'));
        fireEvent.click(await screen.findByTestId('own-mf-climate-dry'));
        fireEvent.click(screen.getByTestId('own-mf-next')); // "झालं"
        await screen.findByTestId('own-stages');
        expect(within(screen.getByTestId('own-changes')).getAllByRole('listitem')[0]).toHaveTextContent('यासाठी बनवलं: हवामान कोरडं');
        await act(async () => { fireEvent.click(screen.getByTestId('own-save')); });
        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleEdit]));
        expect((await queue())[0].payload).toMatchObject({ climate: 'dry' });
    });
});

describe('English mode shows English only', () => {
    it('Start_screen_and_made_for_screen', async () => {
        language.current = 'en';
        open();
        const start = await screen.findByTestId('own-start');
        expect(start).toHaveTextContent('Your own schedule');
        expect(screen.getByTestId('own-start-blank')).toHaveTextContent('Start from blank');
        expect(screen.getByTestId('own-start-checked')).toHaveTextContent('Start from a checked schedule');
        expect(screen.getByTestId('own-name')).toHaveValue('My Grapes schedule');
        fireEvent.click(screen.getByTestId('own-start-blank'));
        const page = await screen.findByTestId('own-madefor');
        expect(page).toHaveTextContent('Made for');
        expect(page).toHaveTextContent('Black');
        expect(page.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
