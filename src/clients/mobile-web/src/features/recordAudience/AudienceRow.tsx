/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26; orchestrator call 11) — on a record's own view, for the farm's PRIMARY ACCOUNT
 * HOLDER only: one row "कोण पाहू शकतो: सर्व टीम ›" that opens a sheet with three choices — सर्व टीम, निवडलेले लोक (the
 * farm's active members as tick rows), फक्त मी ("फक्त मी व नोंद करणारा" on a record someone else made: its maker always
 * keeps it). Members never see the control (the caller renders it only for the holder). Recording stays one step: this
 * is never asked at capture (P9).
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Lock, Users } from 'lucide-react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import type { RecordAudienceName, RecordKindName } from '../../infrastructure/api/recordAudienceDtos';
import { useBackDismiss } from '../../core/navigation/useBackDismiss';
import { audienceCopy, audienceLabel, type AudienceCopy } from './audienceCopy';
import { chooseAudience, loadChoosablePeople, type ChoosablePerson } from './recordAudienceLocal';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface AudienceRowProps {
    kind: RecordKindName;
    /** The record(s) the choice applies to (one recording may hold several plots' logs). */
    recordIds: readonly string[];
    farmId: string;
    /** The holder's own server id (he is never offered as a choice). */
    selfUserId: string | null;
    audience: RecordAudienceName | undefined | null;
    chosen: readonly string[] | undefined | null;
    /** The record was made by someone other than the holder (the label says its maker stays). */
    madeBySomeoneElse: boolean;
    /** A work record whose money follows it (the sheet says so). */
    moneyFollows?: boolean;
    testId?: string;
}

export const AudienceRow: React.FC<AudienceRowProps> = props => {
    const copy = audienceCopy(useOptionalLanguage()?.language);
    const [open, setOpen] = useState(false);
    const testId = props.testId ?? 'audience-row';
    const current = props.audience ?? 'Team';
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} data-testid={testId} data-audience={current}
                className="flex min-h-[48px] w-full items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 text-left"
                style={{ fontFamily: SANS }}>
                {current === 'Team' ? <Users size={18} aria-hidden="true" className="text-stone-500" /> : <Lock size={18} aria-hidden="true" className="text-amber-700" />}
                <span className="text-[15px] font-bold text-stone-700">{copy.rowLabel}:</span>
                <span className="flex-1 truncate text-[15px] font-extrabold text-stone-900">{audienceLabel(copy, current, props.madeBySomeoneElse)}</span>
                <ChevronRight size={18} aria-hidden="true" className="text-stone-400" />
            </button>
            {open && <AudienceSheet {...props} copy={copy} current={current} onClose={() => setOpen(false)} />}
        </>
    );
};

