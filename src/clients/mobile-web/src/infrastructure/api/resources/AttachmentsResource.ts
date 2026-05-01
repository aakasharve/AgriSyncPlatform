// Sub-plan 04 Task 9: AgriSyncClient decomposition — attachments.
// Behavior identical to original AgriSyncClient methods.

import type {
    AttachmentDto,
    CreateAttachmentRequest,
    CreateAttachmentResponse,
} from '../dtos';
import type { HttpTransport } from '../transport';

export async function createAttachment(
    t: HttpTransport,
    request: CreateAttachmentRequest,
): Promise<CreateAttachmentResponse> {
    const response = await t.http.post<CreateAttachmentResponse>('/shramsafal/attachments', request);
    return response.data;
}

export async function uploadAttachmentFile(
    t: HttpTransport,
    attachmentId: string,
    file: Blob,
    fileName = 'attachment.bin',
    mimeType?: string,
): Promise<void> {
    const payload = mimeType && file.type !== mimeType
        ? new Blob([file], { type: mimeType })
        : file;

    const formData = new FormData();
    formData.append('file', payload, fileName);
    await t.http.post(`/shramsafal/attachments/${encodeURIComponent(attachmentId)}/upload`, formData);
}

export async function getAttachmentMetadata(t: HttpTransport, attachmentId: string): Promise<AttachmentDto> {
    const response = await t.http.get<AttachmentDto>(`/shramsafal/attachments/${encodeURIComponent(attachmentId)}`);
    return response.data;
}

export function getAttachmentDownloadUrl(t: HttpTransport, attachmentId: string): string {
    const path = `/shramsafal/attachments/${encodeURIComponent(attachmentId)}/download`;
    const baseUrl = t.http.defaults.baseURL?.trim();

    if (!baseUrl) {
        return path;
    }

    return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export async function listAttachments(
    t: HttpTransport,
    entityId: string,
    entityType: string,
): Promise<AttachmentDto[]> {
    const response = await t.http.get<AttachmentDto[]>('/shramsafal/attachments', {
        params: { entityId, entityType },
    });
    return response.data;
}
