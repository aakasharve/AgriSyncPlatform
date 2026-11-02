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

export async function createJobCard(req: CreateJobCardRequest): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
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

async function refusalCodeOf(res: Response): Promise<string | null> {
    try {
        const body = (await res.json()) as { error?: unknown } | null;
        return typeof body?.error === 'string' ? body.error : null;
    } catch {
        return null; // a body that is not JSON (a bare 403): no code to read
    }
}

export async function assignJobCard(id: string, req: AssignWorkerRequest): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/assign`;
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
    return res.json() as Promise<JobCard>;
}

export async function startJobCard(id: string): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/start`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!res.ok) throw new Error(`startJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
}

export async function completeJobCard(id: string, req: CompleteJobCardRequest): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/complete`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`completeJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
}

export async function verifyForPayout(id: string): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/verify-for-payout`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!res.ok) throw new Error(`verifyForPayout failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
}

export async function settleJobCard(id: string, req: SettleJobCardRequest): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/settle`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`settleJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
}

export async function cancelJobCard(id: string, req: CancelJobCardRequest): Promise<JobCard> {
    const url = `${resolveBaseUrl()}/job-cards/${id}/cancel`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`cancelJobCard failed: ${res.status}`);
    return res.json() as Promise<JobCard>;
}

export async function getFarmJobCards(
    farmId: string,
    status?: string,
): Promise<JobCard[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    const url = `${resolveBaseUrl()}/farms/${farmId}/job-cards${qs ? `?${qs}` : ''}`;
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
    const url = `${resolveBaseUrl()}/workers/${userId}/job-cards${farmId ? `?farmId=${encodeURIComponent(farmId)}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    // TASK 8 — same fabrication as `getFarmJobCards` above; see the note there.
    if (!res.ok) throw new Error(`getWorkerJobCards failed: ${res.status}`);
    return res.json() as Promise<JobCard[]>;
}

export async function getWorkerProfile(
    userId: string,
    farmId: string,
): Promise<WorkerProfileData> {
    const url = `${resolveBaseUrl()}/workers/${userId}/profile?farmId=${farmId}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`getWorkerProfile failed: ${res.status}`);
    return res.json() as Promise<WorkerProfileData>;
}
