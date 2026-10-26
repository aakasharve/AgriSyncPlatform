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
import { BarChart3, CheckCircle2, LogOut, MapPin, ShieldCheck, Sprout, Users } from 'lucide-react';
import type { ProfileTab } from '../ProfilePage';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { FarmSwitcherSheet } from '../../context/components/FarmContextSwitcher';
import FarmsSection from './FarmsSection';
import { Chip, GlassCard, PageBar, RowLink, SANS, SectionHead, Tap } from '../../../shared/components/ui/placeUi';

export interface SetupHelp {
    what: string;
    do: string;
    why: string;
}

export interface HubMenuItem {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    subtitle?: string;
    done?: boolean;
    /** Not built yet: shows "लवकरच" instead of "बाकी" and is not counted as a setup step. */
    soon?: boolean;
    help?: SetupHelp;
}

export interface SetupProgressData {
    done: number;
    total: number;
    percent: number;
    nextId?: ProfileTab;
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
    settingsItems?: { id: string; label: string; icon: React.ReactNode; subtitle?: string; badge?: React.ReactNode }[];
    onSelectExtra?: (id: string) => void;
    logout: () => void;
}

/** "शेत तयार करणं" — one honest bar over the setup sections. Marathi `X पैकी Y` = Y out of X. */
const ProgressCard: React.FC<{ p: SetupProgressData; onNext: () => void }> = ({ p, onNext }) => (
    <GlassCard testId="hub-progress">
        <div className="flex items-baseline justify-between gap-2">
            <p className="m-0 text-[16px] font-extrabold text-stone-900">शेत तयार करणं</p>
            <p className="m-0 text-[15px] font-extrabold text-emerald-800">{p.total} पैकी {p.done} पूर्ण</p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 transition-[width] duration-500" style={{ width: `${p.percent}%` }} />
        </div>
        {p.done < p.total && p.nextLabel ? (
            <Tap onClick={onNext} data-testid="hub-next" rippleColor="rgba(255,255,255,0.35)"
                className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-[15px] font-extrabold text-white shadow">
                पुढचं: {p.nextLabel}
            </Tap>
        ) : (
            <p className="m-0 mt-3 flex items-center gap-1.5 text-[15px] font-extrabold text-emerald-800" data-testid="hub-all-done">
                <CheckCircle2 size={18} aria-hidden="true" />सगळं पूर्ण! छान काम.
            </p>
        )}
    </GlassCard>
);

