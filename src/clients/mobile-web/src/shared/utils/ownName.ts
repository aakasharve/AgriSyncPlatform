/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; founder 2026-11-06 "real name, never तुम्ही") - the phone
 * holder's own name from the session profile, for the "who told it" lines of आढावा and the review sheet. The app's placeholder for "no name yet" is
 * not a name: it reads as unknown (the same rule as the result screen's `ownNameOf`).
 */
export const ownNameOf = (name: string | null | undefined): string | undefined => {
    const n = (name ?? '').trim();
    return n && n.toLowerCase() !== 'owner' ? n : undefined;
};
