import type { AttachmentRecord } from '../storage/DexieDatabase';
import { mutationQueue } from './MutationQueue';
import { SyncMutationName } from './SyncMutationCatalog';

export function createAttachmentClientRequestId(attachmentId: string): string {
    return `${SyncMutationName.CreateAttachment}:${attachmentId}`;
}

export async function enqueueCreateAttachmentMutation(attachment: AttachmentRecord): Promise<string> {
    const clientRequestId = createAttachmentClientRequestId(attachment.id);
    return mutationQueue.enqueue(
        SyncMutationName.CreateAttachment,
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