/** One setup section: the row, its status, and a "?" that opens a short plain guide. */
const SetupRow: React.FC<{ item: HubMenuItem; isNext: boolean; onSelect: () => void }> = ({ item, isNext, onSelect }) => {
    const [open, setOpen] = useState(false);
    const badge = item.done ? <Chip tone="green">पूर्ण</Chip> : item.soon ? <Chip tone="stone">लवकरच</Chip> : <Chip tone="amber">बाकी</Chip>;
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
                    <Tap aria-label="मदत" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid={`hub-help-${item.id}`}
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[16px] font-extrabold ${open ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-300'}`}>?</Tap>
                )}
            </div>
            {open && item.help && (
                <div className="mx-3 mb-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                    {([['काय आहे', item.help.what], ['काय करायचं', item.help.do], ['का?', item.help.why]] as [string, string][]).map(([k, v], i) => (
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
    language, setupProgress, items, onSelect, onExit, onOpenFinance, onOpenLabour, settingsItems, onSelectExtra, logout,
}) => {
    const [showFarmSwitcher, setShowFarmSwitcher] = useState(false);

    // spec: owner-oversight-loop (Task 12) — all wired together, or the row does not render at all.
    const farmSwitcherReady = !!(farms && onSwitchFarm && onCreateFarm && onJoinViaQr);
    const farmSwitcherSubtitle = farms && farms.length > 0
        ? `${(farms.find(f => f.farmId === currentFarmId) ?? farms[0]).name} · ${farms.length} शेती`
        : undefined;

    return (
        <div style={{ fontFamily: SANS }} data-testid="setup-hub">
            <PageBar title="सेट-अप केंद्र" onBack={onExit} />
            <div className="space-y-3 pb-4">
                <GlassCard testId="hub-me">
                    <div className="flex items-center gap-3">
                        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-[28px] shadow" aria-hidden="true">👨‍🌾</span>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[19px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{farmerName || '—'}</p>
                            {farmName && <p className="m-0 flex items-center gap-1 text-[14px] font-semibold text-stone-600"><MapPin size={15} aria-hidden="true" />{farmName}</p>}
                            {verified && <p className="m-0 mt-0.5 flex items-center gap-1 text-[13px] font-extrabold text-emerald-800" data-testid="hub-verified"><ShieldCheck size={15} aria-hidden="true" />ओळख पडताळलेली</p>}
                        </div>
                    </div>
                </GlassCard>

                {setupProgress && <ProgressCard p={setupProgress} onNext={() => setupProgress.nextId && onSelect(setupProgress.nextId)} />}

                {/* your farms — each a 7/12 holding; tap to open its own page (FarmsSection, unchanged) */}
                {farms && farms.length > 0 && onOpenFarm && (
                    <FarmsSection farms={farms} familyName={familyName} onOpenFarm={onOpenFarm} onAddFarm={onAddFarm} language={language ?? 'mr'} />
                )}

                <div className="space-y-2" data-testid="hub-farm">
                    <SectionHead title="माझं शेत" />
                    {items.map(it => (
                        <SetupRow key={it.id} item={it} isNext={setupProgress?.nextId === it.id} onSelect={() => onSelect(it.id)} />
                    ))}
                </div>

                {onOpenFinance && (
                    <div className="space-y-2" data-testid="hub-money">
                        <SectionHead title="पैसे" />
                        <RowLink testId="hub-finance" icon={<BarChart3 size={22} aria-hidden="true" />} tone="blue" title="पैसे व हिशोब" onClick={onOpenFinance} />
                    </div>
                )}

                {(onOpenLabour || farmSwitcherReady) && (
                    <div className="space-y-2" data-testid="hub-people">
                        <SectionHead title="माणसं आणि शेती" />
                        {/* FOUNDER NAMING DECISION (2026-10-16): the section is `कामगार व हजेरी` (door and room agree).
                            The subtitle stays `मजुरी` — Task 7 / 7b honesty deletions stand. */}
                        {onOpenLabour && <RowLink testId="hub-labour" icon={<Users size={22} aria-hidden="true" />} tone="green" title="कामगार व हजेरी" line="मजुरी" onClick={onOpenLabour} />}
                        {/* `तुमच्या शेती` is copied verbatim from FarmContextSwitcher.tsx — also how a farm is created or joined. */}
                        {farmSwitcherReady && <RowLink testId="hub-farms" icon={<Sprout size={22} aria-hidden="true" />} tone="green" title="तुमच्या शेती" line={farmSwitcherSubtitle} onClick={() => setShowFarmSwitcher(true)} />}
                    </div>
                )}

                {settingsItems && settingsItems.length > 0 && (
                    <div className="space-y-2" data-testid="hub-app">
                        <SectionHead title="अ‍ॅप" />
                        {settingsItems.map(it => (
                            <RowLink key={it.id} testId={`hub-settings-${it.id}`} icon={it.icon} tone="stone" title={it.label} line={it.subtitle} badge={it.badge} onClick={() => onSelectExtra?.(it.id)} />
                        ))}
                    </div>
                )}

                <Tap onClick={logout} data-testid="hub-logout" rippleColor="rgba(225,29,72,0.15)"
                    className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-rose-200 bg-white text-[16px] font-extrabold text-rose-700">
                    <LogOut size={19} aria-hidden="true" />बाहेर पडा
                </Tap>
            </div>

            {/* Farm switcher — reuses the EXISTING `FarmSwitcherSheet` unchanged, the same sheet AppHeader's farm chip opens. */}
            {showFarmSwitcher && farmSwitcherReady && farms && onSwitchFarm && onCreateFarm && onJoinViaQr && (
                <FarmSwitcherSheet
                    farms={farms}
                    currentFarmId={currentFarmId ?? farms[0]?.farmId ?? ''}
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
