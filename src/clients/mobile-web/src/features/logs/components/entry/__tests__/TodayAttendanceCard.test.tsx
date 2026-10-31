// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder ATT-LOG (2026-10-31, register F81): the हजेरी card on the log page, as on his design page
 * `G:\VALIDATION\PRODUCT CHANGES\ATTENDANCE-log` (wording ruled correct the same day). Empty, with the rule in big text,
 * until the work and the headcount are both told — a green tick for what is told, orange for what is missing, ONE
 * button; then "इथे हजेरी घ्या — आज N जण", which opens the names.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TodayAttendanceCard } from '../TodayAttendanceCard';
import type { TodayAttendance } from '../todayAttendance';

let language = 'mr';
vi.mock('../../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language }) }));

afterEach(() => { cleanup(); language = 'mr'; });

const WEEDING_G1 = { names: ['Weeding'], parts: [], place: { cropId: 'grape', cropName: 'Grapes', plotNames: ['G1'] } } as TodayAttendance['work'];
const NOTHING: TodayAttendance = { work: null, headcount: null, provisional: false };
const RULE = 'आज काय काम झालं आणि किती जण होते हे सांगितल्याशिवाय हजेरी ग्राह्य धरता येत नाही.';

describe('ATT-LOG — the empty card until both are told', () => {
    it('nothing told: dashed empty card, the rule in big text, both points missing, "आधी आजचं काम सांगा"', () => {
        const onTell = vi.fn();
        render(<TodayAttendanceCard state={NOTHING} onTell={onTell} onOpenNames={vi.fn()} />);
        const card = screen.getByTestId('attendance-card');
        expect(card).toHaveAttribute('data-state', 'empty');
        expect(card.className).toContain('border-dashed');
        expect(card).toHaveTextContent('आजची हजेरी');
        expect(screen.getByTestId('attendance-card-rule')).toHaveTextContent(RULE);
        expect(screen.getByTestId('attendance-card-rule').className).toContain('text-[21px]');
        expect(screen.getByTestId('attendance-card-work')).toHaveAttribute('data-told', 'no');
        expect(screen.getByTestId('attendance-card-work')).toHaveTextContent('काय काम झालं — अजून सांगितलं नाही');
        expect(screen.getByTestId('attendance-card-count')).toHaveAttribute('data-told', 'no');
        expect(screen.getByTestId('attendance-card-count')).toHaveTextContent('किती जण होते — अजून सांगितलं नाही');
        expect(screen.getByTestId('attendance-card-tell')).toHaveTextContent('आधी आजचं काम सांगा');
        // ONE button on the card (the register link is drawn only when handed in)
        expect(screen.getAllByRole('button')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('attendance-card-tell'));
        expect(onTell).toHaveBeenCalledTimes(1);
    });

    it('work told, no headcount: the work turns green with its name; "किती जण होते ते सांगा"', () => {
        render(<TodayAttendanceCard state={{ ...NOTHING, work: WEEDING_G1 }} onTell={vi.fn()} onOpenNames={vi.fn()} />);
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'work-told');
        expect(screen.getByTestId('attendance-card-work')).toHaveAttribute('data-told', 'yes');
        expect(screen.getByTestId('attendance-card-work')).toHaveTextContent('काम सांगितलं — खुरपणी');
        expect(screen.getByTestId('attendance-card-count')).toHaveAttribute('data-told', 'no');
        expect(screen.getByTestId('attendance-card-tell')).toHaveTextContent('किती जण होते ते सांगा');
    });

    it('headcount told first, work missing: "N जण" green, the work orange, and the button asks for the work', () => {
        render(<TodayAttendanceCard state={{ work: null, headcount: 6, provisional: false }} onTell={vi.fn()} onOpenNames={vi.fn()} />);
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'count-told');
        expect(screen.getByTestId('attendance-card-count')).toHaveTextContent('6 जण');
        expect(screen.getByTestId('attendance-card-tell')).toHaveTextContent('आधी आजचं काम सांगा');
    });

    it('a job name the list does not know in Marathi is not shown in English (language-strict): just "काम सांगितलं"', () => {
        render(<TodayAttendanceCard state={{ ...NOTHING, work: { names: ['Trellis wiring'], parts: [], place: null } }} onTell={vi.fn()} />);
        expect(screen.getByTestId('attendance-card-work').textContent).toBe('काम सांगितलं');
    });
});

