/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-3 / H05 / P-1 / MU-21)
 *
 * Which of the three home tabs a person may NOT open, from their role on the CURRENT farm.
 * Founder, 2026-10-25 (PENDING-DECISIONS, answered): "Workers do not see तुलना."
 *
 * The ONE place this rule lives: the page switcher (`AppHeader` → `OversightNavCards`), the swipe between
 * tabs (`MainViewTransition`), the tab render itself (`renderCompareView`) and the लक्ष द्या card buttons all
 * read the list this returns, so a worker cannot reach तुलना by tap, swipe or card.
 *
 * Limits (said plainly, not hidden):
 *   - this only hides the tab. The phone still receives every plot of the farm from sync — plot scope per
 *     person is PLR-D7 (CMP-4), not built here.
 *   - an UNKNOWN role hides nothing (fails open). The role comes from `/me/context`, which is held in memory
 *     only (`MeContextService.ts`, 2-minute cache), so until it answers — the first seconds of a start, or a
 *     whole offline cold start — a worker can still see and open तुलना; the moment the role arrives the
 *     card, the swipe and the tab go and `AppRouter` sends him back to आजची कामे. Failing closed instead
 *     would take तुलना away from every OWNER on every offline start, which is worse for the people it is for.
 *     Closing this needs the role kept on the phone (a PLR-D7 / CMP-4 item).
 */
import type { PageView } from '../../types';

const NONE: readonly PageView[] = Object.freeze([]);
const WORKER_HIDDEN: readonly PageView[] = Object.freeze(['compare'] as PageView[]);

/** `role` is the `/me/context` role name of the current farm seat ("PrimaryOwner", "Mukadam", "Worker", …). */
export function hiddenMainViewsFor(role: string | null | undefined): readonly PageView[] {
    return role === 'Worker' ? WORKER_HIDDEN : NONE;
}
