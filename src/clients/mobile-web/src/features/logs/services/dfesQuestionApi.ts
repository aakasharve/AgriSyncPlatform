/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionApi — client for the Phase-5 question-engine telemetry endpoints.
 *   POST /shramsafal/question-events        → { id }
 *   GET  /shramsafal/question-events/recent → RecentQuestionEventDto[]
 *
 * spec: dfes-companion-2026-07-11
 */
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import type { SelectedQuestion, RecentQuestionEvent } from './dfesQuestionEngine';
import { BANK_VERSION, QUESTION_ENGINE_VERSION } from './dfesQuestionBank';

interface ViteImportMeta { env?: { VITE_AGRISYNC_API_URL?: unknown }; }

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) return raw.trim().replace(/\/+$/, '');
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) headers['Authorization'] = `Bearer ${session.accessToken}`;
    return headers;
};

export interface RecentQuestionEventDto {
    questionKey: string;
    triggerType: string;
    shownAtUtc: string | null;
    createdAtUtc: string;
    stageConfirmed: boolean | null;
    skipped: boolean | null;
}

/** Response outcome captured after the farmer interacts with (or skips) the question. */
export interface QuestionOutcome {
    response?: string | null;
    stageConfirmed?: boolean | null;
    photoSubmitted?: boolean | null;
    skipped?: boolean | null;
    answerObservationId?: string | null;
    dailyLogId?: string | null;
}

export async function recordQuestionEvent(
    farmId: string, plotId: string | null, selected: SelectedQuestion,
    outcome: QuestionOutcome, shownAtUtc: string,
): Promise<{ id: string }> {
    const q = selected.question;
    const body = {
        farmId, plotId, dailyLogId: outcome.dailyLogId ?? null,
        questionKey: q.questionKey, crop: q.crop,
        expectedStage: selected.expectedStage, actualStageApplicability: selected.actualStageApplicability,
        anchorDateType: q.anchorDateType, triggerType: q.triggerType, questionType: q.questionType, lens: q.lens,
        depthLevel: q.depthLevel, priority: q.priority, cooldown: q.cooldownDays,
        answerModes: q.answerModes, safetyClass: q.safetyClass,
        agronomistApproved: q.agronomistApproved, marathiApproved: q.marathiApproved,
        bankVersion: BANK_VERSION, questionEngineVersion: QUESTION_ENGINE_VERSION,
        answerObservationId: outcome.answerObservationId ?? null, shownAtUtc,
        triggerReason: selected.triggerReason, weatherContext: selected.weatherContext,
        response: outcome.response ?? null, stageConfirmed: outcome.stageConfirmed ?? null,
        photoSubmitted: outcome.photoSubmitted ?? null, skipped: outcome.skipped ?? null,
    };
    const res = await fetch(`${resolveBaseUrl()}/shramsafal/question-events`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`recordQuestionEvent failed: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
}

export async function fetchRecentQuestionEvents(farmId: string, sinceDays = 14): Promise<RecentQuestionEvent[]> {
    const res = await fetch(
        `${resolveBaseUrl()}/shramsafal/question-events/recent?farmId=${encodeURIComponent(farmId)}&sinceDays=${sinceDays}`,
        { headers: authHeaders() });
    if (!res.ok) throw new Error(`fetchRecentQuestionEvents failed: ${res.status}`);
    const dtos = (await res.json()) as RecentQuestionEventDto[];
    const now = Date.now();
    return dtos.map(d => ({
        questionKey: d.questionKey,
        createdAtLocalDate: d.createdAtUtc.slice(0, 10),
        ageDays: Math.floor((now - Date.parse(d.createdAtUtc)) / 86_400_000),
    }));
}
