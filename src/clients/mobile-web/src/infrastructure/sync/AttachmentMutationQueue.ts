import type { AttachmentRecord } from '../storage/DexieDatabase';
import { mutationQueue } from './MutationQueue';

export function createAttachmentClientRequestId(attachmentId: string): string {
    return `create_attachment:${attachmentId}`;
}

export async function enqueueCreateAttachmentMutation(attachment: AttachmentRecord): Promise<string> {
    const clientRequestId = createAttachmentClientRequestId(attachment.id);
    return mutationQueue.enqueue(
        'create_attachment',
        {
            attachmentId: attachment.id,
            farmId: attachment.farmId,
            linkedEntityId: attachment.linkedEntityId ?? attachment.farmId,
            linkedEntityType: attachment.linkedEntityType ?? 'Farm',
            fileName: attachment.originalFileName,
            mimeType: attachment.mimeType,
        },
        {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
}