const AudienceSheet: React.FC<AudienceRowProps & { copy: AudienceCopy; current: RecordAudienceName; onClose: () => void }> = ({
    kind, recordIds, farmId, selfUserId, chosen, madeBySomeoneElse, moneyFollows, copy, current, onClose, testId = 'audience-row',
}) => {
    useBackDismiss(true, onClose);
    const [pick, setPick] = useState<RecordAudienceName>(current);
    const [people, setPeople] = useState<string[]>([...(chosen ?? [])]);
    const [roster, setRoster] = useState<ChoosablePerson[] | null | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        void loadChoosablePeople(farmId, selfUserId).then(list => { if (live) setRoster(list); });
        return () => { live = false; };
    }, [farmId, selfUserId]);

    const choices: readonly (readonly [RecordAudienceName, string, string])[] = [
        ['Team', copy.team, copy.teamHint],
        ['Selected', copy.selected, madeBySomeoneElse ? copy.selectedAndMakerHint : copy.selectedHint],
        ['OnlyMe', madeBySomeoneElse ? copy.onlyMeAndMaker : copy.onlyMe, madeBySomeoneElse ? copy.onlyMeAndMakerHint : copy.onlyMeHint],
    ];
    const ready = pick !== 'Selected' || people.length > 0;
    const toggle = (userId: string) => setPeople(p => (p.includes(userId) ? p.filter(x => x !== userId) : [...p, userId]));
    const save = async () => {
        setSaving(true);
        setFailed(false);
        try {
            await chooseAudience(kind, recordIds, { audience: pick, people });
            window.dispatchEvent(new CustomEvent('agrisync:toast', { detail: { message: copy.saved, type: 'success' } }));
            onClose();
        } catch (error) {
            // Never silent: he is told it did not save; what failed is kept in the log.
            console.error('AudienceRow: the choice could not be queued', error);
            setFailed(true);
        } finally {
            setSaving(false);
        }
    };

    // Fix pass 1 (L1) — through a portal to document.body: a card with a backdrop blur (the money book's सविस्तर view) is
    // the containing block of anything `fixed` inside it, so the sheet opened mid-list under the sticky header.
    return createPortal(
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45" onClick={onClose} data-testid={`${testId}-sheet`} style={{ fontFamily: SANS }}>
            <div className="max-h-[92%] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-white p-4 pb-6 shadow-2xl"
                onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={copy.sheetTitle}>
                <h2 className="m-0 mb-3 text-[19px] font-extrabold text-stone-900">{copy.sheetTitle}</h2>
                <div className="space-y-2" role="radiogroup" aria-label={copy.sheetTitle}>
                    {choices.map(([key, title, hint]) => (
                        <button key={key} type="button" role="radio" aria-checked={pick === key} onClick={() => setPick(key)} data-testid={`${testId}-choice-${key}`}
                            className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border px-3 text-left ${pick === key ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'}`}>
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${pick === key ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300'}`}>
                                {pick === key && <Check size={14} aria-hidden="true" />}
                            </span>
                            <span className="min-w-0">
                                <span className="block text-[16px] font-extrabold text-stone-900">{title}</span>
                                <span className="block text-[13px] font-semibold text-stone-600">{hint}</span>
                            </span>
                        </button>
                    ))}
                </div>
                {pick === 'Selected' && (
                    <div className="mt-3 space-y-1.5" data-testid={`${testId}-people`}>
                        <p className="m-0 text-[14px] font-bold text-stone-700">{copy.pickPeople}</p>
                        {roster === null && <p className="m-0 text-[14px] font-semibold text-amber-800" data-testid={`${testId}-people-unavailable`}>{copy.peopleNotLoaded}</p>}
                        {roster && roster.length === 0 && <p className="m-0 text-[14px] font-semibold text-stone-600">{copy.noPeople}</p>}
                        {roster?.map(person => (
                            <button key={person.userId} type="button" role="checkbox" aria-checked={people.includes(person.userId)} onClick={() => toggle(person.userId)}
                                data-testid={`${testId}-person-${person.userId}`}
                                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 text-left">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${people.includes(person.userId) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300'}`}>
                                    {people.includes(person.userId) && <Check size={14} aria-hidden="true" />}
                                </span>
                                <span className="text-[15.5px] font-bold text-stone-900">{person.name}</span>
                            </button>
                        ))}
                    </div>
                )}
                {moneyFollows && pick !== current && <p className="m-0 mt-3 text-[13.5px] font-semibold text-stone-600">{copy.moneyFollows}</p>}
                {failed && <p className="m-0 mt-3 text-[14px] font-bold text-red-700" role="status">{copy.notSaved}</p>}
                <div className="mt-4 flex gap-2">
                    <button type="button" onClick={onClose} className="min-h-[48px] flex-1 rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-700">{copy.cancel}</button>
                    <button type="button" onClick={() => void save()} disabled={!ready || saving || (pick === current && pick !== 'Selected')} data-testid={`${testId}-save`}
                        className="min-h-[48px] flex-1 rounded-2xl bg-emerald-700 text-[16px] font-extrabold text-white disabled:opacity-50">{copy.save}</button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

/** The small lock chip a narrowed record shows in the holder's lists ("फक्त मी" / "निवडलेले लोक"). Nothing for the team. */
export const AudienceLockChip: React.FC<{ audience: RecordAudienceName | undefined | null; madeBySomeoneElse?: boolean; testId?: string }> = ({ audience, madeBySomeoneElse = false, testId }) => {
    const copy = audienceCopy(useOptionalLanguage()?.language);
    if (audience !== 'OnlyMe' && audience !== 'Selected') return null;
    return (
        <span data-testid={testId ?? 'audience-chip'} data-audience={audience}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-extrabold text-amber-800 ring-1 ring-amber-300">
            <Lock size={12} aria-hidden="true" />{audience === 'OnlyMe' ? (madeBySomeoneElse ? copy.onlyMeAndMaker : copy.onlyMe) : copy.selected}
        </span>
    );
};

export default AudienceRow;