describe('ATT-LOG — both told: "इथे हजेरी घ्या — आज N जण", and it opens the names', () => {
    it('reads N, the work and where, and opens the names on a tap', () => {
        const onOpenNames = vi.fn();
        render(<TodayAttendanceCard state={{ work: WEEDING_G1, headcount: 5, provisional: false }} onTell={vi.fn()} onOpenNames={onOpenNames} />);
        const card = screen.getByTestId('attendance-card');
        expect(card).toHaveAttribute('data-state', 'ready');
        expect(screen.getByTestId('attendance-card-ready')).toHaveTextContent('इथे हजेरी घ्या — आज 5 जण');
        expect(card).toHaveTextContent('काम: खुरपणी (द्राक्ष · G1). कोण आलं त्यांच्या नावावर दाबा.');
        expect(card).toHaveTextContent('हजेरी घ्या');
        expect(screen.queryByTestId('attendance-card-provisional')).toBeNull();
        fireEvent.click(card);
        expect(onOpenNames).toHaveBeenCalledTimes(1);
    });

    it('a count nobody confirmed yet says "खात्री बाकी" (D-46)', () => {
        render(<TodayAttendanceCard state={{ work: WEEDING_G1, headcount: 4, provisional: true }} onTell={vi.fn()} onOpenNames={vi.fn()} />);
        expect(screen.getByTestId('attendance-card-provisional')).toHaveTextContent('खात्री बाकी');
    });

    it('a plot named after its crop is not prefixed with the crop again (live 2026-10-31: "द्राक्ष · द्राक्ष G1")', () => {
        const grapeG1 = { names: ['Pruning'], parts: [], place: { cropId: 'grape', cropName: 'Grapes', plotNames: ['द्राक्ष G1'] } } as TodayAttendance['work'];
        render(<TodayAttendanceCard state={{ work: grapeG1, headcount: 10, provisional: false }} onTell={vi.fn()} onOpenNames={vi.fn()} />);
        const text = screen.getByTestId('attendance-card').textContent ?? '';
        expect(text).toContain('काम: छाटणी (द्राक्ष G1).');
        expect(text).not.toContain('द्राक्ष · द्राक्ष');
    });

    it('the whole farm by its own name', () => {
        render(<TodayAttendanceCard state={{ work: { names: ['Pruning'], parts: [], place: { cropId: 'FARM_GLOBAL', cropName: '', plotNames: [] } }, headcount: 2, provisional: false }}
            onTell={vi.fn()} onOpenNames={vi.fn()} />);
        expect(screen.getByTestId('attendance-card')).toHaveTextContent('काम: छाटणी (संपूर्ण शेत).');
    });
});

describe('ATT-LOG — the quiet way to the हजेरी place, and English mode', () => {
    it('"हजेरी वही बघा" opens the हजेरी place (the old door\'s other half), on both cards', () => {
        const onOpenRegister = vi.fn();
        render(<TodayAttendanceCard state={NOTHING} onTell={vi.fn()} onOpenRegister={onOpenRegister} />);
        fireEvent.click(screen.getByTestId('attendance-card-register'));
        cleanup();
        render(<TodayAttendanceCard state={{ work: WEEDING_G1, headcount: 5, provisional: false }} onTell={vi.fn()} onOpenNames={vi.fn()} onOpenRegister={onOpenRegister} />);
        expect(screen.getByTestId('attendance-card-register')).toHaveTextContent('हजेरी वही बघा');
        fireEvent.click(screen.getByTestId('attendance-card-register'));
        expect(onOpenRegister).toHaveBeenCalledTimes(2);
    });

    it('English mode shows English only (PROPOSED twins), the job names in English', () => {
        language = 'en';
        render(<TodayAttendanceCard state={{ ...NOTHING, work: WEEDING_G1 }} onTell={vi.fn()} onOpenRegister={vi.fn()} />);
        const text = document.body.textContent ?? '';
        expect(text).toContain("Attendance can't be counted until you tell what work was done today and how many people worked.");
        expect(text).toContain('Work told — Weeding');
        expect(text).toContain('Tell how many people worked');
        expect(text).not.toMatch(/[ऀ-ॿ]/);
    });
});
