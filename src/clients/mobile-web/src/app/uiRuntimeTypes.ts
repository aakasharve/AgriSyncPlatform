export interface LastSavedLogSummaryItem {
    logId: string;
    cropId?: string;
    cropName: string;
    plotId?: string;
    plotName: string;
    count: number;
    /**
     * Labour Phase 2 / T2 (review round 1, finding B1) — did THIS log get a
     * sync-queue row?
     *
     * The "Saved to Ledger" success screen (`mainView.tsx:600`) renders one card
     * per entry here and persists until the farmer navigates away, while the
     * toast that carries the sync truth self-destructs after 3000ms
     * (`ActionToast.tsx:16`). Without this field the durable surface can only
     * say "saved", and the reassuring half of the story outlives the honest
     * half. A per-log flag is the only shape that works, because a broadcast can
     * queue one plot and drop another.
     *
     *  - `true`   the log has a `db.mutationQueue` row and is bound for the server.
     *  - `false`  `enqueueLogsForSync` returned it in `skippedLogIds`. It IS in
     *             the local ledger, but no code path will ever send it: the skip
     *             happens before any row is written (`logSyncMutationService.ts:324-327`),
     *             so `BackgroundSyncWorker` has nothing to retry and the sync
     *             drawer has nothing to list.
     *  - `null`   NO CLAIM. No enqueue was attempted (demo mode). Following the
     *             same discipline as `SyncHonestyClaim`: absence of an attempt is
     *             not evidence of either outcome, so it must not be rendered as
     *             one.
     *
     * READER NOT YET WIRED. `mainView.tsx` is `.tsx` and sits behind the L5b UI
     * gate; the render half is batched into the coordinator's L5b run. This
     * field is the data half, and it is asserted by
     * `useLogCommands.saveTruth.test.ts`.
     */
    syncQueued: boolean | null;
}
