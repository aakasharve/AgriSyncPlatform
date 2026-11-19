/**
 * A fresh page load, inside one test.
 *
 * Some modules remember things for as long as the page lives, and a rule can be about what a
 * NEW page does ("the same id on a fresh page load"). The test command turns each test file,
 * with everything it imports, into one file. Loading that one file a second time under another
 * address makes Node run all of it again, with its own new copy of every module in it: that is a
 * fresh page. What sits on `globalThis` (the pretend browser store) is not copied, exactly as a
 * browser's store outlives a reload.
 *
 * How a test file uses it:
 *
 *   export function loadPage() { return import('@/lib/theModule'); }
 *   if (!isFreshPageCopy(import.meta.url)) { ...the tests... }
 *
 * and inside a test: `const page = await openFreshPage<{ loadPage: typeof loadPage }>(import.meta.url)`.
 */

let pagesOpened = 0;

/** True inside a copy that was loaded as a fresh page. Such a copy must not declare the tests again. */
export function isFreshPageCopy(fileUrl: string): boolean {
  return new URL(fileUrl).searchParams.has('page');
}

/** Loads the test file again as a fresh page and gives back what that copy exports. */
export async function openFreshPage<Page>(fileUrl: string): Promise<Page> {
  pagesOpened += 1;
  const address = new URL(fileUrl);
  address.searchParams.set('page', String(pagesOpened));
  return (await import(address.href)) as Page;
}
