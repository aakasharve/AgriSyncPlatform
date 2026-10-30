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
 * E1: the old form is no longer reached from "बदला", आढावा's plot day, the typing sheet or the quick sheet's chips. It
 * is still rendered where it has NO new home yet — each listed below and reported to the founder (never removed silently).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPEAK_PURPOSES, type SpeakPurpose } from '../speakStore';

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf-8');

/** ROUTED: the button, the file that wires it to `requestSpeak` / `onSpeak`, and its purpose. */
const ROUTED: Array<{ id: string; button: string; wiredIn: string; purpose: SpeakPurpose; place: 'known' | 'current' | 'unknown' }> = [
    { id: 'result-add-another', button: 'result screen "आणखी सांगा"', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'addToDay', place: 'current' },
    { id: 'result-untold-part', button: 'result screen "… सांगितलं नाही. दाबा आणि बोला" + a red ring orb', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'fillPart', place: 'current' },
    { id: 'result-sathi-question', button: 'result screen Sathi question "बोलून सांगा"', wiredIn: 'core/navigation/voiceResultView.tsx', purpose: 'answerQuestion', place: 'current' },
    { id: 'saved-sathi-question', button: 'saved card Sathi question "बोलून सांगा"', wiredIn: 'core/navigation/savedView.tsx', purpose: 'answerQuestion', place: 'current' },
    { id: 'saved-add-another', button: 'saved card "आणखी सांगा"', wiredIn: 'core/navigation/savedView.tsx', purpose: 'addToDay', place: 'current' },
    { id: 'correction-mic', button: '"बदला" screen big mic + "पुन्हा सांगा"', wiredIn: 'core/speak/SpeakHost.tsx', purpose: 'correctEntry', place: 'known' },
    { id: 'reflect-plot-day-tell', button: 'आढावा plot day "आणखी सांगा"', wiredIn: 'features/reflect/ReflectPage.tsx', purpose: 'addToDay', place: 'known' },
    { id: 'reflect-todo-tell', button: 'आढावा करायची कामे "बोलून सांगा"', wiredIn: 'features/reflect/ReflectPage.tsx', purpose: 'addTodo', place: 'known' },
    { id: 'attention-record', button: 'लक्ष द्या "काम नोंदवा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'attention', place: 'known' },
    { id: 'procurement-tell', button: 'खरेदी "बोलून सांगा" / "हाताने लिहा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'addToDay', place: 'unknown' },
    { id: 'tests-tell', button: 'चाचण्या "सांगा"', wiredIn: 'core/navigation/simpleRoutes.tsx', purpose: 'addToDay', place: 'unknown' },
];

/** NOT ROUTED, and why. Each named file is checked to NOT call the ONE mic (its meaning is its own). */
const NOT_ROUTED: Array<{ id: string; file: string; why: 'the recorder itself' | 'हजेरी (same recorder, meaning unchanged)' | 'inside the residual old form' | 'excluded: तुलना' | 'not speak-to-log' | 'admin' | 'icon, not a control' }> = [
    { id: 'work-home-tell', file: 'features/logs/components/entry/WorkHome.tsx', why: 'the recorder itself' },
    { id: 'quick-sheet-voice', file: 'features/logs/components/QuickLogSheet.tsx', why: 'the recorder itself' },
    { id: 'labour-hub-speak', file: 'features/labour/components/LabourHub.tsx', why: 'हजेरी (same recorder, meaning unchanged)' },
    { id: 'attendance-result-speak', file: 'features/labour/components/AttendanceResult.tsx', why: 'हजेरी (same recorder, meaning unchanged)' },
    { id: 'form-unclear-again', file: 'shared/components/ui/UnclearSegmentCard.tsx', why: 'inside the residual old form' },
    { id: 'form-refine-by-voice', file: 'features/logs/components/activity-card/ActivityCard.tsx', why: 'inside the residual old form' },
    { id: 'form-observation-hub', file: 'features/logs/components/ObservationHubSheet.tsx', why: 'inside the residual old form' },
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
    it.each(ROUTED)('$id: $button → requestSpeak($purpose)', ({ wiredIn, purpose }) => {
        expect(SPEAK_PURPOSES).toContain(purpose);
        const src = read(wiredIn);
        expect(callsTheOneMic(src)).toBe(true);
        expect(src).toContain(`purpose: '${purpose}'`);
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

    it('where the form is STILL rendered: only the places with no new home yet (reported to the founder)', () => {
        const importers: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (e.isDirectory()) { if (!['__tests__', 'node_modules'].includes(e.name)) walk(join(dir, e.name)); continue; }
                if (!/\.tsx?$/.test(e.name)) continue;
                const file = join(dir, e.name);
                if (/import\s+ManualEntry\s+from\s+'[^']*\/ManualEntry'/.test(readFileSync(file, 'utf-8'))) importers.push(relative(SRC, file).replace(/\\/g, '/'));
            }
        };
        walk(SRC);
        // the log tab's one call (the हजेरी door's edit surface; a parse the voice auto-save declined) and the AI-drafts
        // review page — nothing else
        expect(importers.sort()).toEqual(['core/navigation/mainView.tsx', 'pages/AiDraftsPage.tsx']);
        const main = read('core/navigation/mainView.tsx');
        expect(main).not.toContain('renderForm');
        expect(main).toContain('renderManualEntry({ provenance: ownProvenance, recordedDateKey: captureDay })');
    });
});
