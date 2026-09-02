// Labour V2 R1 Task 3.4b — the Labour-owned result surface.
// @vitest-environment jsdom
//
// Testing-library DOM render, the LabourHub.test.tsx idiom (pragma + jest-dom
// + explicit afterEach(cleanup): vitest runs without globals, so RTL's
// auto-cleanup never registers itself).
//
// Labour events are written lowercase ('hired') — the parser's real output —
// via `as unknown as`, the cast idiom attendanceDisagreement.test.ts and
// labour-log-intent.test.tsx already use for the same reason: the domain type
// says 'HIRED' and a direct `as` is a TS2352.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AttendanceResult from '../AttendanceResult';
import type { AgriLogResponse } from '../../../../types';
import type { LabourAnchor } from '../../labourAnchor';

afterEach(cleanup);

const base: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
};
const anchor = { state: 'anchored', headcount: 12, logId: 'log-1' } as const;

function drawWithAnchor(a: LabourAnchor, labour: AgriLogResponse['labour'], onConfirm = vi.fn()) {
    render(<AttendanceResult
        draft={{ ...base, labour }} anchor={a} farmId={undefined}
        onConfirm={onConfirm} renderEditSurface={() => <div data-testid="edit-surface" />}
        onSpeakMore={vi.fn()} />);
    return onConfirm;
}

function draw(labour: AgriLogResponse['labour'], onConfirm = vi.fn()) {
    return drawWithAnchor(anchor, labour, onConfirm);
}

