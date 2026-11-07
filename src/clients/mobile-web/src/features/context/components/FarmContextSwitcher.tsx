/**
 * FarmContextSwitcher — the "which farm am I working on" pill + bottom sheet.
 *
 * Placement: top-left of AppHeader (replaces static title).
 *
 * Renders three distinct states:
 *   1. Zero farms   → "+ शेती तयार करा / Create farm" dashed-border CTA.
 *                     Tap opens FirstFarmWizard via onCreateFarm.
 *   2. One farm     → pill with farm name + role chip, no chevron (no
 *                     alternatives).
 *   3. Two+ farms   → pill with chevron. Tap opens bottom sheet listing
 *                     all farms with role chips + last-active. Currently
 *                     selected row has emerald border. Footer has two
 *                     CTAs: Create farm / Join via QR.
 *
 * Data source: the caller passes the farms array, current index, and the
 * three action callbacks. This component doesn't fetch — keeps it
 * trivially testable and reusable on ProfilePage + AppHeader.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Sprout, Plus, QrCode, CheckCircle2, X } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { JOIN_DOOR_LABEL } from '../../onboarding/qr/farmCodeEntry';
import { getRoleLabel } from '../../../shared/roles/roleLabels';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { relationshipCopy, toRelationshipLanguage } from '../../relationships/relationshipCopy';
import type { SwitcherRow } from '../../relationships/relationshipModel';

interface FarmContextSwitcherProps {
    farms: MyFarmDto[];
    currentFarmId: string | null;
    onSwitch: (farmId: string) => void;
    onCreateFarm: () => void;
    onJoinViaQr: () => void;
    /** Compact variant used in the top app bar */
    compact?: boolean;
}

const roleLabel = (role: string) => {
    switch (role) {
        case 'PrimaryOwner':
        case 'SecondaryOwner':
        case 'Mukadam':
        case 'Worker': {
            const l = getRoleLabel(role);
            return `${l.mr} / ${l.en}`;
        }
        default: return role;
    }
};

