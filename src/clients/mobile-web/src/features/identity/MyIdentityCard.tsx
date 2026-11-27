/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; drawing V2-A card 2) - "माझी ओळख" on the सेट-अप केंद्र: the SIGNED-IN
 * person's own card, every field open (scroll to fill). Photo, his name in the app's language, the title of his seat on the open farm, the photo
 * line, then पूर्ण नाव *, the other-script name, मोबाईल क्रमांक, Farmer ID, गाव *, तालुका *, जिल्हा *, पिनकोड, "* असलेलं भरणं आवश्यक", जतन करा.
 *
 * Truth rules:
 *   - his name, never the farm owner's (the old hub card read `profile.name`, the primary owner's);
 *   - a suggested other-script name is greyed until "बरोबर" and is never sent unconfirmed (P1);
 *   - "सत्यापित" only when the server says a code proved his number; the Farmer ID always says "पडताळलेला नाही" when it has a value (never a tick);
 *   - saved only after the server's 200; offline "पाठवायचं बाकी" (P10); the identity step is पूर्ण only from the server's `complete`;
 *   - Q3 = B: what he typed is saved even with places missing; the card stays बाकी until गाव, तालुका, जिल्हा are in;
 *   - Q8 open: in Marathi mode no English taluka name is shown; a taluka set from the village is left out;
 *   - Q5 = A: the 8-day ask on his own card only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ShieldCheck, User } from 'lucide-react';
import { BigButton, GlassCard } from '../../shared/components/ui/placeUi';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { getOperatorRoleLabel } from '../../shared/roles/roleLabels';
import { digitsFor } from '../../shared/utils/marathiDigits';
import { otherScriptOf, suggestOtherScriptName } from '../../domain/names/otherScriptName';
import type { VillageHit } from '../../domain/places/placeSearch';
import { villageByCode } from '../../domain/places/placeSearch';
import { formFromCard, problemOfRefusal, problemsOf, type FormProblems, type IdentityForm, type PlaceValue } from './identityForm';
import type { MyIdentity } from './identityApi';
import type { MyIdentityState } from './useMyIdentity';
import { identityWords, type IdentityWords } from './identityWords';
import { loadPlaceData, releasePlaceData, type PlaceData, type PlaceTextSource } from './placeData';
import { PlaceBox, placeText } from './PlaceBox';
import { IdentityPhoto } from './IdentityPhoto';
import { laterUntil, nameAskDue } from './nameAsk';

export const MY_IDENTITY_TEST_ID = 'hub-my-identity';

export interface MyIdentityCardProps {
    userId: string | null;
    identity: MyIdentityState;
    language: 'mr' | 'en';
    /** His ACTIVE seat's role on the open farm; null = no seat yet (a waiting request shows no title). */
    role: string | null;
    /** The server's own name for him (`/me/context` → me.displayName) until his card answers. */
    ownDisplayName: string;
    /** The server's masked number (`/me/context`) and whether a code proved it, until his card answers. */
    ownPhone?: { masked: string; verified: boolean } | null;
    /** Only a government-verified identity is called verified (nothing sets it today). */
    governmentVerified?: boolean;
    /** Test seam: where the bundled list is read from. */
    placeSource?: PlaceTextSource;
    /** Test seam: the clock of the 8-day ask. */
    now?: () => Date;
}

const ROLE_TITLES = new Set(['PrimaryOwner', 'SecondaryOwner', 'Mukadam', 'Worker']);

function titleOf(role: string | null, words: IdentityWords, language: 'mr' | 'en'): string | null {
    if (!role) return null;
    if (ROLE_TITLES.has(role)) return words.titles[role as keyof IdentityWords['titles']];
    const label = getOperatorRoleLabel(role);
    return language === 'en' ? label.en : label.mr;
}

/** His name in the app's language: the Marathi name in Marathi mode, the English one in English mode, else the full name as typed. */
export function displayNameOf(card: MyIdentity | null, language: 'mr' | 'en', fallback: string): string {
    if (!card) return fallback;
    const other = language === 'mr' ? card.nameMr?.value : card.nameEn?.value;
    return other || card.fullName || fallback;
}

