// Sub-plan 04 Task 9: AgriSyncClient decomposition — export endpoints.
// Behavior identical to original.

import type { HttpTransport } from '../transport';

export async function exportDailySummary(t: HttpTransport, farmId: string, date: string): Promise<Blob> {
    const response = await t.http.get<Blob>('/shramsafal/export/daily-summary', {
        params: { farmId, date },
        responseType: 'blob',
    });
    return response.data;
}

export async function exportMonthlyCost(
    t: HttpTransport,
    farmId: string,
    year: number,
    month: number,
): Promise<Blob> {
    const response = await t.http.get<Blob>('/shramsafal/export/monthly-cost', {
        params: { farmId, year, month },
        responseType: 'blob',
    });
    return response.data;
}

export async function exportVerificationReport(
    t: HttpTransport,
    farmId: string,
    fromDate: string,
    toDate: string,
): Promise<Blob> {
    const response = await t.http.get<Blob>('/shramsafal/export/verification', {
        params: { farmId, fromDate, toDate },
        responseType: 'blob',
    });
    return response.data;
}
