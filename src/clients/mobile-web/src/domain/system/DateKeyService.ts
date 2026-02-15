/**
 * DateKeyService: Canonical Date Key Generation for AgriLog
 *
 * CRITICAL: All business date keys in AgriLog MUST use this service.
 *
 * Why this matters:
 * - India Standard Time (IST) is UTC+5:30
 * - Using `.toISOString().split('T')[0]` gives UTC dates
 * - At 1:00 AM IST (which is 7:30 PM previous day UTC), the UTC date is YESTERDAY
 * - This causes logs, tasks, and daily summaries to appear on wrong days
 *
 * This service is the SINGLE SOURCE OF TRUTH for date keys.
 *
 * @example
 * // At 2:00 AM IST on 2026-02-06:
 * new Date().toISOString().split('T')[0]  // "2026-02-05" (WRONG - UTC)
 * getDateKey()                             // "2026-02-06" (CORRECT - IST)
 */

// IST offset in minutes (5 hours 30 minutes)
const IST_OFFSET_MINUTES = 330;

/**
 * Get the canonical date key (YYYY-MM-DD) for a given timestamp in IST timezone.
 *
 * @param timestamp - Optional Date object or ISO string. Defaults to current time.
 * @returns Date key string in YYYY-MM-DD format, based on IST (Asia/Kolkata)
 *
 * @example
 * getDateKey() // "2026-02-06" (today in IST)
 * getDateKey(new Date('2026-02-06T00:30:00Z')) // "2026-02-06" (6:00 AM IST)
 * getDateKey(new Date('2026-02-05T20:00:00Z')) // "2026-02-06" (1:30 AM IST next day)
 */
export function getDateKey(timestamp?: Date | string): string {
    const date = timestamp
        ? (typeof timestamp === 'string' ? new Date(timestamp) : timestamp)
        : new Date();

    if (isNaN(date.getTime())) {
        console.warn('[DateKeyService] Invalid date provided, using current time');
        return getDateKey(new Date());
    }

    // Get IST time by adding the offset to UTC
    const utcMs = date.getTime();
    const istMs = utcMs + (IST_OFFSET_MINUTES * 60 * 1000);
    const istDate = new Date(istMs);

    // Extract date components from the IST-adjusted date
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/**
 * Get the current timestamp in IST as an ISO string.
 * Unlike Date.toISOString() which gives UTC, this gives IST.
 *
 * @returns ISO timestamp string with IST offset (+05:30)
 */
export function getISTTimestamp(timestamp?: Date): string {
    const date = timestamp || new Date();

    // Calculate IST time
    const utcMs = date.getTime();
    const istMs = utcMs + (IST_OFFSET_MINUTES * 60 * 1000);
    const istDate = new Date(istMs);

    // Format as ISO with IST offset
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const hours = String(istDate.getUTCHours()).padStart(2, '0');
    const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istDate.getUTCSeconds()).padStart(2, '0');
    const ms = String(istDate.getUTCMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}+05:30`;
}

/**
 * Parse a date key (YYYY-MM-DD) into a Date object at IST midnight.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @returns Date object representing midnight IST on that day
 */
export function parseDateKey(dateKey: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.warn('[DateKeyService] Invalid date key format:', dateKey);
        return new Date(NaN);
    }

    const [year, month, day] = dateKey.split('-').map(Number);

    // Create date at midnight IST (which is previous day 18:30 UTC)
    // We create it as local noon to avoid timezone issues, then adjust
    const localDate = new Date(year, month - 1, day, 12, 0, 0, 0);
    return localDate;
}

/**
 * Get start and end of a date key day in UTC timestamps.
 * Useful for querying logs within a specific IST day.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @returns Object with startMs and endMs representing the IST day boundaries
 */
export function getDateKeyBounds(dateKey: string): { startMs: number; endMs: number } {
    const [year, month, day] = dateKey.split('-').map(Number);

    // IST midnight = UTC 18:30 previous day
    // Create a UTC date at 00:00, then subtract IST offset
    const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    const istMidnightUtc = utcMidnight - (IST_OFFSET_MINUTES * 60 * 1000);

    return {
        startMs: istMidnightUtc,
        endMs: istMidnightUtc + (24 * 60 * 60 * 1000) - 1
    };
}

/**
 * Check if two timestamps fall on the same IST date.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns true if both timestamps are on the same IST calendar day
 */
export function isSameDateKey(a: Date | string, b: Date | string): boolean {
    return getDateKey(a) === getDateKey(b);
}

/**
 * Get the date key for "today" in IST.
 * Alias for getDateKey() with no arguments.
 */
export function getTodayKey(): string {
    return getDateKey();
}

/**
 * Get the date key for "yesterday" in IST.
 */
export function getYesterdayKey(): string {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return getDateKey(yesterday);
}

/**
 * Get the date key for N days ago in IST.
 *
 * @param daysAgo - Number of days to go back (positive integer)
 */
export function getDateKeyDaysAgo(daysAgo: number): string {
    const now = new Date();
    const target = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return getDateKey(target);
}

/**
 * Compare two date keys chronologically.
 *
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareDateKeys(a: string, b: string): -1 | 0 | 1 {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Format a date key for display in a user-friendly format.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string (e.g., "6 Feb 2026" or "Thursday, 6 February")
 */
export function formatDateKeyForDisplay(
    dateKey: string,
    options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
    const date = parseDateKey(dateKey);
    if (isNaN(date.getTime())) return dateKey;

    return new Intl.DateTimeFormat('en-IN', options).format(date);
}
