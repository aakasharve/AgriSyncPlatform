/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The header's one material: a deep-green lacquered face in a brass frame with chamfered (45deg cut) corners.
 * Used by the farm nameboard ONLY: the founder keeps this royal treatment for the board alone, so it stands out (the Setup Hub beside it is plain).
 */

/** Flat brass: the inner rule, nails, rings. */
export const BRASS = '#D9B45B';
/** Brushed brass for frames: light catching the top-left edge, darker toward the bottom-right. */
export const BRASS_FRAME = 'linear-gradient(155deg,#F2DC98 0%,#D9B45B 28%,#B38937 64%,#E3C574 100%)';
/** The green face. */
export const GREEN_FACE = 'linear-gradient(180deg,#17603F 0%,#14532D 48%,#0F3D22 100%)';
/** The shadow under a chamfered object. A box-shadow on a clipped element is clipped away with it; a drop-shadow follows the cut silhouette. */
export const BOARD_SHADOW = 'drop-shadow(0 3px 5px rgba(10,45,25,.34))';

/** A chamfer of `v` px on all four corners. A fixed px value, never a percentage, so the silhouette is the same at every width. */
export const chamfer = (v: number): string => {
    const p = `${v}px`;
    return `polygon(${p} 0, calc(100% - ${p}) 0, 100% ${p}, 100% calc(100% - ${p}), `
        + `calc(100% - ${p}) 100%, ${p} 100%, 0 calc(100% - ${p}), 0 ${p})`;
};
