/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one place the app's language union is declared.
 *
 * It used to live in `translations.ts`. That file is now composed from several
 * section modules (see `dfesTranslations.ts`), and every one of them needs this
 * type — so leaving it in `translations.ts` would have made each section import
 * from the file that imports it. A leaf with no imports of its own breaks that
 * cycle by construction rather than by import ordering.
 *
 * `translations.ts` re-exports it, so the ~40 existing
 * `import { Language } from '.../translations'` call sites are untouched.
 */
export type Language = 'en' | 'mr';
