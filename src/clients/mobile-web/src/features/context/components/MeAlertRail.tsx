/**
 * MeAlertRail — server-decided banners for the semi-literate farmer.
 *
 * Reads `meContext.alerts` from /me/context (FarmContext). Each banner is
 * color-coded (info/warn/error), bilingual Marathi + English, dismissible
 * per session.
 *
 * Why server-decided: the client never computes "is plan expiring?" or
 * "does phone need verifying?". The backend decides, frontend renders.
 * This keeps Ramu's flow consistent across devices.
 *
 * Mount: between AppHeader and main content (AppContent.tsx).
 *
 * Alerts handled:
 *   - verify_phone    → green info, OTP not yet completed
 *   - plan_expiring   → yellow warn, farm subscription ends soon
 *   - plan_expired    → red error, farm subscription is past due
 *   - no_farms_yet    → info, user has no farms (skipped — wizard auto-opens)
 */
import React, { useState } from 'react';
import { AlertCircle, Info, ShieldCheck, Clock, X } from 'lucide-react';
import { useFarmContext } from '../../../core/session/FarmContext';
import type { MeAlert, MeAlertKind } from '../../../core/session/MeContextService';

const tone = (severity: MeAlert['severity']): string => {
    switch (severity) {
        case 'info':  return 'bg-emerald-50 text-emerald-800 border-emerald-200';
        case 'warn':  return 'bg-amber-50 text-amber-800 border-amber-200';
        case 'error': return 'bg-rose-50 text-rose-800 border-rose-200';
    }
};

const iconFor = (kind: MeAlertKind) => {
    switch (kind) {
        case 'verify_phone':  return ShieldCheck;
        case 'plan_expiring': return Clock;
        case 'plan_expired':  return AlertCircle;
        case 'no_farms_yet':  return Info;
    }
};

const textFor = (alert: MeAlert, farmName?: string): { mr: string; en: string } => {
    switch (alert.kind) {
        case 'verify_phone':
            return {
                mr: 'तुमचा फोन नंबर तपासून पहा',
                en: 'Verify your phone number',
            };
        case 'plan_expiring': {
            const days = alert.daysLeft ?? 0;
            const farm = farmName ?? '';
            return {
                mr: `${farm ? farm + ' — ' : ''}प्लॅन ${days} दिवसांत संपेल`,
                en: `${farm ? farm + ' — ' : ''}plan ends in ${days} day${days === 1 ? '' : 's'}`,
            };
        }
        case 'plan_expired': {
            const farm = farmName ?? '';
            return {
                mr: `${farm ? farm + ' — ' : ''}प्लॅन संपला आहे`,
                en: `${farm ? farm + ' — ' : ''}plan has expired`,
            };
        }
        case 'no_farms_yet':
            return {
                mr: 'तुमची पहिली शेती तयार करा',
                en: 'Create your first farm',
            };
    }
};

/** Stable per-alert key for dismissal tracking. */
const alertKey = (a: MeAlert): string =>
    a.farmId ? `${a.kind}:${a.farmId}` : a.kind;

const MeAlertRail: React.FC = () => {
    const { meContext } = useFarmContext();
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    const alerts = meContext?.alerts ?? [];
    if (alerts.length === 0) return null;

    // Suppress no_farms_yet — FirstFarmWizard auto-opens for zero-farm users,
    // a banner here would be redundant noise.
    const visible = alerts.filter(
        a => a.kind !== 'no_farms_yet' && !dismissed.has(alertKey(a)),
    );
    if (visible.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 px-2 pt-1">
            {visible.map(alert => {
                const key = alertKey(alert);
                const Icon = iconFor(alert.kind);
                const farm = alert.farmId
                    ? meContext?.farms.find(f => f.farmId === alert.farmId)?.name
                    : undefined;
                const text = textFor(alert, farm);

                return (
                    <div
                        key={key}
                        role="status"
                        className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] shadow-sm ${tone(alert.severity)}`}
                    >
                        <Icon size={16} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-bold">{text.mr}</div>
                            <div className="truncate text-[11px] opacity-80">{text.en}</div>
                        </div>
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() => setDismissed(prev => {
                                const next = new Set(prev);
                                next.add(key);
                                return next;
                            })}
                            className="shrink-0 rounded-md p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default MeAlertRail;
