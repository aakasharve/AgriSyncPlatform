/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A; R1 joining design rule 3) — the waiting
 * screen's own-farm offer. A person whose request to join a farm has waited 2 DAYS for the owner (CTO pick from the
 * founder's "2 or 3 days") is also offered "तुमचं स्वतःचं शेत आहे का? ते जोडा", with the door to make his own farm.
 * His request keeps waiting: if the owner approves later, that farm joins his list too.
 *
 * The 2 days are counted from the SERVER's time of the request (`requestedAtUtc` on /farms/mine), never from when this
 * phone first showed the screen. The caller decides what to do when a time is not known (an older server): it keeps
 * today's screen, where the own-farm door is always there, so nobody is ever left with no way on (P9).
 */
import React, { useEffect, useState } from 'react';
import { Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { FirstRunGlass, GreenButton } from '../firstRun/FirstRunShell';
import { joinStartCopy } from './joinStartCopy';

export const OWN_FARM_OFFER_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** The server's time of a request, or null when it is missing or not a time. */
export const requestedAtMs = (requestedAtUtc: string | null | undefined): number | null => {
    if (typeof requestedAtUtc !== 'string' || requestedAtUtc.length === 0) return null;
    const ms = Date.parse(requestedAtUtc);
    return Number.isNaN(ms) ? null : ms;
};

/** True once a request made at `requestedAtUtc` has waited 2 days at `nowMs`. */
export const hasWaitedTwoDays = (requestedAtUtc: string | null | undefined, nowMs: number): boolean => {
    const at = requestedAtMs(requestedAtUtc);
    return at !== null && nowMs - at >= OWN_FARM_OFFER_AFTER_MS;
};

/** The time now, read again every minute while the waiting screen is open (it can stay open across the 2-day mark). */
export function useMinuteClock(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);
    return now;
}

const OwnFarmOffer: React.FC<{ onStartOwnFarm: () => void }> = ({ onStartOwnFarm }) => {
    const c = joinStartCopy(useOptionalLanguage()?.language);
    return (
        <FirstRunGlass testId="own-farm-offer" className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-800">
                <Sprout size={28} aria-hidden="true" />
            </span>
            <p className="m-0 mt-2 text-[18px] font-extrabold leading-snug text-stone-900">{c.offerTitle}</p>
            <div className="mt-3">
                <GreenButton onClick={onStartOwnFarm} testId="own-farm-offer-start">{c.offerButton}</GreenButton>
            </div>
            <p className="m-0 mt-2 text-[14px] font-bold text-stone-600">{c.offerKeepsWaiting}</p>
        </FirstRunGlass>
    );
};

export default OwnFarmOffer;
