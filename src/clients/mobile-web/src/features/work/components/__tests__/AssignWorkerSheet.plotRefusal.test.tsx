// @vitest-environment jsdom
/**
 * spec: plr-d10 lane MU-4 fix pass 2 (N4) — the owner gives a task to someone whose plots do not include its plot. The
 * server refuses with the plot rule's code in its 403 body; the phone reads the code (never a bare "403") and the sheet
 * says the rule, in one language at a time. Any other refusal keeps the farmer-words it had.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const lang = vi.hoisted(() => ({ value: 'mr' as string }));
vi.mock('../../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: lang.value }),
}));

import AssignWorkerSheet from '../AssignWorkerSheet';
import { assignJobCard, JobCardRefusal, PLOT_SCOPE_REFUSAL } from '../../data/jobCardsClient';
import type { JobCard } from '../../../../domain/work/JobCard';

const card = { id: 'card-000000000001' } as unknown as JobCard;
const members = [{ userId: 'ramesh', displayName: 'रमेश', role: 'Mukadam' }];

const answer = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); lang.value = 'mr'; });

const tryAssign = async () => {
    render(<AssignWorkerSheet card={card} farmId="farm-1" members={members} onClose={vi.fn()}
        onAssigned={req => assignJobCard(card.id, req).then(() => undefined)} />);
    fireEvent.click(screen.getByText('रमेश'));
    fireEvent.click(screen.getByText('नेमणूक करा'));
};

describe('a task given outside the person\'s plots', () => {
    it('the client reads the plot rule\'s code from the 403 body', async () => {
        answer(403, { error: PLOT_SCOPE_REFUSAL, message: "By ShramSafal's rules this work could not be saved on this plot." });
        await expect(assignJobCard(card.id, { workerUserId: 'ramesh' })).rejects.toBeInstanceOf(JobCardRefusal);
    });

    it('the sheet says the rule in Marathi', async () => {
        answer(403, { error: PLOT_SCOPE_REFUSAL, message: 'x' });
        await tryAssign();
        await waitFor(() => expect(screen.getByText('हा प्लॉट या व्यक्तीच्या प्लॉटमध्ये नाही, म्हणून हे काम त्यांना देता आलं नाही.')).toBeInTheDocument());
    });

    it('and in English, in English only', async () => {
        lang.value = 'en';
        answer(403, { error: PLOT_SCOPE_REFUSAL, message: 'x' });
        await tryAssign();
        await waitFor(() => expect(screen.getByText("This plot is not one of this person's plots, so the task could not be given to them.")).toBeInTheDocument());
    });

    it('any other refusal keeps its farmer-words (a bare 403 reads as permission)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
        await tryAssign();
        await waitFor(() => expect(screen.queryByText(/हा प्लॉट या व्यक्तीच्या/)).toBeNull());
        await waitFor(() => expect(screen.getByText(/काहीतरी चुकलं|परवानगी/)).toBeInTheDocument());
    });
});
