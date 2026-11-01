import type { LogContentPayloadType as LogContentPayload } from '../../../../../../../sync-contract/schemas/payloads/_log_content.zod';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — an edit to what Sathi understood
 * (`revise_log_content.zod.ts`). The server appends it as a NEW record version (the old one stays
 * as history) and a confirmed day re-opens for the owner.
 */
export interface ReviseLogContentPayload {
     /** The pull guard reads this key, so the edited log is left alone until the server accepts it. */
     dailyLogId: string;
     /** The record version the editor saw; an older one is accepted and recorded, never dropped. */
     baseVersion: number;
     content: LogContentPayload;
     reason?: string;
     revisedAtUtc: string;
     /**
      * lane MU-3 fix 1 (F8) — the copy this edit was made on came WITHOUT its amounts (`DailyLog.amountsWithheld`), so
      * the server carries them forward. Decided by what this phone was SENT, never by the seat's switches now.
      */
     amountsWithheld?: boolean;
     /**
      * lane MU-3 fix 2 (N4) — the copy came WITHOUT the record's words (`DailyLog.wordsWithheldForMoney`): the server
      * carries them onto the edit.
      */
     wordsWithheld?: boolean;
}

export class ReviseLogContentCommand {
     /**
      * `changesMoney` (lane OF-M fix pass 1, review 7): this edit changes a priced line — kept on the queue row only (never
      * sent), so आढावा counts the record's money as a gap until the edit is applied.
      */
     static async enqueue(payload: ReviseLogContentPayload, options: { changesMoney?: boolean } = {}): Promise<string> {
          // One id per edit: every edit is its own mutation, deduplicated on replay by this key.
          const clientRequestId = `${SyncMutationName.ReviseLogContent}:${payload.dailyLogId}:${idGenerator.generate()}`;
          return mutationQueue.enqueue(SyncMutationName.ReviseLogContent, payload, {
               clientRequestId,
               clientCommandId: clientRequestId,
               ...(options.changesMoney ? { changesMoney: true } : {}),
          });
     }
}
