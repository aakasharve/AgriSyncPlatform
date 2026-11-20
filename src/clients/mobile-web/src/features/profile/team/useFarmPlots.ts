/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 — the plots of ONE farm as this phone holds them (the server's copies), kept live, for the
 * owner's plot choice on a person's team card. Names only; an unnamed plot shows the word for it, never a made-up name.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 6; founder-approved 2026-11-21) — each plot also says
 * its CROP, so the owner's choice can be drawn once per crop (the shared plot card). The stored plot row does NOT hold it: it is the
 * server's plot (`{ id, farmId, name, areaInAcres, ... }`); the crop of a plot lives in the crop-cycle rows and, joined with the crop's
 * own photo/colour/master id, in the app's crop list (`CropProfile.plots`, the store every other crop -> plot screen reads, written by the
 * sync pull from those cycles). So the crop is read from that list, joined by plot id. A plot that no crop of the list holds has NO crop
 * here (`crop` absent) - it is never guessed.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { compareNaturally } from '../../context/components/plotSelectorRules';

/** A plot's crop as the shared plot card needs it (`PickerCrop` without its plots). `name` is the STORED name; the card shows it in his language. */
export interface FarmPlotCrop {
    id: string;
    name: string;
    iconName: string;
    masterId?: string;
    /** The crop's own colour, a Tailwind `bg-…` class. */
    color?: string;
}

export interface FarmPlot {
    id: string;
    name: string;
    /** The crop that holds this plot, when this phone's crop list says so. */
    crop?: FarmPlotCrop;
}

interface StoredPlotRow { id: string; payload: unknown }
interface StoredCrop { id?: unknown; name?: unknown; iconName?: unknown; masterId?: unknown; color?: unknown; plots?: unknown }

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Plot id -> the crop that holds it, from the crop list (blobs of `CropProfile`). The first crop of the list that holds a plot wins. */
export function cropOfPlotId(cropBlobs: readonly unknown[]): Map<string, { crop: FarmPlotCrop; order: number }> {
    const byPlot = new Map<string, { crop: FarmPlotCrop; order: number }>();
    cropBlobs.forEach((blob, order) => {
        const c = (blob ?? {}) as StoredCrop;
        const id = text(c.id);
        const name = text(c.name).trim();
        if (!id || !name || !Array.isArray(c.plots)) return;
        const crop: FarmPlotCrop = {
            id, name, iconName: text(c.iconName) || 'Sprout',
            ...(text(c.masterId) ? { masterId: text(c.masterId) } : {}),
            ...(text(c.color) ? { color: text(c.color) } : {}),
        };
        for (const p of c.plots as { id?: unknown }[]) {
            const plotId = text(p?.id);
            if (plotId && !byPlot.has(plotId)) byPlot.set(plotId, { crop, order });
        }
    });
    return byPlot;
}

/**
 * The farm's plots, grouped the way the owner's card draws them: crop by crop in the crop list's own order (a plot with no known crop last),
 * and inside a crop by name - "G2" before "G10" - with plain name order as the tie-break (as before this lane, for names with no number).
 */
export function buildFarmPlots(plotRows: readonly StoredPlotRow[], cropBlobs: readonly unknown[]): FarmPlot[] {
    const crops = cropOfPlotId(cropBlobs);
    return plotRows
        .map(row => {
            const held = crops.get(row.id);
            return {
                plot: { id: row.id, name: String((row.payload as { name?: unknown } | null)?.name ?? '').trim(), ...(held ? { crop: held.crop } : {}) } as FarmPlot,
                order: held ? held.order : Number.MAX_SAFE_INTEGER,
            };
        })
        .sort((a, b) => a.order - b.order || compareNaturally(a.plot.name, b.plot.name) || a.plot.name.localeCompare(b.plot.name))
        .map(x => x.plot);
}

/** The farm's plots (by crop, then by name), or `[]` until read / with no farm. */
export function useFarmPlots(farmId: string | null | undefined): FarmPlot[] {
    const [plots, setPlots] = useState<FarmPlot[]>([]);
    useEffect(() => {
        if (!farmId) {
            setPlots([]);
            return undefined;
        }

        let alive = true;
        const subscription = liveQuery(async () => {
            const db = getDatabase();
            const rows = await db.plots.where('farmId').equals(farmId).toArray();
            // The crop list is a second, optional read: a phone that cannot read it still lists its plots (with no crop), never none.
            const cropRows = await db.crops.toArray().catch(() => []);
            return { rows, crops: cropRows.map(r => r.data) };
        }).subscribe({
            next: ({ rows, crops }) => {
                if (!alive) return;
                setPlots(buildFarmPlots(rows, crops));
            },
            error: () => { if (alive) setPlots([]); },
        });
        return () => { alive = false; subscription.unsubscribe(); };
    }, [farmId]);
    return plots;
}