const FarmContextSwitcher: React.FC<FarmContextSwitcherProps> = ({
    farms,
    currentFarmId,
    onSwitch,
    onCreateFarm,
    onJoinViaQr,
    compact = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    useBackDismiss(isOpen, () => setIsOpen(false));

    // State 1: no farms yet.
    if (farms.length === 0) {
        return (
            <button
                type="button"
                onClick={onCreateFarm}
                className={`group inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-1.5 text-xs font-bold text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-50 ${compact ? '' : 'sm:px-4 sm:py-2 sm:text-sm'}`}
            >
                <Plus size={14} className="shrink-0" />
                <span className="truncate">शेती तयार करा · Create farm</span>
            </button>
        );
    }

    const current = farms.find(f => f.farmId === currentFarmId) ?? farms[0];

    // State 2: one farm — render the pill but disable the dropdown.
    const isSingleFarm = farms.length === 1;

    return (
        <>
            <button
                type="button"
                onClick={() => !isSingleFarm && setIsOpen(true)}
                aria-label={`Current farm: ${current.name}`}
                className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 py-1.5 text-left shadow-sm backdrop-blur-sm transition-colors hover:border-stone-300 ${compact ? '' : 'sm:px-3.5'} ${isSingleFarm ? 'cursor-default' : 'cursor-pointer'}`}
            >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Sprout size={13} strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold leading-tight text-stone-800">
                        {current.name}
                    </div>
                    <div className={`truncate text-[10px] font-semibold leading-tight ${compact ? 'hidden sm:block' : ''} text-stone-500`}>
                        {roleLabel(current.role)}
                    </div>
                </div>
                {!isSingleFarm && (
                    <ChevronDown size={14} className="shrink-0 text-stone-400 transition-transform group-hover:text-stone-600" />
                )}
            </button>

            {isOpen && !isSingleFarm && (
                <FarmSwitcherSheet
                    farms={farms}
                    currentFarmId={current.farmId}
                    onClose={() => setIsOpen(false)}
                    onSwitch={(farmId) => {
                        onSwitch(farmId);
                        setIsOpen(false);
                    }}
                    onCreateFarm={() => {
                        setIsOpen(false);
                        onCreateFarm();
                    }}
                    onJoinViaQr={() => {
                        setIsOpen(false);
                        onJoinViaQr();
                    }}
                />
            )}
        </>
    );
};

export interface FarmSwitcherSheetProps {
    farms: MyFarmDto[];
    currentFarmId: string;
    onClose: () => void;
    onSwitch: (farmId: string) => void;
    onCreateFarm: () => void;
    onJoinViaQr: () => void;
    /**
     * spec: plr-d10 lane MU-1 (MU design §6) - the ONE relationship read model (`/me/context`), as the rows to draw: one per
     * ACTIVE relationship with its farm name, relationship word, scope summary, an expiry only when near, and which is open
     * now. Absent (the context has not answered yet) = the plain farm list, as before. A waiting invitation or request is
     * never a row here (visible is not operational): it is a card in "माझी शेती व जबाबदाऱ्या".
     */
    rows?: SwitcherRow[];
    /** MU-1 - the person owns no farm of his own: the sheet asks "तुमचं स्वतःचं शेत आहे का?" (a worker's line). */
    ownsNoFarm?: boolean;
    /** MU-1 - the person's language ("mr" / "en"); every other value reads Marathi. Passed in, so the sheet needs no language provider. */
    language?: string | null;
}

/**
 * Exported (spec: owner-oversight-loop, §2.1/task-6 brief) so `AppHeader`'s
 * `CanonicalStrip` farm chip can open the SAME sheet — "Only the trigger's
 * shell changes" — by lifting this open/close state up to `AppHeader`,
 * instead of copying this markup into a second sheet. `FarmContextSwitcher`
 * below (the pill + its own internal `isOpen` state) is untouched; this is
 * an additive export, not a behaviour change to the default export.
 *
 * spec: plr-d10 lane MU-1 - one language at a time (Marathi mode shows only Marathi: today's "Your farms · N" English is
 * gone), the whole row is the button, and the rows come from the relationship read model.
 */
export const FarmSwitcherSheet: React.FC<FarmSwitcherSheetProps> = ({
    farms,
    currentFarmId,
    onClose,
    onSwitch,
    onCreateFarm,
    onJoinViaQr,
    rows,
    ownsNoFarm = false,
    language: languageProp = null,
}) => {
    const language = toRelationshipLanguage(languageProp);
    const copy = relationshipCopy(language);
    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    if (typeof document === 'undefined') {
        return null;
    }

    // The rows: the relationship model when /me/context answered, else the plain farm list (name + the role word of /farms/mine).
    const listed: SwitcherRow[] = rows && rows.length > 0
        ? rows
        : farms.map(farm => ({
            farmId: farm.farmId,
            name: farm.name,
            word: roleWord(farm.role, language),
            plots: '',
            until: null,
            current: farm.farmId === currentFarmId,
        }));

    return createPortal(
        <div
            data-testid="farm-switcher-sheet"
            className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-md rounded-t-[2rem] bg-white shadow-2xl sm:rounded-3xl"
                onClick={e => e.stopPropagation()}
            >
                <button
                    type="button"
                    onClick={onClose}
                    data-testid="farm-switcher-close"
                    aria-label={copy.switcher.close}
                    className="absolute right-3 top-3 rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                >
                    <X size={16} />
                </button>

                <div className="px-6 pb-6 pt-8">
                    <div className="text-center">
                        <h2 className="font-display text-2xl font-black text-stone-900" data-testid="farm-switcher-title">
                            {copy.switcher.title}
                        </h2>
                    </div>

                    <div className="mt-5 space-y-2">
                        {listed.map(row => {
                            const isCurrent = row.farmId === currentFarmId || row.current;
                            return (
                                <button
                                    key={row.farmId}
                                    type="button"
                                    data-testid={`farm-switcher-row-${row.farmId}`}
                                    onClick={() => onSwitch(row.farmId)}
                                    className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                                        isCurrent
                                            ? 'border-emerald-400 bg-emerald-50'
                                            : 'border-stone-200 bg-white hover:border-stone-300'
                                    }`}
                                >
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${isCurrent ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600'}`}>
                                        <Sprout size={18} strokeWidth={2} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <div className="truncate font-bold text-stone-900" data-testid="farm-switcher-row-name">{row.name}</div>
                                            {isCurrent && <CheckCircle2 size={14} className="shrink-0 text-emerald-600" aria-hidden="true" data-testid="farm-switcher-row-check" />}
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                            <span className="inline-flex items-center rounded-md border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-[11px] font-bold text-stone-700" data-testid="farm-switcher-row-word">
                                                {row.word}
                                            </span>
                                            {row.plots && (
                                                <span className="text-[12px] font-semibold text-stone-600" data-testid="farm-switcher-row-plots">{row.plots}</span>
                                            )}
                                            {row.until && (
                                                <span className="text-[12px] font-extrabold text-amber-800" data-testid="farm-switcher-row-until">{row.until}</span>
                                            )}
                                        </div>
                                        {isCurrent && (
                                            <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-900" data-testid="farm-switcher-row-current">
                                                {copy.switcher.current}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {ownsNoFarm && (
                        <button
                            type="button"
                            onClick={onCreateFarm}
                            data-testid="farm-switcher-own-farm"
                            className="mt-4 w-full rounded-2xl bg-amber-50 px-3 py-3 text-center text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-200"
                        >
                            {copy.switcher.workerOwnFarm}
                        </button>
                    )}

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={onCreateFarm}
                            className="flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-700 hover:border-emerald-300"
                        >
                            <Plus size={15} />
                            {copy.switcher.createFarm}
                        </button>
                        <button
                            type="button"
                            onClick={onJoinViaQr}
                            className="flex items-center justify-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-bold text-stone-700 hover:border-stone-300"
                        >
                            <QrCode size={15} className="shrink-0" />
                            {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the join door takes the typed farm code too. */}
                            {language === 'en' ? 'Join with a code or QR' : JOIN_DOOR_LABEL}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};

/** The role word of the plain farm list (before /me/context answers): one language only. */
function roleWord(role: string, language: 'mr' | 'en'): string {
    switch (role) {
        case 'PrimaryOwner':
        case 'SecondaryOwner':
        case 'Mukadam':
        case 'Worker': {
            const l = getRoleLabel(role);
            return language === 'en' ? l.en : l.mr;
        }
        default: return role;
    }
}

export default FarmContextSwitcher;
