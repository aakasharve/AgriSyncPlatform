/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - test helper only.
 * The शेड्यूल tab now draws most of its content inside closed rows (`ScheduleFold`). The older tests of that content assert what is INSIDE a row, not that
 * the row is closed, so they call `autoOpenFolds()` after rendering: every row that is drawn closed (also after a view change) is tapped open once.
 * The closed-by-default behaviour itself is asserted in `ScheduleFolds.test.tsx`, which does not use this.
 */
import { act } from '@testing-library/react';

let current: MutationObserver | null = null;

function openAll(): void {
    const closed = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid^="fold-"][data-open="no"] > button'));
    if (closed.length === 0) return;
    act(() => { closed.forEach(b => b.click()); });
}

export function autoOpenFolds(): void {
    current?.disconnect();
    openAll();
    current = new MutationObserver(() => { openAll(); });
    current.observe(document.body, { childList: true, subtree: true });
}
