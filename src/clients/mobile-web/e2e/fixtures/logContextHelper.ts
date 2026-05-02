import { expect, type Page } from '@playwright/test';

export async function selectFarmWideLogContext(page: Page): Promise<void> {
    const farmWideContext = page.getByRole('button', { name: /Entire Farm.*Overview/i }).first();

    await expect(farmWideContext).toBeVisible({ timeout: 15_000 });
    await farmWideContext.click();
    await expect(page.getByTestId('input-method-manual')).toBeVisible({ timeout: 10_000 });
}
