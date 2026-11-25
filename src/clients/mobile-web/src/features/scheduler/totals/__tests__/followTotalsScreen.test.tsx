// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; P4) - "कोणाची पद्धत फॉलो होते": the numbers drawn are the server's answer exactly; a null number says
 * fewer than five farmers stand behind it (NoEvidence_NoNumber); a sample and an own schedule draw no number; a work line only for works the server listed; done and heard
 * on their own lines; the kept answer shows with no signal; English mode has no Marathi.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const language = { current: 'mr' as 'mr' | 'en' };
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { FollowTotalsScreen } from '../FollowTotalsScreen';
import { loadScheduleTotals } from '../scheduleTotalsStore';
import type { DayCardsLoad } from '../../dayCards/dayCardsStore';
import { FULL_ANSWER, NULL_ANSWER, OWN_ANSWER, SAMPLE_ANSWER, SCHED_A, SCHED_B, json, setOnline } from './totalsFixtures';

const detail = (name: string, kind: 'reference' | 'own' = 'reference') => ({
    templateId: SCHED_A, chainId: null, version: 1, contentHash: 'h', kind, name, cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'ICAR-NRCG ची प्रकाशनं' }, check: { state: 'NotChecked', isChecked: false, checkedBy: null, checkedAtUtc: null },
    stages: [], tasks: [], challenges: [], skipped: 0,
});
const details = (kind: 'reference' | 'own' = 'reference') => async (id: string): Promise<DayCardsLoad> => ({ ok: true, detail: { ...detail(id === SCHED_A ? 'द्राक्ष — फळछाटणी' : 'द्राक्ष दुसरं', kind), templateId: id } as never, source: 'phone', stale: false });
const answers = (map: Record<string, unknown>) => (id: string) => loadScheduleTotals(id, json(200, map[id]));
const draw = (map: Record<string, unknown>, schedules: Array<{ templateId: string; sourceLabel?: string | null }> = [{ templateId: SCHED_A, sourceLabel: 'ICAR-NRCG ची प्रकाशनं' }], loadDetail = details()) =>
    render(<FollowTotalsScreen schedules={schedules} onClose={() => undefined} loadTotals={answers(map)} loadDetail={loadDetail} />);

beforeEach(async () => { language.current = 'mr'; setOnline(true); await getDatabase().referenceData.clear(); });
afterEach(() => cleanup());

