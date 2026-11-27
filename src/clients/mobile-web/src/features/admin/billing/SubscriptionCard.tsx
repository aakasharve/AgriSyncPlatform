/**
 * SubscriptionCard — owner-only billing summary for SettingsPage.
 *
 * Shows: plan name, status pill, valid-until date, and — only when a caller wires a billing portal that really
 * opens — a single CTA (Manage billing / Pay now / Renew / Resubscribe) depending on state.
 *
 * Only rendered for PrimaryOwner (plan §4.4 role matrix — billing is
 * an owner-level action; workers never see this).
 *
 * Lane HONESTY-2 (H5), founder rule "we never lie to the farmer": an absent snapshot, or a status this card has no
 * wording for, says "माहिती उपलब्ध नाही" (not known) — it used to read "No active subscription", or a red "Expired"
 * with a "Renew" button, which is a statement about the farmer's money the app could not back. There is no billing
 * portal yet, so no button is drawn unless one is passed in.
 */

import React from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { SubscriptionSnapshotDto } from '../../onboarding/qr/inviteApi';
import { isBillingVisible } from '../../../app/featureFlags';

interface SubscriptionCardProps {
    subscription: SubscriptionSnapshotDto | null | undefined;
    role: string;
    /**
     * A billing portal that really opens. There is none yet — `ProfilePage` used to pass an English "coming soon"
     * alert here, so every button (Pay now, Renew, Start Pro, Manage billing) did nothing but apologise. It passes
     * nothing now, so no button is drawn; one appears only when a caller wires a real handler.
     */
    onManageBilling?: () => void;
}

/** What the card says when it has no subscription answer it can stand behind (P4 / P5). */
export const BILLING_UNKNOWN = 'माहिती उपलब्ध नाही';

interface StatusLook {
    icon: React.ReactNode;
    pillClass: string;
    pillLabel: string;
    cta: string;
    ctaClass: string;
}

/** The statuses the server really sends. Anything else is "not known", never a stand-in for "Expired". */
const CONFIG: Record<string, StatusLook> = {
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

const SubscriptionCard: React.FC<SubscriptionCardProps> = ({ subscription, role, onManageBilling }) => {
    // Repair R1-g 1c (founder, 27 Nov: "Don't show billing card yet for Pilot users") — nothing at all unless the default-off
    // billing switch is on: no box, no "not known", no "coming soon".
    if (!isBillingVisible()) return null;
    if (role !== 'PrimaryOwner') return null;

    // No snapshot, or a status the card has no wording for: "we do not know". The server's answer is the only thing
    // that may say a plan ended, so nothing here guesses "Expired" or "No active subscription".
    const c = subscription && Object.prototype.hasOwnProperty.call(CONFIG, subscription.status) ? CONFIG[subscription.status] : undefined;
    if (!subscription || !c) {
        return (
            <div className="rounded-2xl border border-stone-200 bg-white p-4" data-testid="billing-unknown">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
                        <CreditCard size={20} />
                    </div>
                    <div>
                        <div className="text-xs font-bold tracking-wide text-stone-400">बिलिंग</div>
                        <div className="text-sm font-bold text-stone-700">{BILLING_UNKNOWN}</div>
                    </div>
                </div>
            </div>
        );
    }

    const until = new Date(subscription.validUntilUtc);
    // An unreadable date prints no date line at all, never "Invalid Date".
    const hasDate = !Number.isNaN(until.getTime());
    const dateStr = hasDate ? until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const daysLeft = hasDate ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

    return (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3" data-testid="billing-known">
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
                        {subscription.planCode.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())}
                    </div>
                </div>
            </div>

            {hasDate && (
                <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600" data-testid="billing-until">
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
            )}

            {/* Said only beside a button that can be pressed: with no portal there is nothing to manage yet. */}
            {onManageBilling && (
                <>
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                        फक्त प्राथमिक मालक बिलिंग व्यवस्थापित करू शकतो. · Only the primary owner can manage billing.
                    </p>
                    <button
                        type="button"
                        onClick={onManageBilling}
                        className={`w-full rounded-xl py-2.5 text-sm font-bold transition-colors ${c.ctaClass}`}
                    >
                        {c.cta}
                    </button>
                </>
            )}
        </div>
    );
};

export default SubscriptionCard;
