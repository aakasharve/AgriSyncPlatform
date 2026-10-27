/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, T2) — the ONE way another tab opens the
 * recorder: "झालं, सांगा" on तुलना (for that plot), "काम सांगा" on तुलना, "बोलून सांगा" in करायची कामे.
 *
 * The log flow's state (`status`, `draftLog`, the picked plot) lives ABOVE the tab boundary and survives a
 * tab switch (`shared/utils/recordingPathBusy.ts`), so a door into it must respect what it already holds:
 *
 *   - something is waiting (a parsed draft to confirm — `useVoiceRecorder` leaves it at status `idle` with
 *     `draftLog` set —, a manual edit in progress, a `confirming` screen, or the recorder busy): NOTHING is
 *     changed — the plot is not moved and nothing is cleared; the log tab opens on what is waiting, for him
 *     to finish or discard first. `handleFinalConfirm` saves under the CURRENT plot, so moving the plot under
 *     a waiting draft would file a log spoken for plot A under plot B.
 *   - a save just finished (`success`), or an `error` with no draft left: the flow is reset to a fresh
 *     recorder first — the same reset the success card's own "add another" runs (`handleReset`) — so he
 *     never lands on the old screen, and the recorder he lands on is for the plot he tapped.
 *   - otherwise: pick the plot (when one is given), voice, the log tab.
 */
import type { AppRouterContext } from './routeContext';
import { isRecordingPathBusy } from '../../shared/utils/recordingPathBusy';

export type LogFlowDoorCtx = Pick<AppRouterContext, 'status' | 'draftLog' | 'handleReset' | 'setLogScope' | 'setMode' | 'setMainView'>;

/** What the door did: opened a fresh recorder, or showed what was already waiting. */
export type LogFlowOpened = 'opened' | 'waiting';

export function hasWaitingLogWork(ctx: Pick<AppRouterContext, 'status' | 'draftLog'>): boolean {
    if (isRecordingPathBusy(ctx.status) || ctx.status === 'confirming') return true;
    return ctx.status !== 'success' && ctx.draftLog != null;
}

export function openLogFlow(ctx: LogFlowDoorCtx, plot?: { cropId: string; plotId: string }): LogFlowOpened {
    if (hasWaitingLogWork(ctx)) {
        ctx.setMainView('log');
        return 'waiting';
    }
    if (ctx.status === 'success' || ctx.status === 'error') ctx.handleReset();
    if (plot) {
        ctx.setLogScope({ selectedCropIds: [plot.cropId], selectedPlotIds: [plot.plotId], mode: 'single', applyPolicy: 'broadcast' });
    }
    ctx.setMode('voice');
    ctx.setMainView('log');
    return 'opened';
}