describe('the follow totals screen (Marathi)', () => {
    it('starts with the title and the rule, then the maker note with the source as TEXT', async () => {
        draw({ [SCHED_A]: FULL_ANSWER });
        expect(screen.getByTestId('totals-title')).toHaveTextContent('कोणाची पद्धत फॉलो होते');
        expect(screen.getByTestId('totals-rule')).toHaveTextContent('फॉलो = शेतकऱ्याने ते काम स्वतःच्या शेड्यूलमध्ये घेतलं. "काम झालं" हे वेगळं मोजलं जातं.');
        expect(await screen.findByTestId(`totals-made-${SCHED_A}`)).toHaveTextContent('बनवणारे: श्रमसफल. स्रोत: ICAR-NRCG ची प्रकाशनं. हे श्रेय ICAR-NRCG ची प्रकाशनं च्या नावावर जात नाही.');
        expect(document.querySelectorAll('img').length).toBe(0);
    });

    it('Totals_EqualServerAnswer: every number drawn is the one the server sent', async () => {
        draw({ [SCHED_A]: FULL_ANSWER });
        expect(await screen.findByTestId(`totals-following-${SCHED_A}`)).toHaveTextContent('३७ / ५२ शेतकरी फॉलो करतात');
        expect(screen.getByTestId(`totals-works-taken-${SCHED_A}`)).toHaveTextContent('११ / २४ कामं घेतली (४६%)');
        const lines = within(screen.getByTestId(`totals-work-list-${SCHED_A}`)).getAllByRole('listitem').map(li => li.textContent);
        expect(lines).toEqual(['Bud spray — २९ शेतकरी', 'Drip irrigation — ८ शेतकरी']);
        expect(screen.getByTestId(`totals-done-${SCHED_A}`)).toHaveTextContent('१९');
        expect(screen.getByTestId(`totals-heard-${SCHED_A}`)).toHaveTextContent('१४');
        const digits = (screen.getByTestId(`totals-card-${SCHED_A}`).textContent ?? '').match(/[०-९]+/g) ?? [];
        expect(new Set(digits)).toEqual(new Set(['३७', '५२', '११', '२४', '४६', '२९', '८', '१९', '१४']));
    });

    it('done and heard stand on their own lines, apart from following', async () => {
        draw({ [SCHED_A]: FULL_ANSWER });
        const following = await screen.findByTestId(`totals-following-${SCHED_A}`);
        const done = screen.getByTestId(`totals-done-${SCHED_A}`);
        const heard = screen.getByTestId(`totals-heard-${SCHED_A}`);
        expect(done).not.toBe(following); expect(heard).not.toBe(following); expect(done).not.toBe(heard);
        expect(following.textContent).not.toContain('१९'); expect(following.textContent).not.toContain('१४');
        expect(done).toHaveTextContent('काम झालं');
        expect(done.textContent).not.toContain('३७');
    });

    it('NoEvidence_NoNumber: a null says in words that fewer than five farmers are behind it, and no digit is drawn', async () => {
        draw({ [SCHED_B]: NULL_ANSWER }, [{ templateId: SCHED_B, sourceLabel: 'ICAR-NRCG ची प्रकाशनं' }]);
        const card = await screen.findByTestId(`totals-card-${SCHED_B}`);
        await waitFor(() => expect(within(card).getByTestId(`totals-following-${SCHED_B}`)).toBeInTheDocument());
        const sentence = 'पाचपेक्षा कमी शेतकऱ्यांमागे असलेला आकडा दाखवला जात नाही.';
        expect(within(card).getByTestId(`totals-following-${SCHED_B}`)).toHaveTextContent(sentence);
        expect(within(card).getByTestId(`totals-done-${SCHED_B}`)).toHaveTextContent(sentence);
        expect(within(card).getByTestId(`totals-heard-${SCHED_B}`)).toHaveTextContent(sentence);
        expect(within(card).queryByTestId(`totals-works-taken-${SCHED_B}`)).toBeNull();
        expect(within(card).queryByTestId(`totals-work-list-${SCHED_B}`)).toBeNull();
        expect(within(card).getByTestId(`totals-following-${SCHED_B}`).textContent).not.toMatch(/[0-9०-९]/);
        expect(within(card).getByTestId(`totals-done-${SCHED_B}`).textContent).not.toMatch(/[0-9०-९]/);
        expect(card.textContent).not.toMatch(/[0-9०-९]/);
    });

    it('only the part the server sent: having without following draws the having part and the sentence for the other', async () => {
        draw({ [SCHED_A]: { ...FULL_ANSWER, following: null, worksTaken: null, worksTakenPercent: null, works: [] } });
        const f = await screen.findByTestId(`totals-following-${SCHED_A}`);
        expect(f).toHaveTextContent('५२');
        expect(f).toHaveTextContent('पाचपेक्षा कमी शेतकऱ्यांमागे असलेला आकडा दाखवला जात नाही.');
        expect(f.textContent).not.toContain('३७');
    });

    it('a sample says it is a sample and draws no number; an own schedule says it has no totals', async () => {
        draw({ [SCHED_A]: SAMPLE_ANSWER, [SCHED_B]: OWN_ANSWER }, [{ templateId: SCHED_A }, { templateId: SCHED_B }]);
        expect(await screen.findByTestId(`totals-sample-${SCHED_A}`)).toHaveTextContent('नमुना');
        expect(await screen.findByTestId(`totals-own-${SCHED_B}`)).toHaveTextContent('स्वतःचं शेड्यूल');
        for (const id of [SCHED_A, SCHED_B]) {
            const card = screen.getByTestId(`totals-card-${id}`);
            expect(within(card).queryByTestId(`totals-following-${id}`)).toBeNull();
            expect(card.textContent ?? '').not.toMatch(/[0-9०-९]/);
        }
    });

    it('a work line appears only for works the server listed', async () => {
        draw({ [SCHED_A]: { ...FULL_ANSWER, works: [{ taskKey: 'only', name: 'Only work', farmers: 6 }] } });
        const list = await screen.findByTestId(`totals-work-list-${SCHED_A}`);
        expect(within(list).getAllByRole('listitem')).toHaveLength(1);
        expect(list).toHaveTextContent('Only work — ६ शेतकरी');
    });

    it('offline: the kept answer shows with the words that it is the last one seen with signal, and no date', async () => {
        await loadScheduleTotals(SCHED_A, json(200, FULL_ANSWER));
        setOnline(false);
        render(<FollowTotalsScreen schedules={[{ templateId: SCHED_A }]} onClose={() => undefined} loadDetail={details()} />);
        expect(await screen.findByTestId(`totals-following-${SCHED_A}`)).toHaveTextContent('३७ / ५२ शेतकरी फॉलो करतात');
        expect(screen.getByTestId(`totals-last-seen-${SCHED_A}`)).toHaveTextContent('इंटरनेट असताना शेवटी पाहिलेले');
        expect(screen.getByTestId(`totals-card-${SCHED_A}`).textContent ?? '').not.toMatch(/20\d\d/);
    });

    it('offline with no kept answer: nothing is drawn, and it says so', async () => {
        setOnline(false);
        render(<FollowTotalsScreen schedules={[{ templateId: SCHED_A }]} onClose={() => undefined} loadDetail={details()} />);
        expect(await screen.findByTestId(`totals-none-${SCHED_A}`)).toHaveTextContent('आकडे दाखवले जात नाहीत');
        expect(screen.queryByTestId(`totals-following-${SCHED_A}`)).toBeNull();
        expect(screen.getByTestId(`totals-card-${SCHED_A}`).textContent ?? '').not.toMatch(/[0-9०-९]/);
    });
});

describe('the follow totals screen (English)', () => {
    it('has no Marathi at all and no Devanagari digits', async () => {
        language.current = 'en';
        const detailEn = async (id: string): Promise<DayCardsLoad> => ({ ok: true, detail: { ...detail('Grapes - Pruning to Pruning'), madeBy: { ownerType: 'INSTITUTION', label: 'ICAR-NRCG publications' }, templateId: id } as never, source: 'phone', stale: false });
        draw({ [SCHED_A]: FULL_ANSWER, [SCHED_B]: NULL_ANSWER }, [{ templateId: SCHED_A, sourceLabel: 'ICAR-NRCG publications' }, { templateId: SCHED_B, sourceLabel: 'ICAR-NRCG publications' }], detailEn);
        await screen.findByTestId(`totals-following-${SCHED_A}`);
        await screen.findByTestId(`totals-following-${SCHED_B}`);
        expect(screen.getByTestId('follow-totals-screen').textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId(`totals-following-${SCHED_A}`)).toHaveTextContent('37 / 52 farmers follow it');
        expect(screen.getByTestId(`totals-works-taken-${SCHED_A}`)).toHaveTextContent('11 / 24 works taken (46%)');
        expect(screen.getByTestId(`totals-following-${SCHED_B}`)).toHaveTextContent('Fewer than five farmers');
    });
});
