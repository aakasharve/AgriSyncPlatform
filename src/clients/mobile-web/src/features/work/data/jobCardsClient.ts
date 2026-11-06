/**
 * jobCardsClient — API client for all job card endpoints.
 * CEI Phase 4 §4.8 Work Trust Ledger
 *
 * @module features/work/data/jobCardsClient
 */

import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { APP_VERSION } from '../../../buildInfo';
import type { JobCard, JobCardLineItem } from '../../../domain/work/JobCard';
import type { WorkerProfileData } from '../../../domain/work/ReliabilityScore';

// ============================================================================
// DTOs
// ============================================================================

export interface CreateJobCardRequest {
    farmId: string;
    plotId: string;
    cropCycleId?: string;
    plannedDate: string;
    lineItems: JobCardLineItem[];
}

export interface AssignWorkerRequest {
    workerUserId: string;
}

export interface CompleteJobCardRequest {
    dailyLogId: string;
}

export interface SettleJobCardRequest {
    actualPayoutAmount: number;
    actualPayoutCurrencyCode: string;
    settlementNote?: string;
}

export interface CancelJobCardRequest {
    reason: string;
}

// ============================================================================
// Helpers
// ============================================================================

interface ViteImportMeta {
    env?: { VITE_AGRISYNC_API_URL?: unknown };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

/**
 * spec: plr-d10 lane F99 fix pass 1 (F100) — every job-card route lives under `/shramsafal` on the server. This client left
 * it out, so each call answered 404 and the work screens had never reached the server (the route table test,
 * `phoneRestPathsMatchServer.test.ts`, now fails on any such path).
 */
const apiBase = (): string => `${resolveBaseUrl()}/shramsafal`;

/**
 * What the server answers to a change of a card (create, assign, start, complete, verify, settle, cancel): the card's id,
 * never the card itself. The screens read the card back from the farm's list (`useJobCards` refreshes after a change).
 */
export interface JobCardChange {
    jobCardId: string;
}

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    // lane MU-3 fix 2 (N1) — the server sends a withheld pay as null (shown "नियमानुसार दिसत नाही") only to a phone
    // that says it is newer than 1.0.17; 1.0.17 sent no version here and is answered the old way, never with ₹0.
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-App-Version': APP_VERSION };
    if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
    return headers;
};

// ============================================================================
// API calls
// ============================================================================

export async function createJobCard(req: CreateJobCardRequest): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCardChange>;
}

/** lane MU-4 fix pass 2 (N4) — the plot rule's refusal code, as the server sends it in a 403's body. */
export const PLOT_SCOPE_REFUSAL = 'ShramSafal.PlotScope.Forbidden';

/** lane MU-4 fix pass 2 (N4) — a refusal the server explained by its code (read from the body of the answer). */
export class JobCardRefusal extends Error {
    constructor(public readonly code: string, status: number) {
        super(`job card refused: ${status} ${code}`);
        this.name = 'JobCardRefusal';
    }
}

/**
 * lane L4b fix round 1 (H-1) — the server answers a role refusal with a bare 403 (no body, `Results.Forbid()`): the
 * client names it with this code so the screen can still say it in his language.
 */
export const FORBIDDEN_WITHOUT_CODE = 'http.403';

async function refusalCodeOf(res: Response): Promise<string | null> {
    try {
        const body = (await res.json()) as { error?: unknown } | null;
        return typeof body?.error === 'string' ? body.error : null;
    } catch {
        return null; // a body that is not JSON (a bare 403): no code to read
    }
}

export async function assignJobCard(id: string, req: AssignWorkerRequest): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/assign`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const code = await refusalCodeOf(res);
        if (code) throw new JobCardRefusal(code, res.status);
        throw new Error(`assignJobCard failed: ${res.status}`);
    }
    return res.json() as Promise<JobCardChange>;
}

export async function startJobCard(id: string): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/start`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!res.ok) throw new Error(`startJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCardChange>;
}

export async function completeJobCard(id: string, req: CompleteJobCardRequest): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/complete`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`completeJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCardChange>;
}

export async function verifyForPayout(id: string): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/verify-for-payout`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!res.ok) {
        // lane L4b fix round 1 (H-1) — a refusal travels by its code, so the card says it in his language.
        const code = await refusalCodeOf(res);
        if (code) throw new JobCardRefusal(code, res.status);
        if (res.status === 403) throw new JobCardRefusal(FORBIDDEN_WITHOUT_CODE, res.status);
        throw new Error(`verifyForPayout failed: ${res.status}`);
    }
    return res.json() as Promise<JobCardChange>;
}

export async function settleJobCard(id: string, req: SettleJobCardRequest): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/settle`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`settleJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCardChange>;
}

export async function cancelJobCard(id: string, req: CancelJobCardRequest): Promise<JobCardChange> {
    const url = `${apiBase()}/job-cards/${id}/cancel`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`cancelJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCardChange>;
}

export async function getFarmJobCards(
    farmId: string,
    status?: string,
): Promise<JobCard[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    const url = `${apiBase()}/farms/${farmId}/job-cards${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    // TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — this
    // was `return []`, and that one line manufactured the lie the whole task
    // exists to remove. A 401/403/500 came back as a RESOLVED promise carrying
    // an empty array, so `useJobCards`'s `try/catch` never fired and the screen
    // reported an HTTP error as the server's own answer: "कोणते काम कार्ड
    // नाही". Absence of any record means UNKNOWN — only the server may say
    // "none", and it says it with a 200 and an empty body (still returned
    // below, still an honest empty). Every sibling in this file already threw;
    // this one and `getWorkerJobCards` were the outliers.
    if (!res.ok) throw new Error(`getFarmJobCards failed: ${res.status}`);
    return res.json() as Promise<JobCard[]>;
}

/**
 * A worker's job cards. lane MU-3 fix 2 — `farmId`: the farm the worker page is about; the server reads that farm's
 * cards under that farm's scope (without it, only a person's OWN list can be read).
 */
export async function getWorkerJobCards(userId: string, farmId?: string): Promise<JobCard[]> {
    const url = `${apiBase()}/workers/${userId}/job-cards${farmId ? `?farmId=${encodeURIComponent(farmId)}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    // TASK 8 — same fabrication as `getFarmJobCards` above; see the note there.
    if (!res.ok) throw new Error(`getWorkerJobCards failed: ${res.status}`);
    return res.json() as Promise<JobCard[]>;
}

export async function getWorkerProfile(
    userId: string,
    farmId: string,
): Promise<WorkerProfileData> {
    const url = `${apiBase()}/workers/${userId}/profile?farmId=${farmId}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`getWorkerProfile failed: ${res.status}`);
    return res.json() as Promise<WorkerProfileData>;
}