describe('AttendanceResult — the Task 1.1 panel-2 screen', () => {
    it('rung 2: shows the WHO question with the known count; never re-asks plot/crop/work', () => {
        draw([{ id: 'l1', type: 'hired', count: 12 } as unknown as AgriLogResponse['labour'][number]]);
        expect(screen.getByText('या 12 जणांमध्ये कोण होते?')).toBeInTheDocument();
        expect(screen.getByText('"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.')).toBeInTheDocument();
    });
    it('rung 3: only the remainder question', () => {
        draw([{ id: 'l1', type: 'hired', count: 12, workerNames: ['गणेश', 'शंकर'] } as unknown as AgriLogResponse['labour'][number]]);
        expect(screen.getByText('यांच्याशिवाय अजून कोण होते?')).toBeInTheDocument();
    });
    it('nothing is saved until बरोबर; बरोबर saves exactly once', () => {
        const onConfirm = draw([{ id: 'l1', type: 'hired', count: 2, workerNames: ['गणेश', 'शंकर'] } as unknown as AgriLogResponse['labour'][number]]);
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'बरोबर' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    it('D9.5: sourceText and the reading are BOTH visible inside the confirm — no separate question', () => {
        draw([{ id: 'l1', type: 'hired', count: 9, workerNames: ['शंकर'],
            sourceText: 'शंकर आठ जण घेऊन आला',
            systemInterpretation: 'Shankar + 8 = 9' } as unknown as AgriLogResponse['labour'][number]]);
        expect(screen.getByText(/शंकर आठ जण घेऊन आला/)).toBeInTheDocument();
        expect(screen.getByText(/Shankar \+ 8 = 9/)).toBeInTheDocument();
        expect(screen.queryByText('एक गोष्ट स्पष्ट करा')).toBeNull();
    });
    it('headcount disagreement renders BOTH numbers and still settles at बरोबर/बदल करा', () => {
        draw([{ id: 'l1', type: 'hired', count: 10 } as unknown as AgriLogResponse['labour'][number]]);
        const card = screen.getByTestId('headcount-disagreement');
        expect(card.textContent).toContain('12');
        expect(card.textContent).toContain('10');
        expect(screen.getByRole('button', { name: 'बरोबर' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'बदल करा' })).toBeInTheDocument();
    });
    it('B001: anchored 0 with names spoken shows the conflict card — never a bare one-tap confirm', () => {
        // The anchor says nobody worked; the farmer names two people. Both
        // statements must be visible; the plain confirm (no conflict card)
        // must NOT render. Ruled at the 3.2/3.3 reviews: 0-vs-names is
        // 12-vs-10 at the extreme, same surface, never silent.
        drawWithAnchor({ state: 'anchored', headcount: 0, logId: 'log-0' }, [
            { id: 'l1', type: 'hired', workerNames: ['गणेश', 'रमेश'] } as unknown as AgriLogResponse['labour'][number],
        ]);
        expect(screen.getByTestId('headcount-disagreement')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'बरोबर' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'बदल करा' })).toBeInTheDocument();
    });
    it('state D: the contradiction card with the approved copy, answered by the two facts', () => {
        draw([
            { id: 'a', type: 'hired', count: 2, workerNames: ['गणेश'], shiftId: 'full' } as unknown as AgriLogResponse['labour'][number],
            { id: 'b', type: 'hired', workerNames: ['गणेश'], shiftId: 'half' } as unknown as AgriLogResponse['labour'][number],
        ]);
        expect(screen.getByText('एक गोष्ट स्पष्ट करा')).toBeInTheDocument();
        expect(screen.getByText('गणेश आज दोन कामांत दिसतोय — एकात पूर्ण, दुसऱ्यात अर्धा. आजची हजेरी कोणती?')).toBeInTheDocument();
        expect(screen.getByText('एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'पूर्ण' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'अर्धा' })).toBeInTheDocument();
    });
    it('बदल करा switches to the edit surface', () => {
        draw([{ id: 'l1', type: 'hired', count: 2, workerNames: ['गणेश', 'शंकर'] } as unknown as AgriLogResponse['labour'][number]]);
        fireEvent.click(screen.getByRole('button', { name: 'बदल करा' }));
        expect(screen.getByTestId('edit-surface')).toBeInTheDocument();
    });
});

// ─── Implementer additions (carried 3.3-review MINOR + gate behaviour) ──────
describe('AttendanceResult — display dedup and the contradiction gate', () => {
    it('a duplicated parse name renders as ONE chip (dedup for display, the 3.3-review carry)', () => {
        draw([
            { id: 'a', type: 'hired', count: 2, workerNames: ['गणेश'] } as unknown as AgriLogResponse['labour'][number],
            { id: 'b', type: 'hired', workerNames: ['गणेश'] } as unknown as AgriLogResponse['labour'][number],
        ]);
        expect(screen.getAllByText('गणेश')).toHaveLength(1);
    });
    it('बरोबर is disabled while a contradiction stands, and enables once it is answered', () => {
        const onConfirm = draw([
            { id: 'a', type: 'hired', count: 2, workerNames: ['गणेश'], shiftId: 'full' } as unknown as AgriLogResponse['labour'][number],
            { id: 'b', type: 'hired', workerNames: ['गणेश'], shiftId: 'half' } as unknown as AgriLogResponse['labour'][number],
        ]);
        const confirm = screen.getByRole('button', { name: 'बरोबर' });
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'पूर्ण' }));
        expect(screen.queryByText('एक गोष्ट स्पष्ट करा')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'बरोबर' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

// ─── 3.4b review finding 9 (P7): the count chip attributes its real source ──
describe('AttendanceResult — count attribution reflects its source', () => {
    it('anchored 0 with names: the count chip is स्पष्ट माहिती, never तुम्ही सांगितलं', () => {
        drawWithAnchor({ state: 'anchored', headcount: 0, logId: 'log-0' }, [
            { id: 'l1', type: 'hired', workerNames: ['गणेश', 'रमेश'] } as unknown as AgriLogResponse['labour'][number],
        ]);
        // Nothing was spoken as a COUNT this session — the 0 is the anchor
        // log's figure, so crediting it to the farmer would fabricate a
        // statement. (The conflict card's "तुम्ही सांगितलं: गणेश, रमेश." is a
        // longer string; this EXACT match targets only the bare chip label.)
        expect(screen.queryByText('तुम्ही सांगितलं')).toBeNull();
        expect(screen.getByText('स्पष्ट माहिती')).toBeInTheDocument();
    });
    it('a spoken count still carries the तुम्ही सांगितलं chip', () => {
        draw([{ id: 'l1', type: 'hired', count: 12 } as unknown as AgriLogResponse['labour'][number]]);
        expect(screen.getByText('तुम्ही सांगितलं')).toBeInTheDocument();
        expect(screen.queryByText('स्पष्ट माहिती')).toBeNull();
    });
});
