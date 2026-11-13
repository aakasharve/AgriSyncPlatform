/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-78, D-79, D-84 = 1, D-24e1, D-26; R17, R21) - "आठवणी कोणाला दिसतील",
 * the owner's screen beside the team page, for the primary owner and a seat that holds "आठवणींची मांडणी बदलणे" (the server decides; this page
 * is only drawn for them).
 *
 *   - Three kinds of reminder, each with its choices: from records (the maker and the owner / everyone on the plot), the ones people make for
 *     themselves (the same two), and the schedule's steps (everyone on the plot / the planners).
 *   - The assigned-work line, locked as a ShramSafal rule (D-24e1): no choice here moves it.
 *   - "यांच्या आठवणी नेहमी दिसतील": people whose reminders always show to everyone on the plot (D-84 = 1), with the exception said on the screen.
 *   - "हे कोण बदलू शकतं": who holds the authority to change all this. Only the primary owner sees it and gives it (D-26: a holder cannot pass it on).
 *
 * ONLINE ONLY (R21): offline the screen says so and changes nothing. The server's answer is adopted after every change.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { SANS, Tap } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { AUTHORITY } from '../../../core/session/farmAuthorities';
import type { UseLabourPermissionsResult } from '../../profile/hooks/useLabourPermissions';
import { holds, withAuthority, withoutAuthority } from '../../profile/team/authoritySwitchModel';
import { authorityLabel, authorityCopy } from '../../profile/team/authorityCopy';
import { plannedWorkWords, type ReminderWords } from '../plannedWorkWords';
import {
    fetchReminderSettings, markAlwaysShow, saveReminderChoices, unmarkAlwaysShow,
    type ReminderAudienceName, type ReminderChoices, type ReminderSettingsOutcome, type ReminderSettingsView,
} from './reminderSettingsClient';

type Phase = 'loading' | 'ready' | 'offline' | 'forbidden' | 'failed';

export interface ReminderSettingsPageProps {
    farmId: string | null;
    /** The signed-in person (never offered to himself as someone to give the authority to). */
    callerUserId: string | null;
    /** Only the primary account holder sees and moves "हे कोण बदलू शकतं" (D-26). */
    isPrimaryOwner: boolean;
    /** The owner-tier roster (the one the team page reads); the grant switches read and write through it. Absent for a holder. */
    roster?: UseLabourPermissionsResult | null;
}

const CHOICE_LABEL = (words: ReminderWords, choice: ReminderAudienceName): string =>
    choice === 'MakerAndOwner' ? words.choiceMakerAndOwner : choice === 'PlotTeam' ? words.choicePlotTeam : words.choicePlanners;

