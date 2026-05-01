// Sub-plan 04 Task 9: AgriSyncClient decomposition — admin ops surface.
// Behavior identical to original.

import type { AdminOpsHealthDto } from '../dtos';
import type { HttpTransport } from '../transport';

export async function getAdminOpsHealth(t: HttpTransport): Promise<AdminOpsHealthDto> {
    const response = await t.http.get<AdminOpsHealthDto>('/shramsafal/admin/ops/health');
    return response.data;
}
