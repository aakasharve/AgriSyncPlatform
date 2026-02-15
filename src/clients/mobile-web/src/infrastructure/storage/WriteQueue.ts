/**
 * WriteQueue - Single-Writer Queue for Atomic Storage Operations
 *
 * Prevents concurrent localStorage writes that could cause corruption.
 * All write operations are serialized through this queue.
 *
 * Key guarantees:
 * - Operations execute sequentially (single-writer)
 * - No interleaving of read-modify-write cycles
 * - Failed operations don't block subsequent operations
 * - Caller awaits their operation's completion
 *
 * @module infrastructure/storage/WriteQueue
 */

type WriteOperation<T = void> = () => Promise<T>;

interface QueuedOperation<T = void> {
    operation: WriteOperation<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

/**
 * Single-writer queue that serializes all storage write operations.
 *
 * Usage:
 * ```typescript
 * const queue = WriteQueue.getInstance();
 * await queue.enqueue(async () => {
 *     const data = localStorage.getItem('key');
 *     const parsed = JSON.parse(data);
 *     parsed.newField = 'value';
 *     localStorage.setItem('key', JSON.stringify(parsed));
 * });
 * ```
 */
export class WriteQueue {
    private static instance: WriteQueue;
    private queue: QueuedOperation<unknown>[] = [];
    private isProcessing = false;

    private constructor() {}

    /**
     * Get the singleton WriteQueue instance.
     */
    static getInstance(): WriteQueue {
        if (!WriteQueue.instance) {
            WriteQueue.instance = new WriteQueue();
        }
        return WriteQueue.instance;
    }

    /**
     * Reset the singleton instance (for testing only).
     * @internal
     */
    static resetInstance(): void {
        WriteQueue.instance = undefined as unknown as WriteQueue;
    }

    /**
     * Enqueue a write operation for sequential execution.
     *
     * @param operation - Async function performing the write
     * @returns Promise that resolves when the operation completes
     * @throws Re-throws any error from the operation
     *
     * @example
     * ```typescript
     * await queue.enqueue(async () => {
     *     // Read-modify-write is safe here
     *     const logs = await readLogs();
     *     logs.push(newLog);
     *     await writeLogs(logs);
     * });
     * ```
     */
    async enqueue<T>(operation: WriteOperation<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                operation: operation as WriteOperation<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this.processQueue();
        });
    }

    /**
     * Process queued operations sequentially.
     * Only one operation runs at a time.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (!item) continue;

            try {
                const result = await item.operation();
                item.resolve(result);
            } catch (error) {
                item.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }

        this.isProcessing = false;
    }

    /**
     * Get the current queue length (for monitoring/debugging).
     */
    get queueLength(): number {
        return this.queue.length;
    }

    /**
     * Check if the queue is currently processing.
     */
    get processing(): boolean {
        return this.isProcessing;
    }
}

/**
 * Convenience function to enqueue a write operation.
 *
 * @param operation - Async function performing the write
 * @returns Promise that resolves when the operation completes
 */
export async function enqueueWrite<T>(operation: WriteOperation<T>): Promise<T> {
    return WriteQueue.getInstance().enqueue(operation);
}
