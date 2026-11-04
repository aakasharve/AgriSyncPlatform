/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screen 7). A worker's level beside his name:
 * फोन पडताळलेला, or "पूर्ण करा — फोन व पिन" when his phone or PIN is missing, or कार्ड. Information only — never a gate:
 * marking हजेरी works the same for every level. Nothing is shown when the level is unknown (a roster cached before this
 * release): never an invented level.
 */
import React from 'react';
import { CircleAlert, IdCard, ShieldCheck } from 'lucide-react';
import { identityLevelIn } from '../../../shared/names/namesIn';
import { widText } from './widCopy';

interface Props {
    level?: string;
    needsPhoneAndPin?: boolean;
    language?: string | null;
}

const BASE = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-extrabold';

export const IdentityLevelBadge: React.FC<Props> = ({ level, needsPhoneAndPin, language }) => {
    if (level === 'PhoneVerified') {
        return (
            <span data-testid="id-badge-verified" className={`${BASE} border-emerald-200 bg-emerald-50 text-emerald-700`}>
                <ShieldCheck size={14} aria-hidden /> {identityLevelIn('PhoneVerified', language)}
            </span>
        );
    }
    if (needsPhoneAndPin === true) {
        return (
            <span data-testid="id-badge-complete" className={`${BASE} border-amber-200 bg-amber-50 text-amber-800`}>
                <CircleAlert size={14} aria-hidden /> {widText('completeBadge', language)}
            </span>
        );
    }
    if (level === 'Card') {
        return (
            <span data-testid="id-badge-card" className={`${BASE} border-stone-300 bg-stone-50 text-stone-600`}>
                <IdCard size={14} aria-hidden /> {identityLevelIn('Card', language)}
            </span>
        );
    }
    return null;
};
