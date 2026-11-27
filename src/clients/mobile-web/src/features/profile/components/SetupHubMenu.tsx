/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SetupHubMenu — "सेट-अप केंद्र", the hub reached from the header's Setup Hub button.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The founder-approved look (PLR-D9
 * preview `SetupHubPage`): one title, one back, me, "शेत तयार करणं — X पैकी Y पूर्ण" with the next
 * step, then plain groups. Every real row is kept: the setup sections (each with its status and the
 * "?" guide), the farms list, "तुमच्या शेती" (switch / create / join — the SAME `FarmSwitcherSheet`,
 * unchanged), कामगार व हजेरी, पैसे व हिशोब, every settings row (testid `hub-settings-<id>`) and
 * बाहेर पडा. No English doubling. It claims "ओळख पडताळलेली" only when told `verified`.
 * plr-d10 (I17, PLR-D9 O4 / §6 line 100): रेफरल्स is out of the farmer's view — it opened a blank,
 * English page with no back (its route still answers a direct link, now with a मागे).
 */
import React, { useState } from 'react';
import { BarChart3, CheckCircle2, LogOut, MapPin, ShieldCheck, Sprout, UserPlus, Users } from 'lucide-react';
import type { ProfileTab } from '../ProfilePage';
import type { HubStepId } from '../hubSteps';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { FarmSwitcherSheet } from '../../context/components/FarmContextSwitcher';
import FarmsSection from './FarmsSection';
import { Chip, GlassCard, PageBar, RowLink, SANS, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import { AppVersionRow } from '../../appUpdate/AppVersionRow';
import { MyResponsibilities } from '../../relationships/MyResponsibilities';
import { ownsNoFarm, switcherRows } from '../../relationships/relationshipModel';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import type { InvitationLabel } from '../../invitations/personalInvitationClient';
import { TeamFirstStepCard, TeamPendingChip, TEAM_FIRST_WORDS } from './TeamFirstStepCard';
import { hubWords, type HubWords } from '../hubWords';

export interface SetupHelp {
    what: string;
    do: string;
    why: string;
}

export interface HubMenuItem {
    /** The step (row testids `hub-row-<id>` / `hub-open-<id>` / `hub-help-<id>`). */
    id: HubStepId;
    /** The page the row opens (water, motor and power share the one पाणी आणि वीज page). */
    tab: ProfileTab;
    label: string;
    icon: React.ReactNode;
    subtitle?: string;
    done?: boolean;
    /** Not built yet: shows "लवकरच" instead of "बाकी" and is not counted as a setup step. */
    soon?: boolean;
    help?: SetupHelp;
    /**
     * Repair FIX-1 item 10 — a step that MUST be done (the माझी टीम step for the primary owner): its "बाकी" is red. Absent: a
     * step not counted for this person (the row as before, no status).
     */
    mustDo?: boolean;
    /** Repair FIX-1 item 10 — the team step is drawn as the first-setup question card (owner alone, nothing sent). */
    firstCard?: boolean;
}

export interface SetupProgressData {
    done: number;
    total: number;
    percent: number;
    nextId?: HubStepId;
    nextLabel?: string;
}

interface SetupHubMenuProps {
    farmerName: string;
    verified: boolean;
    farmName?: string;
    farms?: MyFarmDto[];
    familyName?: string;
    onOpenFarm?: (farmId: string) => void;
    onAddFarm?: () => void;
    /**
     * spec: owner-oversight-loop (Task 12) — the "तुमच्या शेती" row's farm-switcher data. All four
     * (farms, currentFarmId-or-first, onSwitchFarm, onCreateFarm, onJoinViaQr) are required together;
     * omit any one to hide the row rather than render a control that cannot act.
     */
    currentFarmId?: string;
    onSwitchFarm?: (farmId: string) => void;
    onCreateFarm?: () => void;
    onJoinViaQr?: () => void;
    language?: 'mr' | 'en';
    setupProgress?: SetupProgressData;
    items: HubMenuItem[];
    onSelect: (id: ProfileTab) => void;
    onExit?: () => void;
    onOpenFinance?: () => void;
    onOpenLabour?: () => void;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, MU-11) — the current farm's permanent code, shown
     * on the top card (as the approved preview does). Absent / null = no code from the server: nothing
     * is shown rather than an invented one.
     */
    farmCode?: string | null;
    /**
     * Opens "माझी टीम": owner tier (to manage) and a मुकादम (to look at his crew); never a worker.
     * The row is drawn where the `team` step sits in `items` (repair FIX-1 item 3: inside the sequence).
     */
    onOpenTeam?: () => void;
    /** A मुकादम only looks at the team: the row says "माझ्या टोळीतले लोक". */
    teamViewOnly?: boolean;
    /** People waiting for the owner's answer (from the owner-only roster); 0 = none. */
    teamRequestCount?: number;
    /** Repair FIX-1 item 10 — a choice on the first team card: open the invite sheet with this label chosen. */
    onInviteLabel?: (label: InvitationLabel) => void;
    /** Repair FIX-1 item 10 — "सध्या मी एकटाच शेती पाहतो" on the first team card. */
    onTeamSolo?: () => void;
    settingsItems?: { id: string; label: string; icon: React.ReactNode; subtitle?: string; badge?: React.ReactNode }[];
    onSelectExtra?: (id: string) => void;
    logout: () => void;
}

