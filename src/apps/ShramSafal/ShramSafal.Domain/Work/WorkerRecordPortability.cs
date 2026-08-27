// spec: dfes-companion-2026-07-11 (wave-4.4)
//
// ── THE WORKER-RECORD BOUNDARY. FOUNDER MODEL, 2026-08-17. ──────────────────────────
//
// RULING A (2026-08-17) — NAMES NOW. A worker's real name appears immediately, entered by
// the owner. Nothing is anonymised; worker names ARE the product. The consent question
// sits at the far edge instead: the moment a record would FOLLOW HIM to another farm.
//
// This file used to hold that edge as a BINARY guard — share a farm or you see nothing,
// and one consent flag opened everything. The founder has replaced that concept with a
// three-tier one, in his words:
//
//   "lets say at ARVE Farms Ramesh worked and his work / his accountability is recorded
//    from ARVE Farms owner. But when Patil Farms want to hire Ramesh they must not be
//    able to see what he did at ARVE Farms in exact things — but must be able to see what
//    ARVE Farm reviewed about him. That might be the score, accountability or anything
//    that the ARVE farm owner wants to say. [Plus] Shram Safal generated number of
//    completed tasks or completed field work hours."
//
// So the answer is no longer yes/no. It depends on WHAT is being asked for:
//
//   Tier 1  the farm's operational detail  — never leaves the farm. Consent is irrelevant,
//           because it is not the worker's to give away.
//   Tier 2  the employer's own statement   — leaves only with the WORKER's consent.
//   Tier 3  counts Shram Safal derived     — leaves only with the WORKER's consent.
//
// See <see cref="WorkerRecordTier"/> for what each tier is and why. The one sentence the
// whole design rests on: A REPUTATION BELONGS TO THE WORKER; THE OPERATIONAL RECORD
// BELONGS TO THE FARM.
//
// ── WHY THIS EXISTS AS A FAIL-CLOSED GUARD ──────────────────────────────────────────
//
// Two live read paths already reached past the farm that recorded the work, because both
// authorised on "does the caller share ANY farm with this worker" and then returned data
// scoped to no farm at all:
//
//   * GET /workers/{id}/profile?farmId=...  — farmId is OPTIONAL, and a null farmId asked
//     for a reliability score over EVERY farm he has worked. Nothing ever checked that a
//     supplied farmId was one the caller belongs to either.
//   * GET /workers/{id}/job-cards           — no farm parameter exists at all.
//
// Both are tier 1. They stay sealed, and consent no longer opens them: what a worker may
// license is his standing, never his employer's spray schedule.
//
// It still fails closed. Nothing in this codebase can grant WORKER_RECORD_PORTABILITY
// today — no screen, no endpoint, no row — so every implementation of
// HasWorkerRecordPortabilityConsentAsync answers false and every tier-2/3 read that would
// genuinely leave a farm is refused. Whoever builds the consent surface has to come here
// deliberately; forgetting it denies.
//
// ── FOUNDER RULING, 2026-08-17 — TWO FARMS OF HIS OWN ARE NOT PORTABILITY ────────────
//
// The binary guard treated "one owner, two farms of his own, one worker across both" as a
// cross-farm read and refused it. That was wrong. It is one owner's own record of his own
// work; nothing travels anywhere, because there is nobody else to travel to. Where every
// farm in the read is owned by the caller, the fold is permitted at EVERY tier and is
// marked as not having crossed. That is why the decision now takes the caller's OWNED
// farms separately from the farms he merely belongs to.
//
// ── DO NOT REACH FOR CrossFarmAggregation ───────────────────────────────────────────
//
// ConsentPurpose.CrossFarmAggregation (IConsentEnforcer) is the nearest-looking existing
// toggle and it is the WRONG one. It licenses DE-IDENTIFIED data to improve product
// features for other farmers. De-identified data is exactly what this boundary is not
// about — the whole subject here is data that still names him. Granting that toggle must
// never unlock an identifiable cross-farm record.

namespace ShramSafal.Domain.Work;

