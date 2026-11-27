/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S7; drawing V4-B; contract 2.4) - a farm's own "शेताची ओळख" page, opened from
 * the hub's farm card or the farms list. It takes over the FARM parts of the old identity page, unchanged in behaviour:
 *   - the boundary and weather block (its English words now Marathi in Marathi mode: "Redraw", "Farm boundary drawn", "Weather pending",
 *     "Draw Farm Boundary"), drawn only for a seat the server lets change the farm's setup, as before;
 *   - the entitlement banner, the memberships list, the waiting requests, and the door to "माझी टीम".
 * The PERSON parts moved to the hub's "माझी ओळख" card; the page's English "Log Out" went (a true double of the hub's "बाहेर पडा").
 * Below them, the V4-B land and 7/12 shells (owner and co-owner only, nothing stored).
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Cloud, MapPin, Sprout, Users } from 'lucide-react';
import EntitlementBanner, { type SubscriptionSnapshotView } from '../../admin/billing/EntitlementBanner';
import MembershipsList from '../../people/components/MembershipsList';
import PendingJoinRequests from '../../onboarding/components/PendingJoinRequests';
import type { FarmDetailsDto, MyFarmDto } from '../../onboarding/qr/inviteApi';
import { GlassCard, RowLink } from '../../../shared/components/ui/placeUi';
import { isOwnerTierRole } from '../helpers/teamRoster';
import { hubWords } from '../hubWords';
import { LandShells } from './LandShells';
import { farmPageWords, type FarmPageWords } from './landShellWords';

export interface FarmIdentityPageProps {
    language: 'mr' | 'en';
    myFarm: { farmId: string; name: string; role: string; subscription: SubscriptionSnapshotView | null } | null;
    farmCode: string | null;
    myMemberships: MyFarmDto[];
    pendingSeats?: MyFarmDto[];
    farmDetails: FarmDetailsDto | null;
    weatherConnected: boolean;
    connectingWeather: boolean;
    /** The weather problem's kind (`useFarmAdminState`): 'providerNotConfigured' | 'centreMissing' | 'failed'. */
    connectError: string | null;
    handleConnectWeather: () => void;
    setShowFarmBoundary: (v: boolean) => void;
    /** lane 2b: drawing the boundary is "edit farm setup"; without it only the finished state shows, with no redraw door. */
    canEditFarmSetup?: boolean;
    onOpenTeam?: () => void;
    nonExitableFarmIds: Set<string>;
    handleExitMembership: (farmId: string, farmName: string) => Promise<void>;
}

function weatherProblem(w: FarmPageWords, kind: string | null): string | null {
    if (!kind) return null;
    return kind === 'providerNotConfigured' || kind === 'centreMissing' ? w.weatherProblem[kind] : w.weatherProblem.failed;
}

