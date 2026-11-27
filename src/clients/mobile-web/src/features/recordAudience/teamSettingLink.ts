/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.3; founder 27 Nov "keep one redirect button ... change your
 * setting") - the saved screen's "सेटिंग बदला" opens माझी टीम in the setup hub. The two ends sit far apart (the saved screen deep in the log
 * route, the hub on the profile route), so the same hop the oversight requests use (`oversightNavigationEvents.ts`): a plain window event the
 * app router listens for (it opens the profile route), and a once-read key in sessionStorage that `ProfilePage` takes to open its team tab (the
 * pattern of `open_farm_boundary` and the schedule's `schedule_view_crop_id`). Nothing about the record travels.
 */

/** Asks the app router to open the setup hub (its listener: `AppRouter`). */
export const OPEN_TEAM_SETTING_EVENT = 'agrisync:open-team-setting';
/** The hub tab to open once (`'team'`). */
export const HUB_OPEN_TAB_KEY = 'hub_open_tab';
/** What to bring into view on that tab once (`'money'`: the "पैशांच्या नोंदी फक्त मला दिसू दे" line). */
export const HUB_FOCUS_KEY = 'hub_focus';

export type HubFocus = 'money';

/** "सेटिंग बदला": leave the keys for the hub, then ask the router to open it. Safe without `window`. */
export function requestOpenTeamSetting(focus?: HubFocus): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(HUB_OPEN_TAB_KEY, 'team');
        if (focus) window.sessionStorage.setItem(HUB_FOCUS_KEY, focus); else window.sessionStorage.removeItem(HUB_FOCUS_KEY);
    } catch (error) {
        // A blocked sessionStorage still opens the hub (its menu), never nothing; the trace says why the tab did not open by itself.
        console.warn('teamSettingLink: the hub tab could not be left for the hub', error);
    }
    window.dispatchEvent(new Event(OPEN_TEAM_SETTING_EVENT));
}

/** The hub's side: the tab (and focus) left for it, read ONCE (the keys are removed). `null` = nothing was asked. */
export function takeHubOpenTab(): { tab: 'team'; focus?: HubFocus } | null {
    if (typeof window === 'undefined') return null;
    try {
        const tab = window.sessionStorage.getItem(HUB_OPEN_TAB_KEY);
        const focus = window.sessionStorage.getItem(HUB_FOCUS_KEY);
        window.sessionStorage.removeItem(HUB_OPEN_TAB_KEY);
        window.sessionStorage.removeItem(HUB_FOCUS_KEY);
        if (tab !== 'team') return null;
        return focus === 'money' ? { tab, focus } : { tab };
    } catch {
        return null;
    }
}
