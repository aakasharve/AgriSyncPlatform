/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §11.2). The owner's kept-work card on लक्ष द्या: the
 * work the server kept for him - refused for want of a responsibility (lanes 2b / MU-4), work that arrived after the
 * responsibility behind it ended (lanes 2b / L8b-1), and the one line that says a sender's daily limit was reached. Each shows
 * what, who, when and why. It reached only the audit trail before, which no screen shows.
 *
 * Drawn for the farm's PRIMARY account holder alone (the server answers anyone else 403, so no one else's phone asks). A list
 * that cannot be read says so with a retry, never an empty "nothing kept" that may be untrue (P4).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { GlassCard, Tap } from '../../shared/components/ui/placeUi';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { isPrimaryAccountHolderRole } from '../../core/session/farmAuthorities';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { dayOf } from '../invitations/invitationModel';
import { fetchKeptWork, type KeptWorkItem } from './keptWorkClient';
import { relationshipCopy, type RelationshipCopy } from './relationshipCopy';
import { digitsFor } from '../../shared/utils/marathiDigits';

/** The words of one kept item: what it was, who sent it and when, and why it was kept. */
export function keptItemWords(
    item: KeptWorkItem,
    copy: RelationshipCopy,
    language: string | null | undefined,
): { what: string; whoWhen: string; why: string } {
    const kept = copy.kept;
    const what = (item.what && kept.what[item.what]) || kept.whatOther;
    const whoWhen = kept.whoWhen(item.whoName?.trim() || kept.unknownPerson, dayOf(item.atUtc, language));
    let why: string;
    if (item.kind === 'arrived_late') {
        const authority = (item.why && kept.authority[item.why]) || kept.authorityOther;
        why = kept.arrivedLate(authority, item.authorityEndedAtUtc ? dayOf(item.authorityEndedAtUtc, language) : null);
    } else if (item.kind === 'cap_reached') {
        why = kept.capReached;
    } else {
        why = kept.refused((item.why && kept.reasons[item.why]) || kept.reasonOther);
    }
    return { what, whoWhen, why };
}

export const KeptWorkAttention: React.FC = () => {
    const farmContext = useOptionalFarmContext();
    const language = useOptionalLanguage()?.language;
    const copy = relationshipCopy(language);
    const farm = farmContext?.currentFarm ?? null;
    const farmId = farm && isPrimaryAccountHolderRole(farm.role) ? farm.farmId : null;
    const [items, setItems] = useState<KeptWorkItem[] | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        if (!farmId) return;
        try {
            setItems(await fetchKeptWork(farmId));
            setFailed(false);
        } catch (error) {
            // Landing place: the console trace plus the retry line below (never an empty "nothing kept").
            console.warn('[kept-work] could not be read', error);
            setFailed(true);
        }
    }, [farmId]);

    useEffect(() => { setItems(null); setFailed(false); void load(); }, [load]);

    if (!farmId) return null;
    if (failed && !items) {
        return (
            <GlassCard testId="kept-work-failed">
                <p className="m-0 text-[14px] font-bold text-amber-900">{copy.kept.loadFailed}</p>
                <Tap onClick={() => void load()} data-testid="kept-work-retry"
                    className="mt-2 min-h-[44px] rounded-full bg-white px-4 text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-300">
                    {copy.kept.retry}
                </Tap>
            </GlassCard>
        );
    }
    if (!items || items.length === 0) return null;

    return (
        <section className="space-y-2" data-testid="kept-work">
            <p className="m-0 flex items-center gap-1.5 px-1 text-[15px] font-extrabold text-stone-800">
                <Archive size={17} aria-hidden="true" />{digitsFor(copy.kept.title(items.length), language)}
            </p>
            <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-600">{copy.kept.intro}</p>
            <ul className="m-0 space-y-2 p-0">
                {items.map(item => {
                    // IT-D2: a count and a day are numbers - the language's digits (the copy file is shared with other screens).
                    const words = keptItemWords(item, copy, language);
                    const shown = { what: words.what, whoWhen: digitsFor(words.whoWhen, language), why: digitsFor(words.why, language) };
                    return (
                        <li key={item.id} className="list-none rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`kept-work-${item.id}`} data-kind={item.kind}>
                            <p className="m-0 text-[15.5px] font-extrabold text-stone-900" data-testid="kept-what">{shown.what}</p>
                            <p className="m-0 text-[13.5px] font-bold text-stone-700 [overflow-wrap:anywhere]" data-testid="kept-who-when">{shown.whoWhen}</p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-600" data-testid="kept-why">{shown.why}</p>
                        </li>
                    );
                })}
            </ul>
            <p className="m-0 px-1 text-[12.5px] font-semibold text-stone-500">{copy.kept.keptNote}</p>
        </section>
    );
};

export default KeptWorkAttention;
