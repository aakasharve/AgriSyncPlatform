/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43, doctrine P11) — comparing app versions.
 *
 * Numeric, part by part: 1.0.10 is NEWER than 1.0.9 (a text compare gets that wrong). A missing part
 * counts as 0 (1.0 = 1.0.0). Anything that is not 1 to 4 groups of digits is MALFORMED and never
 * produces a prompt: a garbled answer from the server must not tell a farmer to update.
 * The server applies the same shape (`AppReleaseAnswer` in AgriSync.Bootstrapper).
 */

const VERSION_SHAPE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

/** The numeric parts of a version, or null when it is not a version like 1.0.18. */
export function parseVersion(value: unknown): number[] | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!VERSION_SHAPE.test(text)) return null;
    return text.split('.').map(part => Number.parseInt(part, 10));
}

/** -1 / 0 / 1, or null when either side is malformed. */
export function compareVersions(left: unknown, right: unknown): -1 | 0 | 1 | null {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

/** True only when BOTH are well-formed and `candidate` is strictly newer than `installed`. */
export function isNewerVersion(candidate: unknown, installed: unknown): boolean {
    return compareVersions(candidate, installed) === 1;
}
