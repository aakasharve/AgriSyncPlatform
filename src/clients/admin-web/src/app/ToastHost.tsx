/**
 * ToastHost — THE SLOT, AND NOTHING ELSE.
 *
 * Preservation Register B15. The console has no write surface today: no
 * export, no retry-a-failed-call, no mark-error-resolved, no add-admin, no
 * row action. Every one of those is a separate plan with its own spec, and
 * building the affordances before the endpoints exist would re-ship the exact
 * lie the v3 redesign exists to remove. So this file deliberately carries no
 * queue, no store, no `toast()` function and no timers — there is nothing for
 * them to announce yet, and a queue with zero producers is dead code that
 * gets deleted and then reinvented.
 *
 * ── Why mount an empty region at all ──────────────────────────────────────
 * This is not a placeholder. An `aria-live` region must already be in the DOM
 * when its first message is inserted; a region that arrives together with its
 * text is not reliably announced by screen readers, because the assistive
 * technology has nothing subscribed to observe. Mounting the empty host at
 * shell level is therefore the correct implementation of a live region, not a
 * stub of one — the first write surface inserts a child and it is announced.
 *
 * ── The contract for whoever lands the first toast ────────────────────────
 *  - Children go in here; the host owns position, stacking and spacing only.
 *  - `pointer-events-none` on the host with `pointer-events-auto` on each
 *    toast, so an empty host can never swallow a click on the page beneath.
 *  - `empty:hidden` so a host with no toasts occupies no space and casts no
 *    shadow over the layout.
 *  - Politeness stays `polite`. An `assertive` region interrupts whatever the
 *    reader is saying; a save confirmation does not earn that.
 */
export function ToastHost() {
  return (
    <div
      data-toast-host=""
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 empty:hidden"
    />
  );
}
