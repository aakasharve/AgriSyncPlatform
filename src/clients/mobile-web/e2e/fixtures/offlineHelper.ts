import type { Page } from '@playwright/test';

export async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
}

export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false);
}

export interface QueueSummary {
  /** Every row in the signed-in farmer's `mutationQueue`, by status. */
  byStatus: Record<string, number>;
  total: number;
  /** Rows not yet acknowledged by the server (anything but APPLIED / terminal drops). */
  unacknowledged: number;
}

const ACKNOWLEDGED_OR_TERMINAL = new Set(['APPLIED', 'REJECTED_DROPPED']);

/**
 * Reads the mutation queue straight out of IndexedDB.
 *
 * The header sync chip and its drawer opener were deleted by the oversight
 * rework (spec §4.1; AppHeader.oversight.test.tsx pins that
 * `sync-status-indicator` must NOT return), so an offline-pending record has no
 * UI affordance to open. The queue itself is the evidence the old drawer was
 * rendering, so it is read directly: the same rows, no UI in between.
 *
 * Each farmer has a database of their own (`AgriLogDB_u_<id>`); the queue is
 * summed across every AgriLog database on the origin, which is exactly the one
 * farmer's in these specs.
 */
export async function readMutationQueue(page: Page): Promise<QueueSummary> {
  const raw = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith('AgriLogDB'));
    const byStatus: Record<string, number> = {};
    for (const name of names) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(name);
        req.onerror = () => resolve();
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('mutationQueue')) { db.close(); resolve(); return; }
          const all = db.transaction('mutationQueue', 'readonly').objectStore('mutationQueue').getAll();
          all.onsuccess = () => {
            for (const row of all.result as Array<{ status?: string }>) {
              const status = row.status ?? 'UNKNOWN';
              byStatus[status] = (byStatus[status] ?? 0) + 1;
            }
            db.close();
            resolve();
          };
          all.onerror = () => { db.close(); resolve(); };
        };
      });
    }
    return byStatus;
  });
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const unacknowledged = Object.entries(raw)
    .filter(([status]) => !ACKNOWLEDGED_OR_TERMINAL.has(status))
    .reduce((a, [, n]) => a + n, 0);
  return { byStatus: raw, total, unacknowledged };
}
