import { describe, it, expect } from 'vitest';
import {
    DFES_QUESTION_BANK, BANK_VERSION, QUESTION_ENGINE_VERSION, findGapQuestion, findQuestion,
} from '../dfesQuestionBank';

// spec: dfes-companion-2026-07-11 (Task 3A, extended Task 4B) — the ONLY
// documented content-gate exceptions to the hard AgronomistApproved &&
// MarathiApproved invariant below.
const CONTENT_GATED_KEYS = new Set(['schedule.category_planned_not_done', 'weather.severe_care_check']);

// Founder ruling 2026-08-13 (`flip-now`): the two spray-advice entries are
// agronomist-gated but Marathi-approved — the Marathi copy is founder-reviewed,
// the AGRONOMY is not. Kept as a separate set from CONTENT_GATED_KEYS so the
// invariant below still holds each entry to marathiApproved: true.
const AGRONOMIST_GATED_KEYS = new Set(['safety.spray_wind_high', 'weather.rain_before_spray']);

describe('DFES question bank v1 (Phase 5)', () => {
    it('every bank entry passes the hard AgronomistApproved && MarathiApproved gate, except documented content-gated entries', () => {
        for (const q of DFES_QUESTION_BANK) {
            if (CONTENT_GATED_KEYS.has(q.questionKey)) continue;
            if (!AGRONOMIST_GATED_KEYS.has(q.questionKey)) {
                expect(q.agronomistApproved, `${q.questionKey} agronomistApproved`).toBe(true);
            }
            expect(q.marathiApproved, `${q.questionKey} marathiApproved`).toBe(true);
        }
    });

    // Founder ruling 2026-08-13 (`flip-now`). These two are the only bank
    // entries that tell a farmer whether it is SAFE to spray. They carried
    // `...APPROVED` — a developer constant — and no agronomist ever reviewed
    // them. This asserts the RESOLVED object at runtime, not the source text,
    // because the previous shape spread `...APPROVED` last and any property
    // written before that spread would have been silently overwritten.
    it.each([...AGRONOMIST_GATED_KEYS])(
        'AGRONOMIST GATE: %s resolves to agronomistApproved:false at runtime (spread order cannot re-approve it)',
        (key) => {
            const q = findQuestion(key);
            expect(q).toBeDefined();
            expect(q!.agronomistApproved).toBe(false);
            // Marathi copy is founder-reviewed; only the agronomy is gated.
            expect(q!.marathiApproved).toBe(true);
            // Belt-and-braces: the merged object really carries the own-property,
            // whatever the literal's spread order happens to be.
            expect(Object.prototype.hasOwnProperty.call(q!, 'agronomistApproved')).toBe(true);
            expect(DFES_QUESTION_BANK.find(e => e.questionKey === key)!.agronomistApproved).toBe(false);
        },
    );

    // spec: dfes-companion-2026-07-11 (Task 3A) — the schedule question ships as
    // mechanism-only: present in the bank, keyed and typed correctly, but
    // deliberately INERT (both approval flags false) until an agronomist +
    // Marathi reviewer signs off. This is the honest content-gate lock the
    // engine's approved() gate enforces even with stageQuestions flag ON.
    it('CONTENT GATE: schedule.category_planned_not_done is present but inert (agronomistApproved:false) pending review', () => {
        const q = findQuestion('schedule.category_planned_not_done');
        expect(q).toBeDefined();
        expect(q!.triggerType).toBe('Schedule');
        expect(q!.agronomistApproved).toBe(false);
        expect(q!.marathiApproved).toBe(false);
    });

    // spec: dfes-companion-2026-07-11 (Task 4B) — same content-gate pattern as
    // the schedule question above: present, correctly keyed/typed, but
    // deliberately INERT pending agronomist + Marathi sign-off.
    it('CONTENT GATE: weather.severe_care_check is present but inert (agronomistApproved:false) pending review', () => {
        const q = findQuestion('weather.severe_care_check');
        expect(q).toBeDefined();
        expect(q!.triggerType).toBe('WeatherReconcile');
        expect(q!.agronomistApproved).toBe(false);
        expect(q!.marathiApproved).toBe(false);
    });

    it('stamps a stable BANK_VERSION and QUESTION_ENGINE_VERSION', () => {
        expect(BANK_VERSION).toBe('dfes-bank-1');
        expect(QUESTION_ENGINE_VERSION).toBe('dfes-qengine-1');
    });

    it('has one approved gap entry keyed gap.<dim> for all 8 scoring dimensions', () => {
        for (const dim of ['WHAT', 'DOSE', 'SCOPE', 'CARRIER', 'COST', 'PURPOSE', 'WEATHER', 'CONTINUITY']) {
            const q = findGapQuestion(dim);
            expect(q, `gap.${dim}`).toBeDefined();
            expect(q!.questionKey).toBe(`gap.${dim.toLowerCase()}`);
        }
    });

    it('re-buckets gap lenses per the locked 3-lens map', () => {
        expect(findGapQuestion('DOSE')!.lens).toBe('Execution');
        expect(findGapQuestion('PURPOSE')!.lens).toBe('Insight');
        expect(findGapQuestion('WEATHER')!.lens).toBe('Insight');
        expect(findGapQuestion('CONTINUITY')!.lens).toBe('Learning');
    });

    it('has no duplicate questionKeys', () => {
        const keys = DFES_QUESTION_BANK.map(q => q.questionKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('assigns a valid 1..8 priority and a 1..4 depthLevel to every entry', () => {
        for (const q of DFES_QUESTION_BANK) {
            expect(q.priority).toBeGreaterThanOrEqual(1);
            expect(q.priority).toBeLessThanOrEqual(8);
            expect(q.depthLevel).toBeGreaterThanOrEqual(1);
            expect(q.depthLevel).toBeLessThanOrEqual(4);
        }
    });

    // spec: dfes-companion-2026-07-11 (Task 2A) — tap-to-answer bank mechanism.
    describe('answerOptions (Task 2A — tap-to-answer bank mechanism)', () => {
        it('CONTENT GATE: stage.confirm_current has NO real, agronomist-approved Marathi option copy yet — answerOptions stays undefined (ack/skip-only)', () => {
            // No canonical Marathi-labeled crop-stage list exists anywhere in the
            // repo (StageCode enum is English-only, internal to the scheduler).
            // Wiring it here would be fabricated agronomy content, which Task 2A
            // explicitly forbids. This test documents that deliberate gap — it
            // should only ever flip once real agronomist+Marathi copy lands.
            expect(findQuestion('stage.confirm_current')?.answerOptions).toBeUndefined();
        });

        it('every option on any bank entry that DOES declare answerOptions has a non-empty value and labelMr', () => {
            for (const q of DFES_QUESTION_BANK) {
                if (!q.answerOptions) continue;
                expect(q.answerOptions.length).toBeGreaterThan(0);
                for (const opt of q.answerOptions) {
                    expect(opt.value.trim().length, `${q.questionKey} option value`).toBeGreaterThan(0);
                    expect(opt.labelMr.trim().length, `${q.questionKey} option labelMr`).toBeGreaterThan(0);
                }
            }
        });
    });
});
