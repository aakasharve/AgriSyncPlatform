/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the shape of one row of the founder's crop master
 * (`cropMasterData.ts`, written by `scripts/crop-master/generate_crop_master.py`). Pure types.
 */

/** The sheet's "Suggested App Visibility", in four levels (PENDING D-25). */
export type CropVisibility = 'core' | 'searchable' | 'review' | 'hidden';

/** The sheet's "Entry Classification". */
export type CropKind = 'crop' | 'tree' | 'use-form' | 'fodder' | 'fungus';

export interface CropMasterGroup { en: string; mr: string }

export interface CropMasterRow {
    /** MHCR-0001 … — the crop's identity; a picture is tied to it. */
    id: string;
    /** Key into `CROP_MASTER_GROUPS`. */
    group: string;
    /** Canonical names. Either can be '' when the sheet leaves it blank (the generator reports it). */
    en: string;
    mr: string;
    /** Every other name the sheet lists, for search and for reading a stored name. */
    altEn: readonly string[];
    altMr: readonly string[];
    kind: CropKind;
    /** The crop this entry is a use / harvest form of (its own id otherwise). */
    base: string;
    vis: CropVisibility;
}