/** "शेत तयार करणं" — one honest bar over the setup sections. Marathi `X पैकी Y` = Y out of X. Words: `hubWords` (FIX-1 round 1). */
const ProgressCard: React.FC<{ p: SetupProgressData; onNext: () => void; w: HubWords }> = ({ p, onNext, w }) => (
    <GlassCard testId="hub-progress">
        <div className="flex items-baseline justify-between gap-2">
            <p className="m-0 text-[16px] font-extrabold text-stone-900">{w.progressTitle}</p>
            <p className="m-0 text-[15px] font-extrabold text-emerald-800">{w.progressCount(p.total, p.done)}</p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 transition-[width] duration-500" style={{ width: `${p.percent}%` }} />
        </div>
        {p.done < p.total && p.nextLabel ? (
            <Tap onClick={onNext} data-testid="hub-next" rippleColor="rgba(255,255,255,0.35)"
                className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-[15px] font-extrabold text-white shadow">
                {w.next(p.nextLabel)}
            </Tap>
        ) : (
            <p className="m-0 mt-3 flex items-center gap-1.5 text-[15px] font-extrabold text-emerald-800" data-testid="hub-all-done">
                <CheckCircle2 size={18} aria-hidden="true" />{w.allDone}
            </p>
        )}
    </GlassCard>
);

