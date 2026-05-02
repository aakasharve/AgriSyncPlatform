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

interface FarmContextSwitcherProps {
    farms: MyFarmDto[];
    currentFarmId: string | null;
    onSwitch: (farmId: string) => void;
    onCreateFarm: () => void;
    onJoinViaQr: () => void;
    /** Compact variant used in the top app bar */
    compact?: boolean;
}

const roleStyle = (role: string) => {
    switch (role) {
        case 'PrimaryOwner':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'SecondaryOwner':
            return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'Mukadam':
            return 'bg-orange-50 text-orange-700 border-orange-200';
        default:
            return 'bg-stone-100 text-stone-600 border-stone-200';
    }
};

const roleLabel = (role: string) => {
    switch (role) {
        case 'PrimaryOwner': return 'मालक / Owner';
        case 'SecondaryOwner': return 'सहमालक / Co-owner';
        case 'Mukadam': return 'मुकादम / Mukadam';
        case 'Worker': return 'कामगार / Worker';
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

interface FarmSwitcherSheetProps {
    farms: MyFarmDto[];
    currentFarmId: string;
    onClose: () => void;
    onSwitch: (farmId: string) => void;
    onCreateFarm: () => void;
    onJoinViaQr: () => void;
}

const FarmSwitcherSheet: React.FC<FarmSwitcherSheetProps> = ({
    farms,
    currentFarmId,
    onClose,
    onSwitch,
    onCreateFarm,
    onJoinViaQr,
}) => {
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
                    aria-label="Close"
                    className="absolute right-3 top-3 rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                >
                    <X size={16} />
                </button>

                <div className="px-6 pb-6 pt-8">
                    <div className="text-center">
                        <h2 className="font-display text-2xl font-black text-stone-900">
                            तुमच्या शेती
                        </h2>
                        <p className="mt-0.5 text-sm font-semibold text-stone-500">
                            Your farms · {farms.length}
                        </p>
                    </div>

                    <div className="mt-5 space-y-2">
                        {farms.map(farm => {
                            const isCurrent = farm.farmId === currentFarmId;
                            return (
                                <button
                                    key={farm.farmId}
                                    type="button"
                                    onClick={() => onSwitch(farm.farmId)}
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
                                            <div className="truncate font-bold text-stone-900">{farm.name}</div>
                                            {isCurrent && <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${roleStyle(farm.role)}`}>
                                                {roleLabel(farm.role)}
                                            </span>
                                            {farm.farmCode && (
                                                <span className="font-mono text-[10px] font-bold tracking-widest text-stone-400">
                                                    {farm.farmCode}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={onCreateFarm}
                            className="flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-700 hover:border-emerald-300"
                        >
                            <Plus size={15} />
                            शेती तयार करा
                        </button>
                        <button
                            type="button"
                            onClick={onJoinViaQr}
                            className="flex items-center justify-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-bold text-stone-700 hover:border-stone-300"
                        >
                            <QrCode size={15} />
                            QR ने जोडा
                        </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[10px] font-semibold text-stone-400">
                        <div>Create farm</div>
                        <div>Join via QR</div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default FarmContextSwitcher;