/// <summary>
/// The farm boundary a worker's record may not cross, and the tier-dependent conditions
/// under which parts of it may. Founder model, 2026-08-17 — see the file header.
/// </summary>
/// <remarks>
/// Pure decision logic — no repository, no clock, no I/O. Both the tier and the consent
/// fact arrive as parameters, so the rule can be read and tested on its own and so a
/// caller cannot accidentally satisfy it by forgetting to look consent up: there is no
/// overload that omits either.
/// </remarks>
public static class WorkerRecordPortability
{
    /// <summary>
    /// The purpose code a worker must have granted before his tier-2 or tier-3 record may
    /// leave the farm that produced it.
    ///
    /// <para>It is deliberately NOT in the core-consent list on the first-open gate. Core
    /// consent is the farmer's own consent for his own data; this is a DIFFERENT person's
    /// consent for his own standing, and no tap by an owner can supply it.</para>
    ///
    /// <para>Nothing grants this today. There is no screen, no endpoint and no row that can
    /// produce it — which is the intended state, not an oversight.</para>
    ///
    /// <para>It never unlocks <see cref="WorkerRecordTier.FarmOperationalDetail"/>. A
    /// worker cannot consent away his employer's farm records; they were never his.</para>
    /// </summary>
    public const string PortabilityConsentPurposeCode = "WORKER_RECORD_PORTABILITY";

    /// <summary>Stable machine-readable denial reasons. Surfaced on logs and analytics.</summary>
    public static class DenyReasons
    {
        /// <summary>Caller and worker have never shared a farm — not a portability
        /// question at all, just a stranger asking.</summary>
        public const string NoSharedFarm = "no_shared_farm";

        /// <summary>The named farm has no record of this worker, so there is nothing
        /// there to read. Refused at every tier, with or without consent.</summary>
        public const string FarmHoldsNoRecord = "farm_holds_no_record_of_worker";

        /// <summary>Tier 1. The read would carry one farm's operational detail to another
        /// farm. No consent exists that opens this, because the data is the farm's and not
        /// the worker's to license.</summary>
        public const string TierOneNeverTravels = "farm_operational_detail_never_leaves_its_farm";

        /// <summary>Tier 2/3. A request naming no farm asks for a record folding every
        /// farm he has worked. That is the portable artefact itself, and it needs his own
        /// recorded consent.</summary>
        public const string UnscopedRequest = "worker_portability_consent_missing:unscoped_request";

        /// <summary>Tier 2/3. The caller named a farm he is not a member of — carrying this
        /// worker's standing to someone outside the farm that recorded it.</summary>
        public const string ForeignFarmScope = "worker_portability_consent_missing:foreign_farm_scope";
    }

    /// <summary>
    /// The worker's farms whose records this caller may LIST — job cards, rows, anything
    /// where each item stays labelled with the farm it came from.
    ///
    /// <para>Listing is not folding. A caller who belongs to farms A and B reading a list
    /// of his worker's cards at A and at B has crossed nothing: he is already inside both
    /// boundaries and each row stays inside its own. So the answer is the intersection of
    /// the two men's farms.</para>
    ///
    /// <para>For <see cref="WorkerRecordTier.FarmOperationalDetail"/> the intersection is
    /// also the ceiling — consent does not widen it, ever. For tiers 2 and 3 the worker's
    /// own recorded consent widens it to every farm he has worked, which is what
    /// portability means.</para>
    ///
    /// <para>A worker reading his own record is not portability — his record is his.</para>
    /// </summary>
    public static IReadOnlyList<Guid> PermittedFarms(
        WorkerRecordTier tier,
        Guid callerUserId,
        Guid workerUserId,
        IReadOnlyCollection<Guid> callerFarmIds,
        IReadOnlyCollection<Guid> workerFarmIds,
        bool workerConsentedToPortability)
    {
        ArgumentNullException.ThrowIfNull(callerFarmIds);
        ArgumentNullException.ThrowIfNull(workerFarmIds);

        var workerFarms = workerFarmIds.Distinct().ToArray();

        // His own record, or a record he has licensed to travel.
        if (callerUserId == workerUserId || MayTravel(tier, workerConsentedToPortability))
        {
            return workerFarms;
        }

        // Everyone else sees only where their farms and his overlap. This is the
        // narrowing that makes the guard fail closed: the default answer is the
        // intersection, never the union.
        var callerFarms = callerFarmIds.Distinct().ToHashSet();
        return workerFarms.Where(callerFarms.Contains).ToArray();
    }

