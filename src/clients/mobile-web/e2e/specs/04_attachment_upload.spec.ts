/**
 * Spec 04 — Attachment upload state machine (Sub-plan 05 Phase 4A)
 *
 * Verifies that:
 *  1. Navigating to Procurement via the bottom nav works (state-machine routing).
 *  2. Opening the "Scan Receipt" sheet and selecting a file via setInputFiles causes
 *     the attachment to be queued (status = pending) and the queued-banner to appear.
 *  3. The AttachmentUploadWorker (auto-started on login, 10s interval) transitions
 *     the attachment from pending → uploaded in Dexie once the backend processes it.
 *
 * Happy path:
 *  login → procurement-nav-btn → scan-receipt-btn → setInputFiles(1×1 PNG) →
 *  assert attachment-queued-banner visible (pending) →
 *  wait for Dexie attachment.status = 'uploaded' (worker cycle ≤ 30s in CI).
 *
 * AI independence:
 *  The attachment is queued the moment the file is selected — before OCR runs and
 *  independent of whether OCR succeeds. The spec asserts only the upload-state
 *  machine (pending → uploaded); it does NOT assert any OCR result.
 *
 * Concern (see report):
 *  The attachment-queued-banner (pending state) is observable in the UI.
 *  The 'uploaded' state is verified via Dexie inspection (page.evaluate) because
 *  AttachmentList is not rendered within the procurement ReceiptCaptureSheet.
 *  If resolveFarmIdFromSyncState returns null (e.g. sync pull not yet complete),
 *  the banner will not appear — the test will fail with a meaningful timeout rather
 *  than a false positive.
 */

import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';

// Minimal 1×1 transparent PNG — inline base64, no binary file committed.
// Generated from: Buffer containing the canonical 1×1 PNG bytes.
const ONE_PIXEL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function base64ToBuffer(b64: string): Buffer {
    return Buffer.from(b64, 'base64');
}

test.describe('Attachment upload state machine', () => {
    test('selecting a receipt image queues attachment as pending, then worker uploads it', async ({ page }) => {
        await resetAndSeed('ramu');

        // --- Login ---
        await page.goto('/');
        const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone"], input[placeholder*="9999"]').first();
        await phoneInput.waitFor({ timeout: 15_000 });
        await phoneInput.fill('9999999999');

        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.waitFor({ timeout: 10_000 });
        await passwordInput.fill('ramu123');

        await page.getByRole('button', { name: /sign in|login|submit/i }).first().click();

        // Wait for home to load — this also ensures the initial sync pull has run
        // (shramsafal_last_pull_payload is written during pull; farmId will be available).
        await expect(page.getByTestId('home-greeting')).toBeVisible({ timeout: 20_000 });

        // --- Navigate to Procurement via bottom nav (state-machine routing — NOT page.goto) ---
        const procurementNavBtn = page.getByTestId('procurement-nav-btn');
        await expect(procurementNavBtn).toBeVisible({ timeout: 10_000 });
        await procurementNavBtn.click();

        // Assert Procurement page content is visible
        const procurementHeading = page.getByRole('heading', { name: /procurement/i }).first();
        await expect(procurementHeading).toBeVisible({ timeout: 10_000 });

        // --- Open the receipt capture sheet ---
        const scanReceiptBtn = page.getByTestId('scan-receipt-btn');
        await expect(scanReceiptBtn).toBeVisible({ timeout: 10_000 });
        await scanReceiptBtn.click();

        // --- Wait for the hidden file input to be present in DOM ---
        // The input is hidden (className="hidden") but must be in the DOM for setInputFiles.
        const attachmentInput = page.locator('[data-testid="attachment-input"]');
        await attachmentInput.waitFor({ state: 'attached', timeout: 10_000 });

        // --- Inject a 1×1 PNG programmatically (no binary in tree) ---
        const pngBuffer = base64ToBuffer(ONE_PIXEL_PNG_BASE64);
        await attachmentInput.setInputFiles({
            name: 'test-receipt.png',
            mimeType: 'image/png',
            buffer: pngBuffer,
        });

        // --- Assert: queued-banner appears (attachment is pending in Dexie) ---
        // This banner renders when captureAttachment() resolves successfully and
        // attachmentIds state is set. It is independent of OCR results.
        const queuedBanner = page.getByTestId('attachment-queued-banner');
        await expect(queuedBanner).toBeVisible({ timeout: 15_000 });
        await expect(queuedBanner).toContainText(/attachment queued/i);

        // --- Assert: Dexie attachment record shows pending status ---
        // Read the attachment directly from IndexedDB to confirm the DB state.
        const pendingCount = await page.evaluate(async () => {
            // Access Dexie via the global window object exposed by the app bundle.
            // The app opens the DB under the name 'AgriSyncDB'.
            return new Promise<number>((resolve) => {
                const req = indexedDB.open('AgriSyncDB');
                req.onsuccess = () => {
                    const db = req.result;
                    // Gracefully handle DB versions that may not have 'attachments' store
                    if (!db.objectStoreNames.contains('attachments')) {
                        db.close();
                        resolve(0);
                        return;
                    }
                    const tx = db.transaction('attachments', 'readonly');
                    const store = tx.objectStore('attachments');
                    const allReq = store.getAll();
                    allReq.onsuccess = () => {
                        const records = allReq.result as Array<{ status: string }>;
                        const count = records.filter(r => r.status === 'pending').length;
                        db.close();
                        resolve(count);
                    };
                    allReq.onerror = () => { db.close(); resolve(0); };
                };
                req.onerror = () => resolve(0);
            });
        });
        expect(pendingCount).toBeGreaterThan(0);

        // --- Assert: AttachmentUploadWorker transitions status to 'uploaded' ---
        // The worker auto-starts on login (DataSourceProvider) and runs every 10s.
        // In CI with a live backend, the upload should complete within 30s.
        // We poll Dexie directly since AttachmentList is not rendered in this view.
        await expect
            .poll(
                async () => {
                    return page.evaluate(async () => {
                        return new Promise<number>((resolve) => {
                            const req = indexedDB.open('AgriSyncDB');
                            req.onsuccess = () => {
                                const db = req.result;
                                if (!db.objectStoreNames.contains('attachments')) {
                                    db.close();
                                    resolve(0);
                                    return;
                                }
                                const tx = db.transaction('attachments', 'readonly');
                                const store = tx.objectStore('attachments');
                                const allReq = store.getAll();
                                allReq.onsuccess = () => {
                                    const records = allReq.result as Array<{ status: string }>;
                                    const count = records.filter(
                                        r => r.status === 'uploaded' || r.status === 'finalized' || r.status === 'completed',
                                    ).length;
                                    db.close();
                                    resolve(count);
                                };
                                allReq.onerror = () => { db.close(); resolve(0); };
                            };
                            req.onerror = () => resolve(0);
                        });
                    });
                },
                {
                    // Worker interval is 10s; allow 3 cycles + network latency.
                    timeout: 45_000,
                    intervals: [2_000, 5_000, 5_000],
                    message: 'AttachmentUploadWorker did not transition attachment to uploaded within 45s',
                },
            )
            .toBeGreaterThan(0);
    });
});
