/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A4) — the moment the real answer is back: Sathi's ring (the same ring as the
 * screen after stop) lights the parts this recording TOLD and gently marks the parts the day has not told at all, then the result screen
 * shows. Once per recording; a tap (or the phone's back) goes to the result at once.
 *
 * Honesty (P5): nothing here is guessed. Lit = the parts this recording's saved records tell by the ring's own rule (`ringNodesForDay`
 * over THIS recording's records only: a part told earlier today is not lit). Marked = the result model's own `day.missing` (parts the
 * whole day neither tells nor holds anything about), so the ring and the result screen below never disagree. अडथळा is lit when told and
 * never marked (`ringNodesV2`'s rule). Everything else stays quiet.
 *
 * It is drawn OVER the result screen (which mounts underneath at once): it sits on the app's back stack while it shows, so the result
 * screen's reading-time clock waits for it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { logger } from '../../../../infrastructure/observability/Logger';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { DailyLog } from '../../../../types';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import type { CategoryId } from '../shramsathi/understandingRing/categories';
import { PHONE_COLUMN } from '../phoneColumn';
import { PART_OF_NODE, RING_V2_ORDER, buildDayView, ringNodesForDay, type PartKey, type WhoDeps } from '../voiceResult/resultModel';
import { BrandLine } from './RingWaitScreen';
import { SathiRing } from './SathiRing';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SAFE_TOP = 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';
/** How long the lit ring stays before the result (plus a short step per lit or marked part). */
export const REVEAL_MS = 1800;
const STEP_MS = 160;

/** The ring parts THIS recording's records tell, by the ring's own rule (never a part the answer did not contain). */
export function toldRingParts(current: readonly DailyLog[]): Set<CategoryId> {
    if (current.length === 0) return new Set();
    return new Set(ringNodesForDay(current, current[0]?.date).filter(n => n.state === 'told').map(n => n.id));
}

/** The ring parts the result model calls missing for the day (`day.missing`), mapped to the ring; अडथळा never. */
export function missedRingParts(missing: readonly PartKey[]): Set<CategoryId> {
    return new Set(RING_V2_ORDER.filter(id => {
        const part = PART_OF_NODE[id];
        return part !== undefined && missing.includes(part);
    }));
}

/** `buildDayView` needs who said what only for names; the reveal reads only `missing`. */
const NO_NAMES: WhoDeps = { youIds: new Set(), nameOf: () => undefined, unknownLabel: '', language: 'mr', nativeDigits: false };

const revealed = new Set<string>();
/** Test seam: forget which recordings have been revealed. */
export function forgetRingReveals(): void { revealed.clear(); }

export interface RingRevealHostProps {
    /** The recording's key: it is revealed once. */
    recordingKey: string;
    /** This recording's saved records. */
    logs: readonly DailyLog[];
    /** The phone's records (for the day's missing parts, the result model's own rule). */
    history: readonly DailyLog[];
}

export const RingRevealHost: React.FC<RingRevealHostProps> = ({ recordingKey, logs, history }) => {
    const W = voiceFlowWords(useOptionalLanguage()?.language);
    const [shown, setShown] = useState<string | null>(() => (logs.length > 0 && !revealed.has(recordingKey) ? recordingKey : null));
    useEffect(() => {
        if (logs.length > 0 && !revealed.has(recordingKey)) setShown(recordingKey);
    }, [recordingKey, logs.length]);
    const open = shown === recordingKey;
    const told = useMemo(() => toldRingParts(logs), [logs]);
    const missed = useMemo(() => missedRingParts(logs.length > 0 ? buildDayView(logs, history, NO_NAMES).missing : []), [logs, history]);
    const done = useCallback(() => {
        revealed.add(recordingKey);
        setShown(null);
    }, [recordingKey]);
    useBackDismiss(open, done);
    useEffect(() => {
        if (!open) return undefined;
        logger.info('voice_v2.ring.revealed', { told: told.size, missed: missed.size });
        const id = window.setTimeout(done, REVEAL_MS + (told.size + missed.size) * STEP_MS);
        return () => window.clearTimeout(id);
    }, [open, done, told.size, missed.size]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[46] flex justify-center bg-stone-100" data-testid="ring-reveal" onClick={done} role="status"
            aria-label={`${W.understoodBrand} ${W.understoodRest}`}>
            <div className={`flex h-full w-full flex-col items-center gap-6 bg-stone-50 px-4 ${PHONE_COLUMN}`} style={{ fontFamily: SANS, paddingTop: `calc(3.25rem + ${SAFE_TOP})` }}>
                <BrandLine brand={W.understoodBrand} rest={W.understoodRest} testId="ring-reveal-line" />
                <SathiRing mode="reveal" told={told} missed={missed} />
                {missed.size > 0 && (
                    <p className="m-0 text-center text-[13.5px] font-bold text-[#B4373B]" data-testid="ring-reveal-missed">{W.missedNote}</p>
                )}
            </div>
        </div>
    );
};

export default RingRevealHost;