/** One setup section: the row, its status, and a "?" that opens a short plain guide. */
const SetupRow: React.FC<{ item: HubMenuItem; isNext: boolean; onSelect: () => void; w: HubWords }> = ({ item, isNext, onSelect, w }) => {
    const [open, setOpen] = useState(false);
    const badge = item.done ? <Chip tone="green">{w.status.done}</Chip> : item.soon ? <Chip tone="stone">{w.status.soon}</Chip> : <Chip tone="amber">{w.status.pending}</Chip>;
    return (
        <div className={`overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(28,25,23,0.05)] ${isNext ? 'border-emerald-300 ring-2 ring-emerald-200' : 'border-stone-200/80'}`}
            data-testid={`hub-row-${item.id}`}>
            <div className="flex items-center gap-2 py-2.5 pl-3 pr-2.5">
                <Tap onClick={onSelect} data-testid={`hub-open-${item.id}`} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 text-left">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.done ? 'bg-emerald-100 text-emerald-800' : isNext ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600'}`}>{item.icon}</span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-extrabold leading-tight text-stone-900">{item.label}</span>
                        {item.subtitle && <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-stone-600">{item.subtitle}</span>}
                    </span>
                </Tap>
                {badge}
                {item.help && (
                    <Tap aria-label={w.help.aria} aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid={`hub-help-${item.id}`}
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[16px] font-extrabold ${open ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-300'}`}>?</Tap>
                )}
            </div>
            {open && item.help && (
                <div className="mx-3 mb-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                    {([[w.help.what, item.help.what], [w.help.do, item.help.do], [w.help.why, item.help.why]] as [string, string][]).map(([k, v], i) => (
                        <div key={k} className={`flex gap-2.5 ${i > 0 ? 'mt-2.5 border-t border-emerald-100 pt-2.5' : ''}`}>
                            <span className="w-[84px] shrink-0 text-[13px] font-extrabold leading-snug text-emerald-800">{k}</span>
                            <span className="flex-1 text-[14px] font-semibold leading-snug text-stone-700">{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const SetupHubMenu: React.FC<SetupHubMenuProps> = ({
    farmerName, verified, farmName, farms, familyName, onOpenFarm, onAddFarm,
    currentFarmId, onSwitchFarm, onCreateFarm, onJoinViaQr,
    language, setupProgress, items, onSelect, onExit, onOpenFinance, onOpenLabour,
    farmCode, onOpenTeam, teamViewOnly, teamRequestCount = 0, onInviteLabel, onTeamSolo, settingsItems, onSelectExtra, logout,
}) => {
    const [showFarmSwitcher, setShowFarmSwitcher] = useState(false);
    // Repair FIX-1 round 1 (Bug 5): every word of the menu in the app's language (Marathi exactly as before).
    const w = hubWords(language);
    // spec: plr-d10 lane MU-1 - the same relationship read model (/me/context) feeds this sheet's rows as the header's.
    const meContext = useOptionalFarmContext()?.meContext ?? null;

    // spec: owner-oversight-loop (Task 12) — all wired together, or the row does not render at all.
    const farmSwitcherReady = !!(farms && onSwitchFarm && onCreateFarm && onJoinViaQr);
    const farmSwitcherSubtitle = farms && farms.length > 0
        ? w.farmsLine((farms.find(f => f.farmId === currentFarmId) ?? farms[0]).name, farms.length)
        : undefined;

    return (
        <div style={{ fontFamily: SANS }} data-testid="setup-hub">
            <PageBar title={w.title} onBack={onExit} backLabel={w.back} />
            <div className="space-y-3 pb-4">
                <GlassCard testId="hub-me">
                    <div className="flex items-center gap-3">
                        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-[28px] shadow" aria-hidden="true">👨‍🌾</span>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[19px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{farmerName || '—'}</p>
                            {farmName && <p className="m-0 flex items-center gap-1 text-[14px] font-semibold text-stone-600"><MapPin size={15} aria-hidden="true" />{farmName}</p>}
                            {verified && <p className="m-0 mt-0.5 flex items-center gap-1 text-[13px] font-extrabold text-emerald-800" data-testid="hub-verified"><ShieldCheck size={15} aria-hidden="true" />{w.verified}</p>}
                        </div>
                        {/* spec: plr-d7-m1 step 2 (MU-11) — the farm's permanent code, as on the approved hub card. */}
                        {farmCode && (
                            <span className="shrink-0 rounded-xl bg-stone-100 px-2.5 py-1.5 text-center text-[11px] font-bold leading-tight text-stone-600" data-testid="hub-farm-code">
                                {w.farmCode}<br /><b className="text-[13px] tracking-wider text-stone-900">{farmCode}</b>
                            </span>
                        )}
                    </div>
                </GlassCard>

                {setupProgress && <ProgressCard p={setupProgress} w={w} onNext={() => {
                    const next = items.find(it => it.id === setupProgress.nextId);
                    if (next) onSelect(next.tab);
                }} />}

                {/* spec: plr-d10 lane MU-1 - "माझी शेती व जबाबदाऱ्या": one card per relationship, from the one read model only. Not drawn for a
                    single-farm primary owner with nothing waiting (Scenario A). */}
                <MyResponsibilities />

                {/* your farms — each a 7/12 holding; tap to open its own page (FarmsSection, unchanged) */}
                {farms && farms.length > 0 && onOpenFarm && (
                    <FarmsSection farms={farms} familyName={familyName} onOpenFarm={onOpenFarm} onAddFarm={onAddFarm} language={language ?? 'mr'} />
                )}

                <div className="space-y-2" data-testid="hub-farm">
                    <SectionHead title={w.sections.farm} />
                    {items.map(it => {
                        if (it.id !== 'team') return <SetupRow key={it.id} item={it} w={w} isNext={setupProgress?.nextId === it.id} onSelect={() => onSelect(it.tab)} />;
                        // Repair FIX-1 item 10 — the owner alone, nothing sent: the first-setup question card stands in for the row.
                        if (it.firstCard && onInviteLabel && onTeamSolo) {
                            return <TeamFirstStepCard key={it.id} language={language} isNext={setupProgress?.nextId === it.id} onPick={onInviteLabel} onSolo={onTeamSolo} />;
                        }
                        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2, MU-11 / P-4) — "माझी टीम": the team, the farm QR + code,
                        // and the people waiting for the owner's answer. In the sequence since FIX-1 item 3; its पूर्ण / red बाकी
                        // only where it is a counted step (FIX-1 item 10).
                        const status = it.done === true ? <Chip tone="green">{w.status.done}</Chip>
                            : it.mustDo ? <TeamPendingChip label={TEAM_FIRST_WORDS[language === 'en' ? 'en' : 'mr'].pending} /> : null;
                        const requests = teamRequestCount > 0 ? <Chip tone="amber"><UserPlus size={14} aria-hidden="true" />{teamRequestCount}</Chip> : null;
                        return onOpenTeam && (
                            <RowLink key={it.id} testId="hub-team" icon={<Users size={22} aria-hidden="true" />} tone="blue" title={w.team.title}
                                line={teamViewOnly ? w.team.crewLine : teamRequestCount > 0 ? w.team.requests(teamRequestCount) : w.team.hubLine}
                                badge={requests || status ? <span className="flex shrink-0 items-center gap-1">{requests}{status}</span> : undefined}
                                onClick={onOpenTeam} />
                        );
                    })}
                </div>

                {onOpenFinance && (
                    <div className="space-y-2" data-testid="hub-money">
                        <SectionHead title={w.sections.money} />
                        <RowLink testId="hub-finance" icon={<BarChart3 size={22} aria-hidden="true" />} tone="blue" title={w.finance} onClick={onOpenFinance} />
                    </div>
                )}

                {(onOpenLabour || farmSwitcherReady) && (
                    <div className="space-y-2" data-testid="hub-people">
                        <SectionHead title={w.sections.people} />
                        {/* FOUNDER NAMING DECISION (2026-10-16): the section is `कामगार व हजेरी` (door and room agree).
                            The subtitle stays `मजुरी` — Task 7 / 7b honesty deletions stand. */}
                        {onOpenLabour && <RowLink testId="hub-labour" icon={<Users size={22} aria-hidden="true" />} tone="green" title={w.labour} line={w.labourLine} onClick={onOpenLabour} />}
                        {/* `तुमच्या शेती` is copied verbatim from FarmContextSwitcher.tsx — also how a farm is created or joined. */}
                        {farmSwitcherReady && <RowLink testId="hub-farms" icon={<Sprout size={22} aria-hidden="true" />} tone="green" title={w.farms} line={farmSwitcherSubtitle} onClick={() => setShowFarmSwitcher(true)} />}
                    </div>
                )}

                {/* Lane UPD-1 (D-53): the group always shows, because the installed app version always does. */}
                <div className="space-y-2" data-testid="hub-app">
                    <SectionHead title={w.sections.app} />
                    {settingsItems?.map(it => (
                        <RowLink key={it.id} testId={`hub-settings-${it.id}`} icon={it.icon} tone="stone" title={it.label} line={it.subtitle} badge={it.badge} onClick={() => onSelectExtra?.(it.id)} />
                    ))}
                    <AppVersionRow language={language ?? 'mr'} />
                </div>

                <Tap onClick={logout} data-testid="hub-logout" rippleColor="rgba(225,29,72,0.15)"
                    className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-rose-200 bg-white text-[16px] font-extrabold text-rose-700">
                    <LogOut size={19} aria-hidden="true" />{w.logout}
                </Tap>
            </div>

            {/* Farm switcher — reuses the EXISTING `FarmSwitcherSheet` unchanged, the same sheet AppHeader's farm chip opens. */}
            {showFarmSwitcher && farmSwitcherReady && farms && onSwitchFarm && onCreateFarm && onJoinViaQr && (
                <FarmSwitcherSheet
                    farms={farms}
                    currentFarmId={currentFarmId ?? farms[0]?.farmId ?? ''}
                    rows={switcherRows(meContext, currentFarmId ?? farms[0]?.farmId, language)}
                    ownsNoFarm={ownsNoFarm(meContext)}
                    language={language}
                    onClose={() => setShowFarmSwitcher(false)}
                    onSwitch={(farmId) => {
                        onSwitchFarm(farmId);
                        setShowFarmSwitcher(false);
                    }}
                    onCreateFarm={() => {
                        setShowFarmSwitcher(false);
                        onCreateFarm();
                    }}
                    onJoinViaQr={() => {
                        setShowFarmSwitcher(false);
                        onJoinViaQr();
                    }}
                />
            )}
        </div>
    );
};
