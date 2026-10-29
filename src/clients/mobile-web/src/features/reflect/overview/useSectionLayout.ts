/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-4) — the आढावा sections' folds and order,
 * remembered on this phone through `useUiPref` (Dexie `uiPrefs`, the store LIVE used). The rules are in
 * `sectionLayout.ts`; this only reads and writes them.
 *
 * The version switch (V1 / V2 / V3) exists only in a TEST build (`IS_LAYOUT_PREVIEW_ENABLED`); a release build
 * always runs V2, the founder's preferred start.
 */
import { useState } from 'react';
import { useUiPref } from '../../../shared/hooks/useUiPref';
import { IS_LAYOUT_PREVIEW_ENABLED } from '../../../app/featureFlags';
import {
    DEFAULT_LAYOUT, DEFAULT_ORDER, LEGACY_FOLD_KEYS, LEGACY_ORDER_KEY, LAYOUT_VERSIONS, foldsOf, isOpen, moved, orderFromLegacy,
    orderOf, prefKeys, remembers, toggled, type FoldMap, type LayoutVersion, type SectionId,
} from './sectionLayout';

export interface SectionLayout {
    version: LayoutVersion;
    order: readonly SectionId[];
    isOpen: (id: SectionId) => boolean;
    toggle: (id: SectionId) => void;
    /** `null` when this version keeps no order (V1). */
    move: ((id: SectionId, step: -1 | 1) => void) | null;
    /** TEST build only: the version switch and the "पहिली भेट" reset. */
    preview: null | {
        setVersion: (v: LayoutVersion) => void;
        resetFirstVisit: () => void;
    };
}

export function useSectionLayout(): SectionLayout {
    const [storedVersion, setStoredVersion] = useUiPref<string>('reflect-layout-preview', DEFAULT_LAYOUT);
    const version: LayoutVersion = IS_LAYOUT_PREVIEW_ENABLED && (LAYOUT_VERSIONS as readonly string[]).includes(storedVersion)
        ? storedVersion as LayoutVersion
        : DEFAULT_LAYOUT;
    // Both versions' keys are read (a hook's key must not change under it: `useUiPref` keeps the old value
    // when the new key has no row). A release build only ever writes V2's.
    const [v2Folds, setV2Folds] = useUiPref<unknown>(prefKeys('v2').folds, null);
    const [v2Order, setV2Order] = useUiPref<unknown>(prefKeys('v2').order, null);
    const [v3Folds, setV3Folds] = useUiPref<unknown>(prefKeys('v3').folds, null);
    const [v3Order, setV3Order] = useUiPref<unknown>(prefKeys('v3').order, null);
    const storedFolds = version === 'v3' ? v3Folds : v2Folds;
    const storedOrder = version === 'v3' ? v3Order : v2Order;
    const setStoredFolds = version === 'v3' ? setV3Folds : setV2Folds;
    const setStoredOrder = version === 'v3' ? setV3Order : setV2Order;
    const [legacyNotes] = useUiPref<unknown>(LEGACY_FOLD_KEYS.notes!, null);
    const [legacyDay] = useUiPref<unknown>(LEGACY_FOLD_KEYS.day!, null);
    const [legacyOrder] = useUiPref<unknown>(LEGACY_ORDER_KEY, null);
    // V1 remembers nothing: its folds live only while the page is open.
    const [sessionFolds, setSessionFolds] = useState<FoldMap>({});

    const legacy: FoldMap = {
        ...(typeof legacyNotes === 'boolean' ? { notes: legacyNotes } : {}),
        ...(typeof legacyDay === 'boolean' ? { day: legacyDay } : {}),
    };
    const folds = remembers(version) ? foldsOf(storedFolds) : sessionFolds;
    const order = remembers(version)
        ? orderOf(storedOrder) ?? (version === DEFAULT_LAYOUT ? orderFromLegacy(legacyOrder) : null) ?? DEFAULT_ORDER
        : DEFAULT_ORDER;

    return {
        version,
        order,
        isOpen: id => isOpen(version, id, folds, legacy),
        toggle: id => {
            const next = toggled(version, id, folds, legacy);
            if (remembers(version)) setStoredFolds(next); else setSessionFolds(next);
        },
        move: remembers(version) ? (id, step) => setStoredOrder(moved(order, id, step)) : null,
        preview: IS_LAYOUT_PREVIEW_ENABLED
            ? {
                setVersion: v => { setStoredVersion(v); setSessionFolds({}); },
                resetFirstVisit: () => { setStoredFolds(null); setStoredOrder(null); setSessionFolds({}); },
            }
            : null,
    };
}
