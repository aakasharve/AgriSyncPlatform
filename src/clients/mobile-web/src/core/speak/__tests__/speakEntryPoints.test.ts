/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes MIC-1 + E1) — the classification of EVERY mic / speak entry
 * point, as a test table, and the inventory of the routes into the old hand-filled form (`ManualEntry`).
 *
 * MIC-1: each "speak to the log" button goes through `requestSpeak` with its purpose (and comes back where it started —
 * `speakHost.test.tsx` proves the return for every purpose). Not every mic is one: the recorder's own door, the हजेरी
 * flows (already the same recorder; their meaning is not changed), तुलना (excluded: being redesigned), consent /
 * permissions / settings / admin, and icons that are not controls are classified, not routed.
 * E1: the old form is no longer reached from "बदला", आढावा's plot day, the typing sheet or the quick sheet's chips.
 * Lane OF (founder D-57 … D-61, 2026-10-31): its last five uses got their homes, so it is rendered NOWHERE for a farmer —
 * the हजेरी door's edit (tap on the result; the वही's day), a parse the auto-save declined ("तपासा आणि जतन करा"), offline
 * voice (आवाज नोंदी), a past day (आढावा → crop → plot → mic), removing a part / changing the plot (the बदला screen's taps).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPEAK_PURPOSES, requestSpeak, resetSpeakStoreForTests, type SpeakPurpose } from '../speakStore';
import { mayKeepOffline } from '../speakFlow';
import { saysAnything } from '../../../features/logs/components/correction/correctionModel';

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf-8');

/**
 * ROUTED: the button, the file that wires it, its purpose, and its ACTUAL CALL SITE (fix pass: the button's own prop
 * or handler reaching the ONE mic with that purpose — not merely "the file mentions requestSpeak somewhere"). Each is
 * also exercised by a render / behaviour test: `mainView.voiceResult` (add-another, untold part), `attentionRoute`
 * (attention), `ReflectPage.render` + `todoAdd.reflectPage` (plot day, to-do), `correctionFlow` (correction),
 * `speakHost` (the return for every purpose).
 */
const ROUTED: Array<{ id: string; button: string; wiredIn: string; purpose: SpeakPurpose; place: 'known' | 'current' | 'unknown'; site: RegExp }> = [
    { id: 'result-add-another', button: 'result screen "आणखी सांगा"', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'addToDay', place: 'current',
        site: /onAddAnother=\{\(\) => speakHere\(\{ purpose: 'addToDay', context: \{ place: 'current' \} \}\)\}/ },
    { id: 'result-untold-part', button: 'result screen "… सांगितलं नाही. दाबा आणि बोला" + a red ring orb', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'fillPart', place: 'current',
        site: /onTellMore=\{part => speakHere\(\{ purpose: 'fillPart', context: \{ place: 'current', part \} \}\)\}/ },
    // Lane FX-1 (ATT-LOG + CTX-1) — no place: the ONE mic asks the crop, then the plot, then listens.
    { id: 'result-attendance-count', button: 'result screen हजेरी card "किती जण होते ते सांगा"', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'fillPart', place: 'unknown',
        site: /<TodayAttendanceCard state=\{attendance\} onTell=\{\(\) => speakHere\(\{ purpose: 'fillPart', context: \{ part: 'labour' \} \}\)\} \/>/ },
    { id: 'result-sathi-question', button: 'result screen Sathi question "बोलून सांगा"', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'answerQuestion', place: 'current',
        site: /onAnswerBySpeaking=\{\(pending\) => \{\s*stashPendingQuestionAnswer\(pending\);\s*speakHere\(\{ purpose: 'answerQuestion'/ },
    { id: 'saved-sathi-question', button: 'saved card Sathi question "बोलून सांगा"', wiredIn: 'core/navigation/savedView.tsx', purpose: 'answerQuestion', place: 'current',
        site: /onAnswerBySpeaking=\{\(pending\) => \{\s*stashPendingQuestionAnswer\(pending\);\s*requestSpeak\(\{\s*purpose: 'answerQuestion'/ },
    { id: 'saved-add-another', button: 'saved card "आणखी सांगा"', wiredIn: 'core/navigation/savedView.tsx', purpose: 'addToDay', place: 'current',
        site: /<button onClick=\{\(\) => requestSpeak\(\{ purpose: 'addToDay', context: \{ place: 'current' \}/ },
    // Lane OF (TAP-1): the big mic first, then typing right under it — both THE one mic, for this entry.
    { id: 'correction-mic', button: '"बदला" screen big mic + "बोलता येत नसेल तर इथे लिहा"', wiredIn: 'core/speak/CorrectionHost.tsx', purpose: 'correctEntry', place: 'known',
        site: /const speak = \(typed\?: string\) => \{[\s\S]*?requestSpeak\(\{\s*purpose: 'correctEntry'[\s\S]*onSpeak=\{\(\) => speak\(\)\}[\s\S]*onSend=\{text => \{ setSheet\(null\); speak\(text\); \}\}/ },
    // Lane OF (D-58): "तपासा आणि जतन करा" — "पुन्हा सांगा" (and typing) on the same plots, the parse put down first.
    { id: 'check-save-again', button: '"तपासा आणि जतन करा" "पुन्हा सांगा" / "इथे लिहा"', wiredIn: 'core/navigation/checkSaveView.tsx', purpose: 'addToDay', place: 'current',
        site: /requestSpeak\(\{\s*purpose: 'addToDay',\s*context: \{ place: 'current'/ },
    // Lane OF (D-60): a past day in आढावा — no place: the crop → plot steps with the date, then the mic.
    { id: 'reflect-past-day', button: 'आढावा past day "त्या दिवसाचं काम सांगा"', wiredIn: 'features/reflect/ReflectPage.tsx', purpose: 'addToDay', place: 'unknown',
        site: /const tellPastDay = [\s\S]*?onSpeak\(\{ purpose: 'addToDay', context: \{ date: dateKey \}/ },
    // Lane OF (D-59): an offline recording with nothing understood in it — said again for its own place and day.
    { id: 'voice-note-again', button: 'आवाज नोंदी "पुन्हा सांगा"', wiredIn: 'features/voiceDiary/waiting/WaitingVoiceNotes.tsx', purpose: 'addToDay', place: 'known',
        site: /requestSpeak\(\{\s*purpose: 'addToDay',\s*context: \{ \.\.\.\(place && \{ place \}\)/ },
    { id: 'reflect-plot-day-tell', button: 'आढावा plot day "आणखी सांगा"', wiredIn: 'features/reflect/ReflectPage.tsx', purpose: 'addToDay', place: 'known',
        site: /onTellMore=\{tellMoreFor\(dayPlace\)\}/ },
    { id: 'reflect-todo-tell', button: 'आढावा करायची कामे "बोलून सांगा"', wiredIn: 'features/reflect/ReflectPage.tsx', purpose: 'addTodo', place: 'known',
        site: /onTell=\{tellTodo\}/ },
    { id: 'attention-record', button: 'लक्ष द्या "काम नोंदवा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'attention', place: 'known',
        site: /onRecordWork=\{\(step\) => \{[^}]*\n[^}]*requestSpeak\(\{\s*purpose: 'attention'/ },
    { id: 'procurement-tell', button: 'खरेदी "बोलून सांगा" / "हाताने लिहा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'addToDay', place: 'unknown',
        site: /onTell=\{\(\) => \{ requestSpeak\(\{ purpose: 'addToDay', returnTo: \{ route: 'procurement'/ },
    { id: 'tests-tell', button: 'चाचण्या "सांगा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'addToDay', place: 'unknown',
        site: /onTell=\{\(\) => \{ requestSpeak\(\{ purpose: 'addToDay', returnTo: \{ route: 'tests'/ },
];

/** NOT ROUTED, and why. Each named file is checked to NOT call the ONE mic (its meaning is its own). */
const NOT_ROUTED: Array<{ id: string; file: string; why: 'the recorder itself' | 'हजेरी (same recorder, meaning unchanged)' | 'excluded: तुलना' | 'not speak-to-log' | 'admin' | 'icon, not a control' }> = [
    { id: 'work-home-tell', file: 'features/logs/components/entry/WorkHome.tsx', why: 'the recorder itself' },
    { id: 'quick-sheet-voice', file: 'features/logs/components/QuickLogSheet.tsx', why: 'the recorder itself' },
    { id: 'labour-hub-speak', file: 'features/labour/components/LabourHub.tsx', why: 'हजेरी (same recorder, meaning unchanged)' },
    { id: 'attendance-result-speak', file: 'features/labour/components/AttendanceResult.tsx', why: 'हजेरी (same recorder, meaning unchanged)' },
    // D-63 (2026-10-31): the old form's three mics left with the form — it and its own parts are deleted.
    { id: 'compare-tell', file: 'features/compare/ComparePage.tsx', why: 'excluded: तुलना' },
    { id: 'compare-plot-tell', file: 'features/compare/ComparePlotCard.tsx', why: 'excluded: तुलना' },
    { id: 'consent-toggle', file: 'features/consent/VoiceRetainedConsentToggle.tsx', why: 'not speak-to-log' },
    { id: 'permissions-page', file: 'pages/OnboardingPermissionsPage.tsx', why: 'not speak-to-log' },
    { id: 'settings-page', file: 'pages/SettingsPage.tsx', why: 'not speak-to-log' },
    { id: 'profile-offline-notes', file: 'features/profile/ProfilePage.tsx', why: 'not speak-to-log' },
    { id: 'admin-ops', file: 'features/admin/ops/AdminOpsPage.tsx', why: 'admin' },
    { id: 'schedule-done-clips', file: 'features/scheduler/schedulePage/DoneTab.tsx', why: 'icon, not a control' },
    { id: 'voice-diary-clip', file: 'features/voiceDiary/components/ClipPlayerCard.tsx', why: 'icon, not a control' },
    { id: 'voice-diary-empty', file: 'features/voiceDiary/components/EmptyStatePrompt.tsx', why: 'icon, not a control' },
    { id: 'welcome-illustration', file: 'pages/WelcomeScreen.tsx', why: 'icon, not a control' },
];

const callsTheOneMic = (src: string): boolean => /\brequestSpeak\(|\bonSpeak\(/.test(src);

describe('MIC-1 — the routed speak entry points (test table)', () => {
    it.each(ROUTED)('$id: $button → requestSpeak($purpose), at its own call site', ({ wiredIn, purpose, site }) => {
        expect(SPEAK_PURPOSES).toContain(purpose);
        const src = read(wiredIn);
        expect(src).toMatch(site);
        expect(src).toContain(`purpose: '${purpose}'`);
    });

    it('the plot day\'s and the to-do\'s handlers are the ones that reach the ONE mic with their purposes', () => {
        const page = read('features/reflect/ReflectPage.tsx');
        const tell = page.slice(page.indexOf('const tellMoreFor'), page.indexOf('const tellTodo'));
        expect(tell).toMatch(/onSpeak\(\{\s*purpose: 'addToDay'/);
        const todo = page.slice(page.indexOf('const tellTodo'), page.indexOf('const dayLabel'));
        expect(todo).toMatch(/onSpeak\(\{ purpose: 'addTodo'/);
        expect(read('features/reflect/overview/TodoAddForm.tsx')).toMatch(/<Tap onClick=\{onTell\} data-testid="todo-tell"/);
        expect(read('features/logs/components/correction/CorrectionScreen.tsx')).toMatch(/onClick=\{p\.onSpeak\}[^>]*data-testid="corr-mic"/);
    });

    it('every purpose but the schedule\'s has a routed entry point (no schedule screen offers to speak today)', () => {
        const used = new Set(ROUTED.map(r => r.purpose));
        expect(SPEAK_PURPOSES.filter(p => !used.has(p))).toEqual(['scheduleDone']);
    });

    it('the old doors are gone from the routed screens: no route change into the log tab, no openLogFlow', () => {
        for (const file of ['core/navigation/simpleRoutes.tsx', 'core/navigation/voiceResultView.tsx', 'features/reflect/ReflectPage.tsx']) {
            const src = read(file);
            expect(src).not.toContain('openLogFlow(');
            expect(src).not.toMatch(/onTell=\{\(\) => \{ ctx\.setMainView\('log'\)/);
        }
    });
});

describe('MIC-1 — classified, not routed', () => {
    it.each(NOT_ROUTED)('$id ($why) does not call the ONE mic', ({ file }) => {
        expect(callsTheOneMic(read(file))).toBe(false);
    });

    it('तुलना is untouched by this lane (excluded): still its own door, never requestSpeak', () => {
        expect(read('core/navigation/compareTab.ts')).toContain('openLogFlow(');
        expect(callsTheOneMic(read('core/navigation/compareTab.ts'))).toBe(false);
    });
});

describe('E1 — the old hand-filled form (ManualEntry) inventory', () => {
    it('"बदला" (handleEditLog) opens the speak-the-change screen; it never sets the old "manual" edit draft', () => {
        const router = read('core/navigation/AppRouter.tsx');
        const fn = router.slice(router.indexOf('const handleEditLog'), router.indexOf('const correctionSave'));
        expect(fn).toContain('openCorrection(log.id)');
        expect(fn).not.toContain("setMode('manual')");
        expect(fn).not.toContain('setDraftLog');
        const preview = read('features/oversight/preview/usePreviewRouterCtx.ts');
        expect(preview).toContain('openCorrection(log.id)');
    });

    it('आढावा no longer starts a plot day in the form, the typing sheet no longer offers it, the quick sheet has no form chips', () => {
        expect(read('features/reflect/ReflectPage.tsx')).not.toContain('newEntryFor');
        expect(read('features/reflect/ReflectPageProps.ts')).not.toContain('onEditLog');
        expect(read('core/navigation/mainView.tsx')).not.toContain('onEditLog=');
        const typed = read('features/voice/components/recorder/TypedEntry.tsx');
        expect(typed).not.toContain('typed-open-form');
        expect(typed).not.toMatch(/form: 'किंवा फॉर्ममध्ये/);
        expect(read('features/logs/components/entry/LogEntryFlow.tsx')).not.toContain('renderForm');
        const quick = read('features/logs/components/QuickLogSheet.tsx');
        expect(quick).not.toContain('quick-log-chip-irrigation');
        expect(quick).toContain('quick-log-chip-no-work'); // "आज काम नाही" keeps its home
        expect(read('core/navigation/globalSheets.tsx')).not.toContain("setMode('manual')");
        expect(read('core/navigation/savedView.tsx')).not.toContain("setMode('manual')");
    });

    it('lane OF: the form is rendered NOWHERE for a farmer (static, dynamic and React.lazy imports all counted)', () => {
        const importers: string[] = [];
        const IMPORTS_FORM = /(?:from\s+'[^']*\/ManualEntry'|import\(\s*'[^']*\/ManualEntry'\s*\))/;
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (e.isDirectory()) { if (!['__tests__', 'node_modules'].includes(e.name)) walk(join(dir, e.name)); continue; }
                if (!/\.tsx?$/.test(e.name)) continue;
                const file = join(dir, e.name);
                const rel = relative(SRC, file).replace(/\\/g, '/');
                if (IMPORTS_FORM.test(readFileSync(file, 'utf-8'))) importers.push(rel);
            }
        };
        walk(SRC);
        expect(importers).toEqual([]);
        // what stands where it used to be rendered
        const main = read('core/navigation/mainView.tsx');
        expect(main).not.toContain('renderManualEntry');
        expect(main).toContain('return <CheckSaveHost ctx={ctx} />;'); // D-58: a parse the auto-save declined
        expect(main).toMatch(/renderEmpty=\{\(\) => <AttendanceNotHeard /); // D-57: the हजेरी door heard no हजेरी
        expect(read('features/labour/components/AttendanceResult.tsx')).not.toContain('renderEditSurface'); // D-57: tap on the result
        expect(read('pages/AiDraftsPage.tsx')).toContain('isPhotoResult'); // D-59: voice moved to आवाज नोंदी
    });

    /**
     * Review B005 — the two capabilities that had no home: lane OF gave each one (founder D-61 = 5A + TAP-1). A spoken
     * change still keeps nothing offline (it would come back as a new log); the TAP change is the offline way.
     */
    it.each([
        { gap: 'remove a wrong item, or a whole part', proof: () => {
            // still no spoken "remove it" (a part he does not mention stays as it was) …
            expect(saysAnything({ summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [] })).toBe(false);
            // … so the बदला screen has "काढा" / "परत आणा" by tapping (correctionFlow.test.tsx proves it end to end)
            expect(read('features/logs/components/correction/CorrectionScreen.tsx')).toContain('data-testid={`corr-toggle-${row.id}`}');
        } },
        { gap: 'make a change offline straight away', proof: () => {
            requestSpeak({ purpose: 'correctEntry', context: { place: { cropId: 'FARM_GLOBAL' } }, returnTo: { route: 'main', mainView: 'reflect' } });
            expect(mayKeepOffline()).toBe(false); // a SPOKEN change is never kept offline …
            resetSpeakStoreForTests();
            expect(mayKeepOffline()).toBe(true);
            // … a TAP change is queued like any other edit (`revise_log_content`)
            expect(read('core/speak/CorrectionHost.tsx')).toContain('saveSpokenCorrection(');
        } },
    ])('B005 home found (lane OF): $gap', ({ proof }) => { proof(); });
});