export const ReminderSettingsPage: React.FC<ReminderSettingsPageProps> = ({ farmId, callerUserId, isPrimaryOwner, roster }) => {
    const language = useOptionalLanguage()?.language;
    const all = plannedWorkWords(language);
    const words = all.reminders;
    const [phase, setPhase] = useState<Phase>('loading');
    const [settings, setSettings] = useState<ReminderSettingsView | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<'saved' | 'failed' | 'offline' | null>(null);
    const [adding, setAdding] = useState(false);

    const adopt = useCallback((outcome: ReminderSettingsOutcome, onFailure: 'keep' | 'screen'): boolean => {
        if (outcome.kind === 'ok') {
            setSettings(outcome.settings);
            setPhase('ready');
            return true;
        }
        if (onFailure === 'screen') setPhase(outcome.kind);
        return false;
    }, []);

    const load = useCallback(async () => {
        if (!farmId) { setPhase('failed'); return; }
        setPhase('loading');
        adopt(await fetchReminderSettings(farmId), 'screen');
    }, [farmId, adopt]);
    useEffect(() => { void load(); }, [load]);

    /** One change: sent now or not at all (R21). The screen shows what the server answered, and says honestly when nothing changed. */
    const change = async (send: (farm: string) => Promise<ReminderSettingsOutcome>) => {
        if (!farmId || busy) return;
        setBusy(true);
        setNote(null);
        const outcome = await send(farmId);
        const ok = adopt(outcome, 'keep');
        setNote(ok ? 'saved' : outcome.kind === 'offline' ? 'offline' : 'failed');
        setBusy(false);
    };

    if (phase === 'loading') {
        return <p className="m-0 p-4 text-center text-[14px] font-bold text-stone-600" data-testid="reminder-settings-loading">{words.settingsLoading}</p>;
    }
    if (phase === 'offline') {
        // R21: no call was made; nothing was changed.
        return (
            <div className="space-y-3 p-4" data-testid="reminder-settings-offline">
                <p className="m-0 rounded-2xl bg-amber-50 p-3 text-[14.5px] font-bold leading-snug text-amber-900">{words.settingsOffline}</p>
                <Tap onClick={() => void load()} data-testid="reminder-settings-retry" className="min-h-[46px] rounded-full border-2 border-emerald-600 bg-white px-5 text-[15px] font-extrabold text-emerald-800">{words.retry}</Tap>
            </div>
        );
    }
    if (phase === 'forbidden') {
        return <p className="m-0 rounded-2xl bg-stone-50 p-4 text-[14.5px] font-bold text-stone-700" data-testid="reminder-settings-forbidden">{words.settingsForbidden}</p>;
    }
    if (phase === 'failed' || !settings) {
        return (
            <div className="space-y-3 p-4" data-testid="reminder-settings-failed">
                <p className="m-0 rounded-2xl bg-rose-50 p-3 text-[14.5px] font-bold text-rose-800">{words.settingsLoadFailed}</p>
                <Tap onClick={() => void load()} data-testid="reminder-settings-retry" className="min-h-[46px] rounded-full border-2 border-emerald-600 bg-white px-5 text-[15px] font-extrabold text-emerald-800">{words.retry}</Tap>
            </div>
        );
    }

    const rows: { key: keyof ReminderChoices; title: string; current: ReminderAudienceName; choices: readonly ReminderAudienceName[] }[] = [
        { key: 'logRemindersAudience', title: words.catLogs, current: settings.logRemindersAudience, choices: ['MakerAndOwner', 'PlotTeam'] },
        { key: 'ownRemindersAudience', title: words.catOwn, current: settings.ownRemindersAudience, choices: ['MakerAndOwner', 'PlotTeam'] },
        { key: 'scheduleRemindersAudience', title: words.catSchedule, current: settings.scheduleRemindersAudience, choices: ['PlotTeam', 'Planners'] },
    ];
    const marked = new Set(settings.alwaysShow.map(m => m.userId));
    const candidates = settings.members.filter(m => !marked.has(m.userId));
    const nameOf = (displayName: string | null, role: string): string => displayName ?? all.role[role] ?? '';
    const grantRows = isPrimaryOwner && roster?.rows
        ? settings.members.filter(m => m.userId !== callerUserId).map(m => ({ member: m, row: roster.rows!.find(r => r.userId === m.userId) })).filter(x => x.row && x.row.canEditAuthorities === true && Array.isArray(x.row.authorities))
        : [];

    return (
        <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24" style={{ fontFamily: SANS }} data-testid="reminder-settings">
            <p className="m-0 text-[14px] font-semibold leading-snug text-stone-700">{words.settingsHint}</p>
            {note && (
                <p role="status" className={`m-0 rounded-xl px-3 py-2 text-[13.5px] font-extrabold ${note === 'saved' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`} data-testid={`reminder-settings-${note}`}>
                    {note === 'saved' ? words.saved : note === 'offline' ? words.settingsOffline : words.saveFailed}
                </p>
            )}

            {rows.map(row => (
                <section key={row.key} className="space-y-2" data-testid={`reminder-cat-${row.key}`}>
                    <p className="m-0 text-[15px] font-extrabold text-stone-900">{row.title}</p>
                    <div role="group" aria-label={row.title} className="flex flex-wrap gap-2">
                        {row.choices.map(choice => (
                            <Tap key={choice} disabled={busy} aria-pressed={row.current === choice} data-testid={`reminder-choice-${row.key}-${choice}`}
                                onClick={() => { if (row.current !== choice) void change(farm => saveReminderChoices(farm, { [row.key]: choice })); }}
                                className={`min-h-[44px] rounded-full px-4 text-[14.5px] font-extrabold ring-1 disabled:opacity-60 ${row.current === choice ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-stone-800 ring-stone-300'}`}>
                                {CHOICE_LABEL(words, choice)}
                            </Tap>
                        ))}
                    </div>
                </section>
            ))}

            {/* D-24e1: a ShramSafal rule, not a choice - drawn still, with no button. */}
            <p className="m-0 flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-[13.5px] font-bold leading-snug text-stone-700" data-testid="reminder-assigned-locked">
                <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{words.assignedLocked}
            </p>

            <section className="space-y-2" data-testid="reminder-always">
                <p className="m-0 text-[15px] font-extrabold text-stone-900">{words.alwaysTitle}</p>
                {settings.alwaysShow.length === 0
                    ? <p className="m-0 text-[13.5px] font-semibold text-stone-500" data-testid="reminder-always-none">{words.alwaysNone}</p>
                    : (
                        <ul className="m-0 space-y-1.5 p-0">
                            {settings.alwaysShow.map(m => (
                                <li key={m.userId} className="flex list-none items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2" data-testid={`reminder-always-${m.userId}`}>
                                    <span className="text-[14.5px] font-extrabold text-stone-900">{nameOf(m.displayName, settings.members.find(x => x.userId === m.userId)?.role ?? '')}</span>
                                    <Tap disabled={busy} onClick={() => void change(farm => unmarkAlwaysShow(farm, m.userId))} data-testid={`reminder-always-remove-${m.userId}`}
                                        className="min-h-[40px] rounded-full bg-stone-100 px-4 text-[13.5px] font-extrabold text-stone-800 disabled:opacity-60">{words.alwaysRemove}</Tap>
                                </li>
                            ))}
                        </ul>
                    )}
                <Tap onClick={() => setAdding(a => !a)} aria-expanded={adding} data-testid="reminder-always-add"
                    className="min-h-[44px] rounded-full border-2 border-emerald-600 bg-white px-4 text-[14.5px] font-extrabold text-emerald-800">{words.alwaysAdd}</Tap>
                {adding && (
                    candidates.length === 0
                        ? <p className="m-0 text-[13.5px] font-semibold text-stone-500" data-testid="reminder-always-nobody">{words.alwaysNoOne}</p>
                        : (
                            <div className="flex flex-wrap gap-2" data-testid="reminder-always-candidates">
                                {candidates.map(m => (
                                    <Tap key={m.userId} disabled={busy} data-testid={`reminder-always-pick-${m.userId}`}
                                        onClick={() => { setAdding(false); void change(farm => markAlwaysShow(farm, m.userId)); }}
                                        className="min-h-[42px] rounded-full bg-stone-100 px-3.5 text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300 disabled:opacity-60">
                                        {nameOf(m.displayName, m.role)}
                                    </Tap>
                                ))}
                            </div>
                        )
                )}
                <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600" data-testid="reminder-always-exception">{words.alwaysException}</p>
            </section>

            <section className="space-y-2" data-testid="reminder-who">
                <p className="m-0 text-[15px] font-extrabold text-stone-900">{words.whoTitle}</p>
                {isPrimaryOwner ? (
                    <>
                        <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">{words.whoHint}</p>
                        <ul className="m-0 space-y-1.5 p-0">
                            {grantRows.map(({ member, row }) => {
                                const authorities = row!.authorities ?? [];
                                const on = holds(authorities, AUTHORITY.manageReminders);
                                return (
                                    <li key={member.userId} className="list-none">
                                        <button type="button" disabled={roster?.savingUserId === member.userId} aria-pressed={on} data-testid={`reminder-grant-${member.userId}`} data-on={on ? 'yes' : 'no'}
                                            onClick={() => void roster?.setAuthorities(member.userId, on ? withoutAuthority(authorities, AUTHORITY.manageReminders) : withAuthority(authorities, AUTHORITY.manageReminders, null))}
                                            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-2.5 text-left disabled:opacity-60 ${on ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-white'}`}>
                                            <span className="text-[14px] font-bold text-stone-900">{nameOf(member.displayName, member.role)}</span>
                                            <span className={`text-[13px] font-extrabold ${on ? 'text-emerald-800' : 'text-slate-500'}`}>{authorityLabel(authorityCopy(language), AUTHORITY.manageReminders)} · {on ? words.whoYes : words.whoNo}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                ) : (
                    <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600" data-testid="reminder-who-owner-only">{words.whoOwnerOnly}</p>
                )}
            </section>
        </div>
    );
};

export default ReminderSettingsPage;
