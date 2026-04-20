/**
 * ReferralsPage — owner-only affiliation surface.
 * Fetches referral code from /accounts/{accountId}/affiliation/code on mount.
 * Shows ReferralCard, stats row, and GrowthLedgerList.
 */
import React, { useEffect, useState } from 'react';
import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { getMyFarms } from '../features/onboarding/qr/inviteApi';
import ReferralCard from '../features/affiliation/components/ReferralCard';
import GrowthLedgerList, { type GrowthEventItem } from '../features/affiliation/components/GrowthLedgerList';

const ReferralsPage: React.FC = () => {
    const [referralCode, setReferralCode] = useState<string | null>(null);
    const [stats, setStats] = useState<{ total: number; qualified: number; benefits: number } | null>(null);
    const [events, setEvents] = useState<GrowthEventItem[]>([]);
    const [ownerName, setOwnerName] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const farms = await getMyFarms();
                if (cancelled) return;

                const primaryOwnerFarm = farms.find(f => f.role === 'PrimaryOwner');
                if (!primaryOwnerFarm) {
                    setError('Only the primary owner can access this page.');
                    return;
                }

                // Fetch referral code from Accounts module.
                // Uses the ownerAccountId resolved from the farm context.
                // Note: /me/context will expose ownerAccountId directly in Phase 7.3.1;
                // for now we derive it via the farm's subscription (temporary).
                const me = await agriSyncClient.getCurrentUser() as { ownerAccountId?: string; displayName?: string };
                if (cancelled) return;

                if (!me?.ownerAccountId) {
                    setError('Unable to resolve account. Please try again.');
                    return;
                }

                setOwnerName(me.displayName);

                // Use agriSyncClient so the standard attachAccessToken interceptor
                // fires — avoids the IDOR that a path-param based endpoint would expose.
                if (!cancelled) {
                    const codeData = await agriSyncClient.generateReferralCode();
                    setReferralCode(codeData.code);
                }

                // TODO(Phase 7.3.1): fetch /accounts/{accountId}/affiliation/stats
                // and /accounts/{accountId}/affiliation/events once those endpoints land.
                setStats({ total: 0, qualified: 0, benefits: 0 });
                setEvents([]);
            } catch (e) {
                if (!cancelled) setError('Failed to load referral data. Please try again.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[200px]">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-emerald-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
                <p className="text-sm font-bold text-rose-700">{error}</p>
            </div>
        );
    }

    return (
        <div className="max-w-xl mx-auto px-4 py-6 pb-32 space-y-6">
            <div>
                <h1 className="text-2xl font-display font-black text-stone-800">
                    ShramSafal सह वाढा
                </h1>
                <p className="text-sm text-stone-500 mt-1">Grow with ShramSafal</p>
            </div>

            {referralCode && (
                <ReferralCard code={referralCode} ownerName={ownerName} />
            )}

            {stats && (
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: 'आमंत्रित\nReferred', value: stats.total },
                        { label: 'पात्र\nQualified', value: stats.qualified },
                        { label: 'फायदे\nBenefits', value: stats.benefits },
                    ].map(s => (
                        <div key={s.label} className="rounded-2xl border border-stone-100 bg-white p-4 text-center">
                            <div className="text-2xl font-black text-stone-800">{s.value}</div>
                            <div className="mt-1 text-[10px] font-bold text-stone-400 uppercase tracking-wide whitespace-pre-line leading-tight">
                                {s.label}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-stone-400 mb-3">
                    अलीकडील घटना · Recent Activity
                </h3>
                <GrowthLedgerList events={events} />
            </div>

            <p className="text-[11px] text-stone-400 text-center leading-relaxed px-2">
                रेफरल योग्य ठरल्यावर आणि कामगार ३० दिवस सक्रिय राहिल्यावर फायदे दिले जातील.
                <br />
                Benefits will be credited when referrals qualify and workers remain active for 30 days.
            </p>
        </div>
    );
};

export default ReferralsPage;
