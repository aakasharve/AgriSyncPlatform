// Sub-plan 02 Task 8: canonical payload schema for the create_attachment
// mutation. The shape mirrors the backend handler's allowlist
// (`PushSyncBatchHandler.HandleCreateAttachmentAsync` →
// `CreateAttachmentMutationPayload`) and the client's
// `enqueueCreateAttachmentMutation` factory in
// `infrastructure/sync/AttachmentMutationQueue.ts`.
//
// History: an earlier draft used a forward-looking shape (`ownerType`,
// `ownerId`, `byteLength`, `uploadIntentToken`, `capturedAt`) that no
// producer or consumer actually emitted. That caused
// `MutationQueue.enqueue` to throw the moment a real procurement receipt
// was queued for upload, so the AttachmentUploadWorker would mark the
// upload-queue row for retry and never actually call /attachments/upload
// — breaking spec 04 of the e2e suite. The schema now reflects the wire
// format that is actually in production.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const CreateAttachmentPayload = z.object({
    attachmentId: ZGuid,
    farmId: ZGuid,
    linkedEntityId: ZGuid,
    linkedEntityType: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    createdByUserId: ZGuid.optional(),
});

export type CreateAttachmentPayloadType = z.infer<typeof CreateAttachmentPayload>;
