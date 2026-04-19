/**
 * EntitlementBanner — surfaces subscription trouble to the owner.
 *
 * Intent: workers should never see this. Owners whose farm is PastDue /
 * Expired / Canceled / Suspended see a friendly, semi-literate-readable
 * explanation + a single clear action.
 *
 * Data source: the Subscription snapshot that /shramsafal/farms/mine
 * now returns per farm.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface SubscriptionSnapshotView {
    statusCode: number;
    status: string;
    planCode: string;
    validUntilUtc: string;
    allowsOwnerWrites: boolean;
}

interface EntitlementBannerProps {
    subscription: SubscriptionSnapshotView | null | undefined;
    role: string; // "PrimaryOwner" | "SecondaryOwner" | "Worker" | ...
    onManageBilling?: () => void;
}

const EntitlementBanner: React.FC<EntitlementBannerProps> = ({ subscription, role, onManageBilling }) => {
    // Workers never see a billing banner — plan §D6 (visibility preserved).
    if (role !== 'PrimaryOwner' && role !== 'SecondaryOwner') return null;
    if (!subscription) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="flex-1">
                        <div className="text-sm font-bold text-amber-900">
                            सबस्क्रिप्शन नाही / No subscription
                        </div>
                        <p className="mt-0.5 text-xs text-amber-800">
                            Start ShramSafal Pro to unlock daily logs, verification, and AI.
                        </p>
                    </div>
                    {onManageBilling && (
                        <button
                            type="button"
                            onClick={onManageBilling}
                            className="shrink-0 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                        >
                            Start trial
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Trialing + Active — quiet confirmation only. Rendered so owners
    // with a trial running can see the end date.
    if (subscription.allowsOwnerWrites) {
        const until = new Date(subscription.validUntilUtc);
        const daysLeft = Math.max(0, Math.ceil((until.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
        const trialing = subscription.statusCode === 1;
        if (!trialing) return null; // Active subscriptions are silent.

        return (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    <div className="flex-1">
                        <div className="text-sm font-bold text-emerald-900">
                            Trial active · ट्रायल चालू
                        </div>
                        <p className="mt-0.5 text-xs text-emerald-800">
                            {daysLeft === 0 ? 'Trial ends today.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left on your trial.`}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // PastDue / Expired / Canceled / Suspended — rose banner, clear CTA.
    const headlines: Record<string, { mr: string; en: string; detail: string; cta: string }> = {
        PastDue: {
            mr: 'देय बिल',
            en: 'Payment past due',
            detail: 'Logs are read-only until payment clears.',
            cta: 'Pay now',
        },
        Expired: {
            mr: 'सबस्क्रिप्शन संपली',
            en: 'Subscription expired',
            detail: 'Renew to resume daily logs.',
            cta: 'Renew',
        },
        Canceled: {
            mr: 'सबस्क्रिप्शन रद्द',
            en: 'Subscription cancelled',
            detail: 'Your historical data is safe. Resubscribe any time.',
            cta: 'Resubscribe',
        },
        Suspended: {
            mr: 'थांबवलेली',
            en: 'Subscription suspended',
            detail: 'Contact support to restore access.',
            cta: 'Contact support',
        },
    };
    const headline = headlines[subscription.status] ?? headlines['Expired'];

    return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-rose-900 truncate">
                        {headline.mr} · {headline.en}
                    </div>
                    <p className="mt-0.5 text-xs text-rose-800">{headline.detail}</p>
                </div>
                {onManageBilling && (
                    <button
                        type="button"
                        onClick={onManageBilling}
                        className="shrink-0 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                    >
                        {headline.cta}
                    </button>
                )}
            </div>
        </div>
    );
};

export default EntitlementBanner;