function phoneText(phone: string): string {
    const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
    return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

const inputClass = 'mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[17px] font-bold text-stone-900 outline-none ring-1 focus:ring-2 focus:ring-emerald-500';

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode; problem?: string; testId: string }> = ({ label, required, children, problem, testId }) => (
    <div className="mt-3" data-testid={testId}>
        <span className="block text-[13.5px] font-extrabold text-stone-700">{label}{required && <b className="ml-1 text-rose-600" aria-hidden="true">*</b>}</span>
        {children}
        {problem && <span className="mt-1 block text-[13px] font-extrabold text-rose-700" data-testid={`${testId}-problem`}>{problem}</span>}
    </div>
);

export const MyIdentityCard: React.FC<MyIdentityCardProps> = ({
    userId, identity, language, role, ownDisplayName, ownPhone, governmentVerified, placeSource, now = () => new Date(),
}) => {
    const words = identityWords(language);
    const { card } = identity;

    // The form: null = show what the server holds (or his unsent card); his first edit makes it his.
    const base = useMemo(() => identity.pending?.form ?? identity.unsentForm ?? formFromCard(card, ownDisplayName), [identity.pending, identity.unsentForm, card, ownDisplayName]);
    const [edits, setEdits] = useState<IdentityForm | null>(null);
    const form = edits ?? base;
    const change = useCallback((next: Partial<IdentityForm>) => setEdits(prev => ({ ...(prev ?? base), ...next })), [base]);
    const [problems, setProblems] = useState<FormProblems>({});
    useEffect(() => { if (identity.saveState === 'saved') setEdits(null); }, [identity.saveState]);

    // The bundled list: read on the first letter typed in a place box (or for the Marathi-name suggestion), dropped when the card goes.
    const [data, setData] = useState<PlaceData | null>(null);
    const [dataState, setDataState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
    const needData = useCallback(() => {
        if (dataState === 'loading' || dataState === 'ready') return; // 'failed' tries again on his next letter
        setDataState('loading');
        loadPlaceData(placeSource).then(d => { setData(d); setDataState('ready'); }, () => setDataState('failed'));
    }, [dataState, placeSource]);
    useEffect(() => () => releasePlaceData(), []);

    const target = otherScriptOf(form.fullName);
    const otherKey = target === 'mr' ? 'nameMr' : 'nameEn';
    const otherValue = target ? form[otherKey] : null;
    const suggestion = target ? suggestOtherScriptName(form.fullName, data?.words ?? null)?.suggestion ?? null : null;
    // An English name with an empty Marathi box needs the word list for its suggestion.
    useEffect(() => { if (dataState === 'idle' && target === 'mr' && !otherValue?.value) needData(); }, [dataState, target, otherValue?.value, needData]);
    const setOther = (v: IdentityForm['nameMr']) => change(otherKey === 'nameMr' ? { nameMr: v } : { nameEn: v });

    // The 8-day ask (his own card only), from what the SERVER holds.
    const who = userId ?? '__signed_out__';
    const [firstSeen, setFirstSeen, firstSeenLoaded] = useUiPref<string | null>(`identity:firstSeen:${who}`, null);
    const [askLater, setAskLater] = useUiPref<string | null>(`identity:askLater:${who}`, null);
    useEffect(() => {
        if (userId && card && !card.updatedAtUtc && firstSeenLoaded && !firstSeen) setFirstSeen(now().toISOString());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, card, firstSeenLoaded, firstSeen]);
    const savedTarget = card ? otherScriptOf(card.fullName) : null;
    const askSuggestion = card && savedTarget ? suggestOtherScriptName(card.fullName, data?.words ?? null)?.suggestion ?? null : null;
    const askDue = !!userId && nameAskDue({
        target: savedTarget,
        secondNameSaved: !!(savedTarget === 'mr' ? card?.nameMr : card?.nameEn) || !!form[savedTarget === 'mr' ? 'nameMr' : 'nameEn']?.value,
        suggestion: askSuggestion,
        updatedAtUtc: card?.updatedAtUtc ?? null,
        firstSeenAt: firstSeen,
        laterUntilAt: askLater,
        now: now(),
    });

    const save = (next: IdentityForm) => {
        const p = problemsOf(next);
        setProblems(p);
        if (Object.keys(p).length > 0) return;
        void identity.save(next);
    };

    // A listed village's own PIN (for the "यादीतला पिन" chip).
    const [villagePin, setVillagePin] = useState<string | null>(null);
    const listedVillage = form.village?.kind === 'list' ? form.village : null;
    const pinOfList = villagePin ?? (listedVillage && data ? villageByCode(data.index, listedVillage.code)?.village.pin ?? null : null);

    const pickVillage = (v: PlaceValue, hit?: VillageHit) => {
        if (v?.kind === 'list' && hit) {
            setVillagePin(hit.village.pin);
            change({
                village: v,
                taluka: { kind: 'list', code: hit.taluka.code, nameMr: null, nameEn: hit.taluka.nameEn },
                district: { kind: 'list', code: hit.district.code, nameMr: hit.district.nameMr, nameEn: hit.district.nameEn },
            });
            return;
        }
        setVillagePin(null);
        // Taluka and district that came from the old listed village go with it.
        change(form.village?.kind === 'list' ? { village: v, taluka: null, district: null } : { village: v });
    };
    const pickTaluka = (v: PlaceValue) => {
        if (v?.kind === 'list' && data) {
            const t = data.index.list.talukas.get(v.code);
            const d = t ? data.index.list.districts.get(t.districtCode) : undefined;
            change({ taluka: v, district: d ? { kind: 'list', code: d.code, nameMr: d.nameMr, nameEn: d.nameEn } : form.district });
            return;
        }
        change(form.taluka?.kind === 'list' ? { taluka: v, district: null } : { taluka: v });
    };

    const villageListed = form.village?.kind === 'list';
    const talukaListed = form.taluka?.kind === 'list';
    const name = displayNameOf(card, language, ownDisplayName);
    const title = titleOf(role, words, language);
    const refusal = identity.saveState === 'refused' && identity.refusedCode ? problemOfRefusal(identity.refusedCode) : null;
    const problemText = (field: keyof FormProblems) => {
        const p = problems[field] ?? (refusal?.field === field ? refusal.problem : undefined);
        return p ? words.problems[p] : undefined;
    };
    const phone = card ? { text: phoneText(card.phone), verified: card.phoneVerifiedAtUtc != null } : ownPhone ? { text: ownPhone.masked, verified: ownPhone.verified } : null;

    const derived = (testId: string, label: string, value: PlaceValue, chip: string) => (
        <Field label={label} required testId={testId}>
            <div className="mt-1 flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl bg-stone-100 px-3 py-1.5 text-[16px] font-bold text-stone-700" data-testid={`${testId}-derived`}>
                {placeText(value, language)}
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-emerald-800">{chip}</span>
            </div>
        </Field>
    );

    let status: React.ReactNode = null;
    if (identity.saveState === 'saving') status = words.saving;
    else if (identity.saveState === 'saved') status = card && !card.complete ? `${words.saved}. ${words.notComplete}` : words.saved;
    else if (identity.saveState === 'pending' || (identity.saveState === 'idle' && identity.pending)) status = words.pending;
    else if (identity.saveState === 'stale') {
        const now2 = card ? [card.fullName, placeText(formFromCard(card, '').village, language)].filter(Boolean).join(' · ') : '';
        status = <>{words.stale}{now2 && <span className="mt-1 block text-stone-700" data-testid="my-identity-stale-now">{words.staleNow} {now2}</span>}</>;
    } else if (identity.saveState === 'refused') status = words.refused;
    else if (card && card.version > 0 && !card.complete) status = words.notComplete;

    return (
        <GlassCard testId={MY_IDENTITY_TEST_ID}>
            <p className="m-0 flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500"><User size={16} aria-hidden="true" />{words.meCap}</p>
            <div className="mt-2 flex items-center gap-3">
                <IdentityPhoto name={name} photo={card?.photo} words={words} language={language} onChanged={() => { void identity.reload(); }} />
                <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-center gap-1.5 text-[19px] font-extrabold leading-tight text-stone-900 [overflow-wrap:anywhere]" data-testid="my-identity-name">
                        {name || '—'}
                        {title && <span className="inline-flex shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-emerald-800" data-testid="my-identity-title">{title}</span>}
                    </p>
                    <p className="m-0 mt-0.5 text-[12.5px] font-semibold leading-snug text-stone-500" data-testid="my-identity-photo-line">{words.photoLine}</p>
                    {governmentVerified && (
                        <p className="m-0 mt-0.5 flex items-center gap-1 text-[13px] font-extrabold text-emerald-800" data-testid="hub-verified"><ShieldCheck size={15} aria-hidden="true" />{words.governmentVerified}</p>
                    )}
                </div>
            </div>

            {askDue && askSuggestion && savedTarget && (
                <div className="mt-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200" data-testid="my-identity-ask">
                    <p className="m-0 text-[15px] font-extrabold text-stone-900">{savedTarget === 'mr' ? words.askMr : words.askEn}</p>
                    <p className="m-0 mt-1 text-[18px] font-black text-emerald-900">{askSuggestion}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" data-testid="my-identity-ask-confirm" onClick={() => {
                            const confirmed = { value: askSuggestion, basis: 'ConvertedConfirmed' as const };
                            const next: IdentityForm = savedTarget === 'mr' ? { ...form, nameMr: confirmed } : { ...form, nameEn: confirmed };
                            setEdits(next);
                            save(next);
                        }} className="min-h-[44px] rounded-full bg-emerald-700 px-4 text-[14.5px] font-extrabold text-white">{words.confirm}</button>
                        <button type="button" data-testid="my-identity-ask-change" onClick={() => change(savedTarget === 'mr' ? { nameMr: { value: askSuggestion, basis: 'ConvertedConfirmed' } } : { nameEn: { value: askSuggestion, basis: 'ConvertedConfirmed' } })}
                            className="min-h-[44px] rounded-full bg-white px-4 text-[14.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-600">{words.change}</button>
                        <button type="button" data-testid="my-identity-ask-later" onClick={() => setAskLater(laterUntil(now()))}
                            className="min-h-[44px] rounded-full bg-white px-4 text-[14.5px] font-extrabold text-stone-700 ring-1 ring-stone-300">{words.later}</button>
                    </div>
                </div>
            )}

            <Field label={words.fullName} required testId="id-full-name" problem={problemText('fullName')}>
                <input type="text" value={form.fullName} maxLength={100} autoComplete="name" aria-label={words.fullName} data-testid="id-full-name-input"
                    onChange={e => change({ fullName: e.target.value })} className={`${inputClass} ${problemText('fullName') ? 'ring-rose-400' : 'ring-stone-300'}`} />
            </Field>

            {target && (
                <Field label={target === 'mr' ? words.nameMr : words.nameEn} testId="id-other-name" problem={problemText(otherKey)}>
                    <input type="text" value={otherValue?.value ?? ''} maxLength={100} autoComplete="off" aria-label={target === 'mr' ? words.nameMr : words.nameEn} data-testid="id-other-name-input"
                        onChange={e => setOther(e.target.value ? { value: e.target.value, basis: 'Typed' } : null)}
                        className={`${inputClass} ${problemText(otherKey) ? 'ring-rose-400' : 'ring-stone-300'}`} />
                    {!otherValue?.value && suggestion && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-dashed ring-stone-300" data-testid="id-other-name-suggestion">
                            <span className="min-w-0 flex-1 text-[15px] font-bold text-stone-400 [overflow-wrap:anywhere]">
                                <small className="block text-[11.5px] font-extrabold text-stone-500">{words.suggested}</small>{suggestion}
                            </span>
                            <button type="button" data-testid="id-other-name-confirm" onClick={() => setOther({ value: suggestion, basis: 'ConvertedConfirmed' })}
                                className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-emerald-700 px-3 text-[14px] font-extrabold text-white"><Check size={15} aria-hidden="true" />{words.confirm}</button>
                            <button type="button" data-testid="id-other-name-change" onClick={() => setOther({ value: suggestion, basis: 'ConvertedConfirmed' })}
                                className="min-h-[40px] rounded-full bg-white px-3 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-600">{words.change}</button>
                        </div>
                    )}
                    {!otherValue?.value && !suggestion && (
                        <span className="mt-1 block text-[12.5px] font-semibold text-stone-500" data-testid="id-other-name-hint">{target === 'mr' ? words.writeNameMr : words.writeNameEn}</span>
                    )}
                </Field>
            )}

            <Field label={words.phone} testId="id-phone">
                <div className="mt-1 flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl bg-stone-100 px-3 py-1.5 text-[16px] font-bold text-stone-700">
                    {phone?.text ?? '—'}
                    {phone?.verified && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-emerald-800" data-testid="id-phone-verified"><Check size={12} aria-hidden="true" />{words.phoneVerified}</span>}
                </div>
            </Field>

            <Field label={words.farmerId} testId="id-farmer-id" problem={problemText('farmerId')}>
                <input type="text" inputMode="numeric" value={form.farmerId} maxLength={32} autoComplete="off" aria-label={words.farmerId} data-testid="id-farmer-id-input"
                    onChange={e => change({ farmerId: e.target.value })} className={`${inputClass} ${problemText('farmerId') ? 'ring-rose-400' : 'ring-stone-300'}`} />
                {form.farmerId.trim() !== '' && (
                    <span className="mt-1.5 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-amber-800" data-testid="id-farmer-id-unverified">{words.notVerified}</span>
                )}
            </Field>

            <PlaceBox kind="village" testId="id-village" label={words.village} required value={form.village} language={language} words={words}
                data={data} dataState={dataState} onNeedData={needData}
                talukaCode={talukaListed && !villageListed && form.taluka?.kind === 'list' ? form.taluka.code : null}
                districtCode={!villageListed && form.district?.kind === 'list' ? form.district.code : null}
                onPick={pickVillage} />
            {villageListed
                ? (language === 'mr' ? null : derived('id-taluka', words.taluka, form.taluka, words.fromVillage))
                : talukaListed && language === 'mr'
                    ? null
                    : <PlaceBox kind="taluka" testId="id-taluka" label={words.taluka} required value={form.taluka} language={language} words={words}
                        data={data} dataState={dataState} onNeedData={needData}
                        districtCode={form.district?.kind === 'list' ? form.district.code : null} onPick={pickTaluka} />}
            {villageListed || talukaListed
                ? derived('id-district', words.district, form.district, villageListed ? words.fromVillage : words.fromTaluka)
                : <PlaceBox kind="district" testId="id-district" label={words.district} required value={form.district} language={language} words={words}
                    data={data} dataState={dataState} onNeedData={needData} onPick={v => change({ district: v })} />}
            <span className="mt-1 block text-[12.5px] font-semibold text-stone-500">{words.placeHint}</span>

            <Field label={words.pin} testId="id-pin" problem={problemText('pin')}>
                <input type="text" inputMode="numeric" value={form.pin?.value ?? ''} maxLength={6} autoComplete="postal-code" aria-label={words.pin} data-testid="id-pin-input"
                    onChange={e => change({ pin: e.target.value ? { value: e.target.value, basis: 'Typed' } : null })}
                    className={`${inputClass} ${problemText('pin') ? 'ring-rose-400' : 'ring-stone-300'}`} />
                {pinOfList && villageListed && form.pin?.value !== pinOfList && (
                    <button type="button" data-testid="id-pin-from-list" onClick={() => change({ pin: { value: pinOfList, basis: 'FromVillageList' } })}
                        className="mt-1.5 inline-flex min-h-[40px] items-center rounded-full bg-emerald-50 px-3 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                        {words.pinFromList(digitsFor(pinOfList, language))}
                    </button>
                )}
            </Field>

            <p className="m-0 mt-3 text-[12.5px] font-semibold text-stone-500">{words.requiredNote}</p>
            <div className="mt-3">
                <BigButton onClick={() => save(form)} testId="id-save" disabled={identity.saveState === 'saving'}>{words.save}</BigButton>
            </div>
            <p role="status" aria-live="polite" data-testid="id-save-status" data-state={identity.saveState}
                className={`m-0 mt-2 text-[14px] font-extrabold leading-snug ${identity.saveState === 'saved' ? 'text-emerald-800' : 'text-amber-900'}`}>
                {status}
            </p>
        </GlassCard>
    );
};
