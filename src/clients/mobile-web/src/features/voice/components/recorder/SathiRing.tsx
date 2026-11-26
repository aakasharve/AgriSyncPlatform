/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-26: "exact replication". The understanding ring of the approved design
 * (`makeRing`: 326 px, radius 96, 42 px nodes, a dotted track, each label anchored outward so it never leaves the frame)
 * with Sathi's orb in its middle. The nine v2 parts in their order (`ringNodesV2`: no पीक, अडथळा always), labels from
 * `CATEGORY_META` (अडथळा for the disturbance), icons from `CategoryIcon`.
 *
 * WHILE RECORDING EVERY NODE STAYS NEUTRAL GREY: nothing is understood until he stops (there is no live parse), so no node
 * is ever lit or reddened on a timer (P4). Positions are in percent, so the ring shrinks with a 320 px screen.
 */
import React from 'react';
import { CATEGORY_META, type CategoryId, type NodeState, type RingNodeData } from '../../../logs/components/shramsathi/understandingRing/categories';
import { CategoryIcon } from '../../../logs/components/shramsathi/understandingRing/CategoryIcon';
import { ringNodesV2 } from '../../../logs/components/voiceResult/resultModel';

/** The design's geometry (`makeRing(…, {size:326, R:96, ns:42})`). */
const SIZE = 326;
const R = 96;
const NS = 42;
const pct = (v: number) => `${((v / SIZE) * 100).toFixed(3)}%`;

/** The nine v2 nodes, every one neutral: what the ring shows while he is still speaking. */
export function recordingNodes(): RingNodeData[] {
    const all = Object.fromEntries((Object.keys(CATEGORY_META) as CategoryId[]).map(id => [id, 'neutral' as NodeState]));
    return ringNodesV2(all).map(n => ({ ...n, state: 'neutral' as const }));
}

const Label: React.FC<{ text: string }> = ({ text }) => (
    <span className="rounded-md bg-[rgba(251,251,247,.88)] px-1 text-center text-[11px] font-extrabold leading-[1.35] text-[#5F6B63]">
        {text.split('<br>').map((line, i) => <span key={i} className="block">{line}</span>)}
    </span>
);

export const SathiRing: React.FC<{ nodes: readonly RingNodeData[]; children?: React.ReactNode }> = ({ nodes, children }) => {
    const c = SIZE / 2;
    return (
        <div className="relative mx-auto w-full max-w-[326px]" data-testid="sathi-ring">
            <div className="relative h-0 w-full pb-[100%]">
                <svg aria-hidden="true" viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                    <circle cx={c} cy={c} r={R} fill="none" stroke="#DDE3DA" strokeWidth="5" strokeDasharray="1.5 6" strokeLinecap="round" />
                </svg>
                {children}
                <ul className="m-0 list-none p-0" aria-hidden="true">
                    {nodes.map((n, i) => {
                        const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
                        const cs = Math.cos(a);
                        const sn = Math.sin(a);
                        const x = c + R * cs;
                        const y = c + R * sn;
                        const d = NS / 2 + 5;
                        return (
                            <li key={n.id} data-testid={`ring-node-${n.id}`} data-state={n.state} data-label={n.label.replace('<br>', ' ')}>
                                <span className="absolute z-[2] -ml-[21px] -mt-[21px] grid h-[42px] w-[42px] place-items-center rounded-full border-2 border-[#DDE3DA] bg-white"
                                    style={{ left: pct(x), top: pct(y) }}>
                                    <CategoryIcon name={n.icon} size={26} style={{ opacity: 0.3, filter: 'grayscale(1)' }} />
                                </span>
                                <span className="pointer-events-none absolute z-[3] flex flex-col items-center whitespace-nowrap"
                                    style={{ left: pct(x + d * cs), top: pct(y + d * sn), transform: `translate(calc(-50% + ${(cs * 50).toFixed(1)}%), calc(-50% + ${(sn * 50).toFixed(1)}%))` }}>
                                    <Label text={n.label} />
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

export default SathiRing;
