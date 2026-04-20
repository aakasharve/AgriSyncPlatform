/**
 * SubscriptionCard — owner-only billing summary for SettingsPage.
 *
 * Shows: plan name, status pill, valid-until date, and a single CTA
 * (Upgrade / Manage billing / Pay now / Resubscribe) depending on state.
 *
 * Only rendered for PrimaryOwner (plan §4.4 role matrix — billing is
 * an owner-level action; workers never see this).
 */

import React from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { SubscriptionSnapshotDto } from '../../onboarding/qr/inviteApi';

interface SubscriptionCardProps {
    subscription: SubscriptionSnapshotDto | null | undefined;
    role: string;
    onManageBilling?: () => void;
}

const SubscriptionCard: React.FC<SubscriptionCardProps> = ({ subscription, role, onManageBilling }) => {
    if (role !== 'PrimaryOwner') return null;

    if (!subscription) {
        return (
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
                        <CreditCard size={20} />
                    </div>
                    <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-stone-400">बिलिंग · Billing</div>
                        <div className="text-sm font-bold text-stone-700">No active subscription</div>
                    </div>
                </div>
                {onManageBilling && (
                    <button
                        type="button"
                        onClick={onManageBilling}
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
                    >
                        ShramSafal Pro सुरू करा / Start Pro
                    </button>
                )}
            </div>
        );
    }

    const until = new Date(subscription.validUntilUtc);
    const dateStr = until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const daysLeft = Math.max(0, Math.ceil((until.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

    const config: Record<string, {
        icon: React.ReactNode;
        pillClass: string;
        pillLabel: string;
        cta: string;
        ctaClass: string;
    }> = {
        Trialing: {
            icon: <CheckCircle2 size={20} className="text-emerald-600" />,
            pillClass: 'bg-emerald-100 text-emerald-700',
            pillLabel: 'Trial',
            cta: 'Manage billing',
            ctaClass: 'bg-stone-100 text-stone-800 hover:bg-stone-200',
        },
        Active: {
            icon: <CheckCircle2 size={20} className="text-emerald-600" />,
            pillClass: 'bg-emerald-100 text-emerald-700',
            pillLabel: 'Active',
            cta: 'Manage billing',
            ctaClass: 'bg-stone-100 text-stone-800 hover:bg-stone-200',
        },
        PastDue: {
            icon: <AlertTriangle size={20} className="text-amber-600" />,
            pillClass: 'bg-amber-100 text-amber-700',
            pillLabel: 'Payment due',
            cta: 'Pay now',
            ctaClass: 'bg-amber-600 text-white hover:bg-amber-700',
        },
        Expired: {
            icon: <XCircle size={20} className="text-rose-600" />,
            pillClass: 'bg-rose-100 text-rose-700',
            pillLabel: 'Expired',
            cta: 'Renew',
            ctaClass: 'bg-rose-600 text-white hover:bg-rose-700',
        },
        Canceled: {
            icon: <XCircle size={20} className="text-rose-600" />,
            pillClass: 'bg-rose-100 text-rose-700',
            pillLabel: 'Cancelled',
            cta: 'Resubscribe',
            ctaClass: 'bg-rose-600 text-white hover:bg-rose-700',
        },
        Suspended: {
            icon: <XCircle size={20} className="text-stone-500" />,
            pillClass: 'bg-stone-100 text-stone-600',
            pillLabel: 'Suspended',
            cta: 'Contact support',
            ctaClass: 'bg-stone-600 text-white hover:bg-stone-700',
        },
    };
    const c = config[subscription.status] ?? config['Expired'];

    return (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-50">
                    {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="text-xs font-bold uppercase tracking-wide text-stone-400">बिलिंग · Billing</div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${c.pillClass}`}>
                            {c.pillLabel}
                        </span>
                    </div>
                    <div className="text-sm font-bold text-stone-800 truncate">
                        {subscription.planCode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                </div>
            </div>

            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                {subscription.allowsOwnerWrites ? (
                    <>
                        Valid until <span className="font-bold text-stone-800">{dateStr}</span>
                        {daysLeft <= 14 && daysLeft > 0 && (
                            <span className="ml-1 text-amber-700 font-semibold">({daysLeft} day{daysLeft === 1 ? '' : 's'} left)</span>
                        )}
                    </>
                ) : (
                    <>Ended <span className="font-bold text-stone-800">{dateStr}</span></>
                )}
            </div>

            <p className="text-[10px] text-stone-400 leading-relaxed">
                फक्त प्राथमिक मालक बिलिंग व्यवस्थापित करू शकतो. · Only the primary owner can manage billing.
            </p>

            {onManageBilling && (
                <button
                    type="button"
                    onClick={onManageBilling}
                    className={`w-full rounded-xl py-2.5 text-sm font-bold transition-colors ${c.ctaClass}`}
                >
                    {c.cta}
                </button>
            )}
        </div>
    );
};

export default SubscriptionCard;