    /// <summary>
    /// The farms a read may FOLD into one figure — a reliability score, a total, a count.
    ///
    /// <para>Folding is the strict case, because the output no longer says which farm it
    /// came from. Two farms folded into one number is a portable reputation even when the
    /// rows behind it were each innocuous. So this demands one named farm and refuses to
    /// aggregate, with three exceptions:</para>
    ///
    /// <list type="bullet">
    ///   <item>the worker reading his own record — it is his;</item>
    ///   <item>the caller owning every farm in the fold — founder ruling, 2026-08-17: two
    ///   farms of his own are one owner's own record, not portability;</item>
    ///   <item>tiers 2 and 3 with the worker's own recorded consent — that is precisely
    ///   what he licensed.</item>
    /// </list>
    ///
    /// <para><paramref name="callerOwnedFarmIds"/> must be the farms the caller OWNS, not
    /// the farms he belongs to. Passing the membership list here would let a mukadam fold
    /// two owners' records together and call it his own.</para>
    /// </summary>
    public static WorkerRecordAccess DecideAggregateScope(
        WorkerRecordTier tier,
        Guid callerUserId,
        Guid workerUserId,
        IReadOnlyCollection<Guid> callerFarmIds,
        IReadOnlyCollection<Guid> callerOwnedFarmIds,
        IReadOnlyCollection<Guid> workerFarmIds,
        Guid? requestedFarmId,
        bool workerConsentedToPortability)
    {
        ArgumentNullException.ThrowIfNull(callerFarmIds);
        ArgumentNullException.ThrowIfNull(callerOwnedFarmIds);
        ArgumentNullException.ThrowIfNull(workerFarmIds);

        var workerFarms = workerFarmIds.Distinct().ToArray();
        var isSelf = callerUserId == workerUserId;

        // A farm that never employed him holds no record of him. Nothing to license and
        // nothing to return — refused at every tier whatever the consent state says.
        if (requestedFarmId is { } named && !workerFarms.Contains(named))
        {
            return WorkerRecordAccess.Deny(DenyReasons.FarmHoldsNoRecord);
        }

        // 1. His own record. Scoped or whole, it is his to read.
        if (isSelf)
        {
            return WorkerRecordAccess.Allow(
                requestedFarmId is { } own ? [own] : workerFarms, crossedFarmBoundary: false);
        }

        // 2. A stranger. Preserves the pre-existing 403 rather than inventing a new one,
        //    and no consent opens it: portability licenses a record to travel between the
        //    farms he actually works, not to become a public reputation lookup any account
        //    can query by user id.
        var callerFarms = callerFarmIds.Distinct().ToHashSet();
        var shared = workerFarms.Where(callerFarms.Contains).ToArray();
        if (shared.Length == 0)
        {
            return WorkerRecordAccess.Deny(DenyReasons.NoSharedFarm);
        }

        var mayTravel = MayTravel(tier, workerConsentedToPortability);

        if (requestedFarmId is null)
        {
            // 3. Work out what he could read with NO consent at all, first. Two things
            //    qualify, and both are "one farm's own record of its own work":
            //
            //    (a) exactly one shared farm — NARROW rather than refuse. An owner or
            //        mukadam opening a worker's profile without a farm id is the ordinary
            //        product flow (the CEI end-to-end lifecycle does exactly this), and the
            //        honest answer is that farm. Refusing it would make the guard a bug
            //        wearing a boundary's clothes.
            //
            //    (b) FOUNDER RULING, 2026-08-17 — every shared farm is one the caller OWNS.
            //        Folding them is one owner reading his own record of his own worker;
            //        nothing leaves anywhere, because there is nobody else for it to leave
            //        to. Permitted at every tier, tier 1 included. Deliberately
            //        all-or-nothing: if he owns farm A but is merely a mukadam on farm B,
            //        folding A and B mixes two owners' records and is not his own.
            var owned = callerOwnedFarmIds.Distinct().ToHashSet();
            IReadOnlyList<Guid>? withoutConsent =
                shared.Length == 1 ? [shared[0]]
                : shared.All(owned.Contains) ? shared
                : null;

            // 4. His consent, where the tier allows it to matter, widens the read to every
            //    farm he has worked — that is what portability means, and it is the founder's
            //    Patil-Farms case: a caller who shares ONE farm with him still gets the
            //    other employers' word, because the worker said he could.
            //
            //    CrossedFarmBoundary is true only when consent actually bought something.
            //    Where he was already entitled to the whole set (his own two farms), consent
            //    is redundant and nothing crossed — recording a crossing there would make
            //    the flag useless as an audit signal.
            if (mayTravel)
            {
                var crossed = withoutConsent is null || workerFarms.Length > withoutConsent.Count;
                return WorkerRecordAccess.Allow(workerFarms, crossedFarmBoundary: crossed);
            }

            return withoutConsent is not null
                ? WorkerRecordAccess.Allow(withoutConsent, crossedFarmBoundary: false)
                : WorkerRecordAccess.Deny(
                    tier == WorkerRecordTier.FarmOperationalDetail
                        ? DenyReasons.TierOneNeverTravels
                        : DenyReasons.UnscopedRequest);
        }

        var scope = requestedFarmId.Value;

        // 5. One farm, shared by both. The ordinary case and the product working as
        //    designed: the owner sees his own farm's record of his own worker, under that
        //    worker's real name. RULING A — no worker consent is required here, and asking
        //    for one would be asking permission to run the farm.
        if (shared.Contains(scope))
        {
            return WorkerRecordAccess.Allow([scope], crossedFarmBoundary: false);
        }

        // 6. A farm the caller is not in. His record would be leaving the farm that
        //    recorded it, for someone who was not there. For tier 1 that is simply the
        //    end of the road. For tiers 2 and 3 it is his consent, or nothing.
        if (mayTravel)
        {
            return WorkerRecordAccess.Allow([scope], crossedFarmBoundary: true);
        }

        return WorkerRecordAccess.Deny(
            tier == WorkerRecordTier.FarmOperationalDetail
                ? DenyReasons.TierOneNeverTravels
                : DenyReasons.ForeignFarmScope);
    }