const BoundaryBlock: React.FC<{ w: FarmPageWords } & Pick<FarmIdentityPageProps,
    'farmDetails' | 'weatherConnected' | 'connectingWeather' | 'connectError' | 'handleConnectWeather' | 'setShowFarmBoundary' | 'canEditFarmSetup'>> = ({
    w, farmDetails, weatherConnected, connectingWeather, connectError, handleConnectWeather, setShowFarmBoundary, canEditFarmSetup = true,
}) => {
    const hasBoundary = !!(farmDetails?.canonicalCentreLat != null && farmDetails?.canonicalCentreLng != null);
    const acres = farmDetails?.totalMappedAreaAcres;
    // The server's mapped area (measured from the drawn boundary), shown as it is: never a number of our own (P4).
    const acresText = acres != null ? w.acres(w.digits(Number(acres).toFixed(2))) : '';
    if (!canEditFarmSetup && !(hasBoundary && weatherConnected)) return null;

    if (hasBoundary && weatherConnected) {
        return (
            <div className="flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3" data-testid="farm-boundary-done-weather-on">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 size={18} aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-bold text-emerald-800">{w.boundaryDoneWeatherOn}</p>
                    <p className="m-0 text-xs text-emerald-700/80">{acresText}{w.weatherOnLine}</p>
                </div>
                {canEditFarmSetup && (
                    <button type="button" onClick={() => setShowFarmBoundary(true)} data-testid="farm-boundary-redraw"
                        className="flex-shrink-0 text-xs font-semibold text-emerald-700 underline">{w.redraw}</button>
                )}
            </div>
        );
    }
    if (hasBoundary) {
        return (
            <div className="space-y-3">
                <button type="button" onClick={() => setShowFarmBoundary(true)} data-testid="farm-boundary-done"
                    className="flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 text-left">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><MapPin size={18} aria-hidden="true" /></div>
                    <div className="min-w-0 flex-1">
                        <p className="m-0 flex items-center gap-2 text-sm font-bold text-emerald-800">{w.boundaryDone}<CheckCircle2 size={14} className="text-emerald-500" aria-hidden="true" /></p>
                        <p className="m-0 text-xs text-emerald-700/80">{acresText}{w.tapToRedraw}</p>
                    </div>
                    <ChevronRight size={18} className="flex-shrink-0 text-emerald-400" aria-hidden="true" />
                </button>
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50/40 to-white p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Cloud size={24} aria-hidden="true" /></div>
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-sm font-bold text-emerald-900">{w.connectWeather}</p>
                            <p className="m-0 mt-0.5 text-[11px] leading-relaxed text-emerald-800/70">{w.connectWeatherLine}</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => { void handleConnectWeather(); }} disabled={connectingWeather} data-testid="farm-weather-connect"
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 py-3.5 font-bold text-white shadow-lg disabled:opacity-60">
                        <Cloud size={18} aria-hidden="true" />{connectingWeather ? w.connecting : w.connectNow}
                    </button>
                    {connectError && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-testid="farm-weather-problem">{weatherProblem(w, connectError)}</div>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-3" data-testid="farm-boundary-missing">
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-xs font-bold text-red-800">{w.weatherOff}</p>
                    <p className="m-0 mt-0.5 text-[11px] text-red-700/90">{w.weatherOffLine}</p>
                </div>
            </div>
            <button type="button" onClick={() => setShowFarmBoundary(true)} data-testid="farm-boundary-draw"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-bold text-white shadow-lg">
                <MapPin size={18} aria-hidden="true" />{w.drawBoundary}
            </button>
            <p className="m-0 text-center text-[11px] text-slate-500">{w.drawBoundaryLine}</p>
        </div>
    );
};

export const FarmIdentityPage: React.FC<FarmIdentityPageProps> = props => {
    const { language, myFarm, farmCode, myMemberships, pendingSeats = [], onOpenTeam, nonExitableFarmIds, handleExitMembership } = props;
    const w = farmPageWords(language);
    const team = hubWords(language).team;
    const teamLine = isOwnerTierRole(myFarm?.role) ? team.hubLine : team.crewLine;
    return (
        <div className="space-y-4" data-testid="farm-identity-page">
            <GlassCard testId="farm-page-header">
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500"><Sprout size={16} aria-hidden="true" />{w.cap}</p>
                <p className="m-0 mt-1 text-[21px] font-black leading-tight text-stone-900 [overflow-wrap:anywhere]" data-testid="farm-page-name">{myFarm?.name ?? '—'}</p>
                {farmCode && <p className="m-0 mt-0.5 font-mono text-[15px] font-extrabold tracking-[0.2em] text-stone-600" data-testid="farm-page-code">{farmCode}</p>}
            </GlassCard>

            {myFarm && <BoundaryBlock w={w} {...props} />}

            <LandShells role={myFarm?.role ?? null} language={language} />

            {/* Phase 5 entitlement banner — only for owners with subscription trouble or a trial (behind the billing switch). */}
            {myFarm && <EntitlementBanner subscription={myFarm.subscription} role={myFarm.role} />}

            {myMemberships.length > 0 && (
                <MembershipsList farms={myMemberships} nonExitableFarmIds={nonExitableFarmIds} onExit={handleExitMembership} />
            )}

            {/* A request this person sent that the owner has not answered, or a paused seat: listed so it can be withdrawn. */}
            {pendingSeats.length > 0 && (
                <PendingJoinRequests seats={pendingSeats} onWithdraw={farmId => handleExitMembership(farmId, '')} testId="profile-pending-seats" />
            )}

            {onOpenTeam && (
                <RowLink testId="identity-open-team" icon={<Users size={22} aria-hidden="true" />} tone="blue"
                    title={team.title} line={teamLine} onClick={onOpenTeam} />
            )}
        </div>
    );
};

export default FarmIdentityPage;
