// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A) — test driver, not a test.
//
// Drives the permissions page the way a person does: the page is read to its end (the scroll box given a real size
// and scrolled to the bottom - jsdom lays nothing out, so a box with no height counts as nothing read) and the green
// button is tapped; or "नको" is tapped.

import { fireEvent, screen } from '@testing-library/react';

/** Scrolls the open page to its end (content 2000 px in a 600 px window). */
export async function readPermissionsPageToEnd(): Promise<HTMLElement> {
    const box = await screen.findByTestId('permissions-page-scroll', {}, { timeout: 5000 });
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(box, 'scrollTop', { configurable: true, writable: true, value: 1400 });
    fireEvent.scroll(box);
    return box;
}

/** Reads the page to its end and taps "मी वाचलं, पुढे चला" once. */
export async function acceptPermissionsPage(): Promise<void> {
    await readPermissionsPageToEnd();
    fireEvent.click(screen.getByTestId('permissions-page-go'));
}

/** Taps "नको". */
export async function declinePermissionsPage(): Promise<void> {
    fireEvent.click(await screen.findByTestId('permissions-page-no', {}, { timeout: 5000 }));
}