    /// <summary>
    /// Whether the worker's recorded consent is even capable of opening this tier.
    ///
    /// <para>Tier 1 is the whole reason this is a method rather than a bare
    /// <c>&amp;&amp;</c>: the farm's operational detail is not the worker's to license, so
    /// his consent is not merely absent there — it is not a relevant fact.</para>
    /// </summary>
    private static bool MayTravel(WorkerRecordTier tier, bool workerConsentedToPortability)
        => tier != WorkerRecordTier.FarmOperationalDetail && workerConsentedToPortability;
}

/// <summary>
/// The outcome of a worker-record access decision.
/// </summary>
/// <remarks>
/// <see cref="CrossedFarmBoundary"/> is the invariant worth asserting in tests: it is true
/// only where recorded worker consent authorised the crossing, on a tier that consent can
/// open. If it is ever true on a tier-1 decision, or on any decision made with
/// <c>workerConsentedToPortability: false</c>, the boundary has been breached.
/// </remarks>
public sealed record WorkerRecordAccess
{
    private WorkerRecordAccess(
        bool isAllowed,
        string? denyReason,
        IReadOnlyList<Guid> permittedFarmIds,
        bool crossedFarmBoundary)
    {
        IsAllowed = isAllowed;
        DenyReason = denyReason;
        PermittedFarmIds = permittedFarmIds;
        CrossedFarmBoundary = crossedFarmBoundary;
    }

    public bool IsAllowed { get; }

    /// <summary>Stable reason string; null on an allow. See <see cref="WorkerRecordPortability.DenyReasons"/>.</summary>
    public string? DenyReason { get; }

    /// <summary>
    /// The farms whose records the read may touch. <b>Empty on a denial, and never empty
    /// on an allow</b> — so a caller that passes this straight to a repository cannot
    /// accidentally express "no filter, every farm" the way a null scope once did.
    /// </summary>
    public IReadOnlyList<Guid> PermittedFarmIds { get; }

    /// <summary>True only when recorded worker consent authorised leaving the farm.</summary>
    public bool CrossedFarmBoundary { get; }

    internal static WorkerRecordAccess Allow(
        IReadOnlyList<Guid> permittedFarmIds, bool crossedFarmBoundary)
    {
        ArgumentNullException.ThrowIfNull(permittedFarmIds);
        if (permittedFarmIds.Count == 0)
        {
            // An allow over no farms would read downstream as "unfiltered". Nothing in the
            // decision tree can produce one; this is here so that if something ever does,
            // it fails loudly here rather than quietly widening a query.
            throw new ArgumentException(
                "An allowed worker-record read must name at least one farm.",
                nameof(permittedFarmIds));
        }

        return new WorkerRecordAccess(true, null, permittedFarmIds, crossedFarmBoundary);
    }

    internal static WorkerRecordAccess Deny(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return new WorkerRecordAccess(false, reason, [], false);
    }
}
