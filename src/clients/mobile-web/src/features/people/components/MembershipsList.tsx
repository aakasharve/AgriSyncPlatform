/**
 * MembershipsList — "Your farms" section on the profile page.
 *
 * Each row shows: farm name, role chip, farm-code, trial/active dot, and
 * — for memberships the caller can exit — a small destructive "Exit"
 * link. The exit link is hidden for the caller's last-active
 * PrimaryOwner membership, mirroring server-side invariant I3.
 *
 * An exit tap never fires blind: a small confirmation sheet intervenes,
 * with the farm name in bold so the caller can't exit the wrong one.
 */

import React, { useState } from 'react';
import { LogOut, Sprout, Dot, X, AlertTriangle } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { getRoleLabel } from '../../../shared/roles/roleLabels';

interface MembershipsListProps {
    farms: MyFarmDto[];
    /** Set of farmIds the user cannot exit because they would leave the farm without a PrimaryOwner. */
    nonExitableFarmIds?: Set<string>;
    onExit: (farmId: string, farmName: string) => Promise<void>;
}

const MembershipsList: React.FC<MembershipsListProps> = ({ farms, nonExitableFarmIds, onExit }) => {
    const [confirmFarm, setConfirmFarm] = useState<MyFarmDto | null>(null);
    const [isExiting, setIsExiting] = useState(false);
    const [exitError, setExitError] = useState<string | null>(null);

    const handleConfirmedExit = async () => {
        if (!confirmFarm) return;
        setIsExiting(true);
        setExitError(null);
        try {
            await onExit(confirmFarm.farmId, confirmFarm.name);
            setConfirmFarm(null);
        } catch (err) {
            setExitError(err instanceof Error ? err.message : 'Exit failed.');
        } finally {
            setIsExiting(false);
        }
    };

    if (farms.length === 0) return null;

    return (
        <>
            <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="mb-4">
                    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                        <Sprout size={16} className="text-emerald-600" />
                        तुमच्या शेती · Your farms
                    </h3>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                        Farms you are a member of. Tap a farm to switch context from the app header.
                    </p>
                </div>

                <ul className="space-y-2">
                    {farms.map(farm => {
                        const roleLabel = getRoleLabel(farm.role);
                        const canExit = !(nonExitableFarmIds?.has(farm.farmId));
                        const trialing = farm.subscription?.statusCode === 1;
                        const _active = farm.subscription?.statusCode === 2;
                        const paused = farm.subscription
                            ? !farm.subscription.allowsOwnerWrites
                            : false;

                        return (
                            <li
                                key={farm.farmId}
                                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3 transition-colors hover:border-slate-200"
                            >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                                    <Sprout size={18} strokeWidth={2} />
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <div className="truncate font-bold text-slate-900">{farm.name}</div>
                                        {trialing && (
                                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800">
                                                Trial
                                            </span>
                                        )}
                                        {paused && (
                                            <span className="inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-800">
                                                Paid
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1.5">
                                        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${roleLabel.badge}`}>
                                            {roleLabel.display}
                                        </span>
                                        {farm.farmCode && (
                                            <span className="font-mono text-[10px] font-bold tracking-widest text-slate-400">
                                                {farm.farmCode}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {canExit ? (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmFarm(farm)}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-bold text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                                    >
                                        <LogOut size={11} />
                                        बाहेर
                                    </button>
                                ) : (
                                    <span className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
                                        <Dot size={14} className="-ml-1 text-emerald-500" />
                                        एकमेव मालक
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>

            {/* Confirmation sheet */}
            {confirmFarm && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
                    onClick={() => !isExiting && setConfirmFarm(null)}
                >
                    <div
                        className="w-full max-w-sm rounded-t-[2rem] bg-white px-6 pb-6 pt-8 shadow-2xl sm:rounded-3xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
                                <AlertTriangle size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-display text-lg font-black text-stone-900">
                                    शेती सोडायची आहे?
                                </h3>
                                <p className="text-sm font-semibold text-stone-500">
                                    Leave this farm?
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmFarm(null)}
                                disabled={isExiting}
                                className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 disabled:opacity-50"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                            <div className="truncate font-bold text-stone-900">{confirmFarm.name}</div>
                            {confirmFarm.farmCode && (
                                <div className="mt-0.5 font-mono text-xs tracking-widest text-stone-500">
                                    {confirmFarm.farmCode}
                                </div>
                            )}
                        </div>

                        <p className="mt-3 text-xs text-stone-600">
                            तुम्ही या शेतीवर काम करू शकणार नाही. तुमचा इतिहास सुरक्षित राहील.
                        </p>
                        <p className="text-[11px] text-stone-500">
                            You won't be able to log work on this farm. Your past records stay intact.
                        </p>

                        {exitError && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                                {exitError}
                            </div>
                        )}

                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmFarm(null)}
                                disabled={isExiting}
                                className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:border-stone-300 disabled:opacity-50"
                            >
                                नको
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmedExit}
                                disabled={isExiting}
                                className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                            >
                                {isExiting ? 'Exiting…' : 'बाहेर पडा'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default MembershipsList;
