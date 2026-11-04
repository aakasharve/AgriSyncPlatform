/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 section 10). The calm list
 * "यांचा फोन व पिन भरा" for workers who were added with a name only (before this release, by an older phone, or from
 * the हजेरी screen's quick add): shown AT MOST ONCE A DAY per farm on this phone, always with "नंतर करा", and never
 * blocking हजेरी, a log or anything else. Tapping a name opens his phone-and-PIN form.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { readIdentityNudgeDay, writeIdentityNudgeDay } from '../../../infrastructure/storage/IdentityNudgeStore';
import type { FieldOperator } from '../data/fieldOperatorClient';
import { widText } from './widCopy';

interface Props {
    farmId: string;
    workers: FieldOperator[];
    onOpen: (worker: FieldOperator) => void;
    /** The clock (a test moves it); the phone's own day decides "once a day". */
    now?: () => Date;
}

const localDay = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const NameOnlyNudge: React.FC<Props> = ({ farmId, workers, onOpen, now }) => {
    const language = useOptionalLanguage()?.language;
    const missing = useMemo(() => workers.filter((w) => w.isActive && w.needsPhoneAndPin === true), [workers]);
    const today = localDay((now ?? (() => new Date()))());
    // Decided ONCE per mount, as soon as there is someone to complete (the list may arrive after the screen): shown
    // only when it has not been shown today on this phone, and the day is stamped the moment it shows.
    const [state, setState] = useState<'undecided' | 'shown' | 'hidden'>('undecided');
    useEffect(() => {
        if (state !== 'undecided' || missing.length === 0) return;
        if (readIdentityNudgeDay(farmId) === today) {
            setState('hidden');
            return;
        }
        writeIdentityNudgeDay(farmId, today);
        setState('shown');
    }, [state, missing.length, farmId, today]);

    if (state !== 'shown' || missing.length === 0) return null;

    return (
        <div data-testid="nudge-name-only" className="mb-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-[15px] font-extrabold text-amber-800">
                <CircleAlert size={18} aria-hidden /> {widText('completeTitle', language)}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                {missing.map((w) => (
                    <button key={w.id} type="button" data-testid={`nudge-item-${w.id}`} onClick={() => onOpen(w)}
                        className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-3 text-[15px] font-bold text-stone-800">
                        {w.displayName}
                    </button>
                ))}
            </div>
            <button type="button" data-testid="nudge-later" onClick={() => setState('hidden')}
                className="mt-2 min-h-[44px] w-full rounded-xl text-[14px] font-bold text-amber-800">
                {widText('later', language)}
            </button>
        </div>
    );
};
