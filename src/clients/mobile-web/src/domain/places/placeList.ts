/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S0 phone half + S5) - the government village list (LGD) as the phone holds
 * it: the SAME two files the server embeds (`public/places/lgd-mh-2026-11-26.tsv` and `...-areas.json`, copied byte for byte from
 * `src/apps/User/User.Infrastructure/Places/`), with the same version string.
 *
 * Pure: no network, no storage. The TSV's first line names the version and the counts it holds; `parsePlaceList` refuses a file whose rows do not
 * match those counts, a version the areas file does not share, a village whose taluka is not listed, or a taluka whose district is not listed. It
 * never fills a missing name: the 42 villages with no Marathi name keep none, and no taluka carries a Marathi name (founder question 8 is open; the
 * screen leaves the taluka out in Marathi mode rather than show an English one).
 */

/** The list version this phone bundles. The server holds the same string (`LgdPlaceList.CurrentVersion`). */
export const PLACE_LIST_VERSION = 'lgd-mh-2026-11-26';

/** I lived in, U not lived in, F forest (the government's own marks). All are kept: a farmer may live in any of them (P9). */
export type VillageStatus = 'I' | 'U' | 'F';

export interface PlaceVillage {
    /** The LGD village code: the join key the server is sent. */
    code: number;
    talukaCode: number;
    /** The list's Marathi name; null for the villages the list has none for (never translated by the phone). */
    nameMr: string | null;
    nameEn: string;
    /** The list's PIN; null where the list has none. */
    pin: string | null;
    status: VillageStatus;
}

export interface PlaceTaluka {
    code: number;
    districtCode: number;
    nameEn: string;
}

export interface PlaceDistrict {
    code: number;
    nameEn: string;
    nameMr: string;
}

export interface PlaceList {
    version: string;
    villages: PlaceVillage[];
    talukas: ReadonlyMap<number, PlaceTaluka>;
    districts: ReadonlyMap<number, PlaceDistrict>;
}

export class PlaceListError extends Error {}

const COLUMN_HEADER = 'code\ttaluka\tmr\ten\tpin\tstatus';
const PIN = /^[1-9][0-9]{5}$/;
const STATUSES: ReadonlySet<string> = new Set(['I', 'U', 'F']);

function declared(meta: string[], key: string): number {
    const cell = meta.find(m => m.startsWith(`${key}=`));
    const n = cell ? Number(cell.slice(key.length + 1)) : NaN;
    if (!Number.isInteger(n) || n < 0) throw new PlaceListError(`the list does not say how many ${key} it holds`);
    return n;
}

interface AreasFile {
    version?: unknown;
    districts?: { code?: unknown; en?: unknown; mr?: unknown }[];
    talukas?: { code?: unknown; district?: unknown; en?: unknown }[];
}

/** Reads the two bundled files (LF or CRLF). Throws `PlaceListError` when they do not hold together. */
export function parsePlaceList(tsv: string, areasJson: string): PlaceList {
    const lines = tsv.split(/\r?\n/);
    const meta = (lines[0] ?? '').split('\t');
    const version = (meta[0] ?? '').replace(/^#/, '');
    if (!version) throw new PlaceListError('the list has no version line');
    if (lines[1] !== COLUMN_HEADER) throw new PlaceListError('the list has an unknown column header');

    let areas: AreasFile;
    try {
        areas = JSON.parse(areasJson) as AreasFile;
    } catch {
        throw new PlaceListError('the areas file is not JSON');
    }
    if (areas.version !== version) throw new PlaceListError('the areas file is of another list version');

    const districts = new Map<number, PlaceDistrict>();
    for (const d of areas.districts ?? []) {
        if (typeof d.code !== 'number' || typeof d.en !== 'string' || typeof d.mr !== 'string') throw new PlaceListError('a district row is incomplete');
        districts.set(d.code, { code: d.code, nameEn: d.en, nameMr: d.mr });
    }
    const talukas = new Map<number, PlaceTaluka>();
    for (const t of areas.talukas ?? []) {
        if (typeof t.code !== 'number' || typeof t.district !== 'number' || typeof t.en !== 'string') throw new PlaceListError('a taluka row is incomplete');
        if (!districts.has(t.district)) throw new PlaceListError(`taluka ${t.code} names a district the list does not hold`);
        talukas.set(t.code, { code: t.code, districtCode: t.district, nameEn: t.en });
    }

    const villages: PlaceVillage[] = [];
    for (let i = 2; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') continue;
        const c = line.split('\t');
        const code = Number(c[0]);
        const talukaCode = Number(c[1]);
        if (c.length !== 6 || !Number.isInteger(code) || !Number.isInteger(talukaCode)) throw new PlaceListError(`row ${i + 1} is not a village row`);
        if (!talukas.has(talukaCode)) throw new PlaceListError(`village ${code} names a taluka the list does not hold`);
        const pin = c[4] === '' ? null : c[4];
        if (pin !== null && !PIN.test(pin)) throw new PlaceListError(`village ${code} has a PIN that is not six digits`);
        if (!STATUSES.has(c[5])) throw new PlaceListError(`village ${code} has an unknown status`);
        villages.push({ code, talukaCode, nameMr: c[2] === '' ? null : c[2], nameEn: c[3], pin, status: c[5] as VillageStatus });
    }

    if (villages.length !== declared(meta, 'villages')
        || talukas.size !== declared(meta, 'talukas')
        || districts.size !== declared(meta, 'districts')) {
        throw new PlaceListError('the list does not hold the counts its first line names');
    }
    return { version, villages, talukas, districts };
}
