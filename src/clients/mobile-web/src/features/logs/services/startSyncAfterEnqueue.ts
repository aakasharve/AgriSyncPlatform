/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 3) — what `enqueueLogsForSync` does with the sync once the logs are queued.
 *
 * A hand-filled save waits for the cycle (`awaitSync`, the default and what every caller did before). The voice
 * auto-save does not: its result screen is shown from the parse the moment the logs are queued (fast, local), and the
 * sync is only STARTED. The cycle is push + pull + AI-job worker — seconds on a good line, far longer on a weak one,
 * and queued behind any cycle already running — and the farmer waited for all of it before seeing what he had said.
 *
 * Started and not awaited, a sync that fails must still never be lost silently NOR thrown into the save (the log is
 * already on the phone and queued; the next cycle retries it): it is logged.
 */
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { logger } from '../../../infrastructure/observability/Logger';

export async function startSyncAfterEnqueue(awaitSync: boolean): Promise<void> {
    if (awaitSync) {
        await backgroundSyncWorker.triggerNow();
        return;
    }
    try {
        void Promise.resolve(backgroundSyncWorker.triggerNow()).catch(error => {
            logger.warn('voice save: the sync started after the save did not finish (the queue keeps the logs)', { error: String(error) });
        });
    } catch (error) {
        logger.warn('voice save: the sync could not be started after the save (the queue keeps the logs)', { error: String(error) });
    }
}
