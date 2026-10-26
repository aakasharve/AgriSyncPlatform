/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, V-2/V-3) — the recordings calendar's month
 * arithmetic and its day / month names, on plain date keys (YYYY-MM-DD, the app's IST day). Pure: no
 * clock is read here; callers pass today's key.
 */
import type { VoiceDiaryLocale } from '../../i18n/voiceDiaryTranslations';
import type { DateOnlyFormatOptions } from '../../core/domain/services/DateKeyService';

/** 'YYYY-MM' of a date key. */
export const monthOf = (dateKey: string): string => dateKey.slice(0, 7);

/** The month `delta` months away from 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every day of `month` up to `todayKey`, newest first (a month after today has none). */
export function daysOfMonth(month: string, todayKey: string): string[] {
    const todayMonth = monthOf(todayKey);
    if (month > todayMonth) return [];
    const [y, m] = month.split('-').map(Number);
    const lastDay = month === todayMonth
        ? Number(todayKey.slice(8, 10))
        : new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: lastDay }, (_, i) => `${month}-${String(lastDay - i).padStart(2, '0')}`);
}

/**
 * A date key in his language: Marathi month and weekday names with ordinary digits (the money pages'
 * 'mr-IN-u-nu-latn'), English otherwise. A month key ('YYYY-MM') reads as its first day. DATE parts
 * only (`DateOnlyFormatOptions`): a clock belongs to shared/utils/displayTime.
 */
export function formatDayKey(dateKey: string, options: DateOnlyFormatOptions, locale: VoiceDiaryLocale): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return formatterFor(options, locale).format(new Date(Date.UTC(y, m - 1, d || 1)));
}

/**
 * One formatter per (language, shape). Building an `Intl.DateTimeFormat` is costly and the calendar
 * asks for ~60 labels per render (the page re-renders on every uploader / connectivity refresh).
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(options: DateOnlyFormatOptions, locale: VoiceDiaryLocale): Intl.DateTimeFormat {
    const tag = locale === 'mr-IN' ? 'mr-IN-u-nu-latn' : 'en-IN';
    const key = `${tag}|${JSON.stringify(options)}`;
    let cached = formatterCache.get(key);
    if (!cached) {
        cached = new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' });
        formatterCache.set(key, cached);
    }
    return cached;
}
