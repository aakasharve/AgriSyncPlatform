// spec: dfes-companion-2026-07-11 (wave-4.4)
//
// ── THE WORKER-CONSENT BOUNDARY. FOUNDER RULING A, 2026-08-17. ──────────────────────
//
// The consent spec originally said: "do not allow a farm owner's consent to act as
// consent for an identifiable worker... until then, permit only non-identifiable worker
// labels or aggregate worker counts."
//
// That contradicted the standing product decision that worker NAMES ARE THE PRODUCT —
// the identity ladder the whole labour model rests on. Asked three times, the founder
// ruled:
//
//   RULING A — NAMES NOW. A worker's real name appears immediately, entered by the
//   owner. The app works as designed from day one. The consent question moves to the
//   moment the record becomes PORTABLE: when a worker's reliability record would follow
//   him to ANOTHER farm, that is when his own consent is required. Until then it is one
//   farm's own record of its own work.
//
// So this file anonymises NOTHING. There is no "मजूर १" fallback here and none is
// wanted; a farm naming its own workers in its own records is the product working
// correctly. What this file does is draw the line the ruling puts at the far edge of
// that: the point where a name or a reliability number LEAVES the farm that recorded it.
//
// ── WHAT CHANGES AT PORTABILITY ─────────────────────────────────────────────────────
//
// Inside one farm: the owner recorded the work, the owner names the worker, and the
// record describes that farm's own operations. No separate worker consent is required
// and none is asked for.
//
// Across farms: the record stops describing one farm's work and starts describing a
// PERSON — a portable reputation that follows him to the next employer and can cost him
// work he never applied for. That is the worker's own data principal interest, and only
// the worker can license it. It requires HIS recorded consent, not his employer's.
//
// ── WHY THIS EXISTS AS A FAIL-CLOSED GUARD ──────────────────────────────────────────
//
// Nothing in this codebase deliberately publishes a cross-farm worker reputation today.
// But two live read paths ALREADY reach past the farm that recorded the work, because
// both authorise on "does the caller share ANY farm with this worker" and then return
// data scoped to no farm at all:
//
//   * GET /workers/{id}/profile?farmId=...  — farmId is OPTIONAL, and a null farmId
//     asks GetWorkerMetricsAsync for a reliability score over EVERY farm he has worked.
//     Nothing ever checked that a supplied farmId was one the caller belongs to either.
//   * GET /workers/{id}/job-cards           — no farm parameter exists at all; the
//     repository returns every job card assigned to that worker, on any farm.
//
// So the pipe is built even where the water is not yet flowing. This guard sits on it
// and refuses by default, so the day someone finishes a cross-farm reputation feature
// it cannot ship without the worker's consent being recorded first — they will have to
// come here and make <see cref="PortabilityConsentPurposeCode"/> real, and the ruling is
// written above the code they must change.
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
/// The farm boundary a worker's identity and reliability record may not cross without
/// that worker's own recorded consent. Founder ruling A, 2026-08-17 — see the file
/// header for the ruling and why the line sits at portability rather than at naming.
/// </summary>
/// <remarks>
/// Pure decision logic — no repository, no clock, no I/O. The consent fact arrives as a
/// parameter so the rule can be read, tested and reasoned about on its own, and so a
/// caller cannot accidentally satisfy it by forgetting to look consent up: there is no
/// overload that omits it.
/// </remarks>
public static class WorkerRecordPortability
{
    /// <summary>
    /// The purpose code a worker must have granted before his identifiable record may
    /// leave the farm that produced it.
    ///
    /// <para>It is deliberately NOT in the core-consent list on the first-open gate. Core
    /// consent is the farmer's own consent for his own data; this is a DIFFERENT person's
    /// consent for his own reputation, and no tap by an owner can supply it.</para>
    ///
    /// <para>Nothing grants this today. There is no screen, no endpoint and no row that
    /// can produce it — which is the intended state, not an oversight. Ruling A moved the
    /// consent question to portability, and portability is not a feature yet.</para>
    /// </summary>
    public const string PortabilityConsentPurposeCode = "WORKER_RECORD_PORTABILITY";

    /// <summary>Stable machine-readable denial reasons. Surfaced on logs and analytics.</summary>
    public static class DenyReasons
    {
        /// <summary>Caller and worker have never shared a farm — not a portability
        /// question at all, just a stranger asking.</summary>
        public const string NoSharedFarm = "no_shared_farm";

        /// <summary>The named farm has no record of this worker, so there is nothing
        /// there to read. Refused with or without consent.</summary>
        public const string FarmHoldsNoRecord = "farm_holds_no_record_of_worker";

        /// <summary>A request naming no farm asks for a record spanning every farm he has
        /// worked. That is the portable artefact itself.</summary>
        public const string UnscopedRequest = "worker_portability_consent_missing:unscoped_request";

        /// <summary>The caller named a farm he is not a member of — carrying this
        /// worker's record to someone outside the farm that recorded it.</summary>
        public const string ForeignFarmScope = "worker_portability_consent_missing:foreign_farm_scope";
    }

    /// <summary>
    /// The worker's farms whose records this caller may read.
    ///
    /// <para>Never broader than the farms the two actually share, UNLESS the worker has
    /// consented to portability. A worker reading his own record is not portability — his
    /// record is his.</para>
    /// </summary>
    public static IReadOnlyList<Guid> PermittedFarms(
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
        if (callerUserId == workerUserId || workerConsentedToPortability)
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
    /// The single farm a worker's reliability profile may be computed over.
    ///
    /// <para>A reliability score is the portable artefact in its purest form — a number
    /// that says how good he is, detached from any particular day's work. So the profile
    /// path is stricter than the job-card path: it demands ONE named farm, and it refuses
    /// to aggregate across farms at all without the worker's consent.</para>
    ///
    /// <para>Aggregating two farms is treated as portability even when one owner runs
    /// both. Ruling A's test is "one farm's own record of its own work"; two farms is two
    /// farms, and failing closed is the direction the ruling points.</para>
    /// </summary>
    public static WorkerRecordAccess DecideProfileScope(
        Guid callerUserId,
        Guid workerUserId,
        IReadOnlyCollection<Guid> callerFarmIds,
        IReadOnlyCollection<Guid> workerFarmIds,
        Guid? requestedFarmId,
        bool workerConsentedToPortability)
    {
        ArgumentNullException.ThrowIfNull(callerFarmIds);
        ArgumentNullException.ThrowIfNull(workerFarmIds);

        var workerFarms = workerFarmIds.Distinct().ToArray();
        var isSelf = callerUserId == workerUserId;

        // A farm that never employed him holds no record of him. Nothing to license and
        // nothing to return — refused whatever the consent state says.
        if (requestedFarmId is { } named && !workerFarms.Contains(named))
        {
            return WorkerRecordAccess.Deny(DenyReasons.FarmHoldsNoRecord);
        }

        // 1. His own record. Scoped or whole, it is his to read.
        if (isSelf)
        {
            return WorkerRecordAccess.Allow(requestedFarmId, workerFarms, crossedFarmBoundary: false);
        }

        // 2. A stranger. Preserves the pre-existing 403 rather than inventing a new one.
        var shared = PermittedFarms(
            callerUserId, workerUserId, callerFarmIds, workerFarms, workerConsentedToPortability: false);
        if (shared.Count == 0)
        {
            return WorkerRecordAccess.Deny(DenyReasons.NoSharedFarm);
        }

        // 3. No farm named. NARROW rather than refuse — the request is only portable if
        //    it would actually span farms.
        //
        //    An owner or mukadam opening a worker's profile without a farm id is the
        //    ordinary product flow (the E2E lifecycle does exactly this), and where the
        //    two share exactly ONE farm the honest answer is that farm: it is one farm's
        //    own record of its own work, which ruling A permits outright. Refusing it
        //    would have made the guard a bug rather than a boundary.
        //
        //    Two or more shared farms is a different thing — a number computed by folding
        //    his work at one farm into his work at another. That is the portable
        //    reputation, and only his own consent opens it. Consent also widens the read
        //    to every farm he has worked, not merely the shared ones.
        if (requestedFarmId is null)
        {
            if (workerConsentedToPortability)
            {
                return WorkerRecordAccess.Allow(null, workerFarms, crossedFarmBoundary: true);
            }

            return shared.Count == 1
                ? WorkerRecordAccess.Allow(shared[0], [shared[0]], crossedFarmBoundary: false)
                : WorkerRecordAccess.Deny(DenyReasons.UnscopedRequest);
        }

        var scope = requestedFarmId.Value;

        // 4. A farm the caller is not in. His record would be leaving the farm that
        //    recorded it, for someone who was not there. His consent, or nothing.
        if (!shared.Contains(scope))
        {
            return workerConsentedToPortability
                ? WorkerRecordAccess.Allow(scope, [scope], crossedFarmBoundary: true)
                : WorkerRecordAccess.Deny(DenyReasons.ForeignFarmScope);
        }

        // 5. One farm, shared by both. This is the ordinary case and the product working
        //    as designed: the owner sees his own farm's record of his own worker, under
        //    that worker's real name. RULING A — no worker consent is required here, and
        //    asking for one would be asking permission to run the farm.
        return WorkerRecordAccess.Allow(scope, [scope], crossedFarmBoundary: false);
    }
}

/// <summary>
/// The outcome of a worker-record access decision.
/// </summary>
/// <remarks>
/// <see cref="CrossedFarmBoundary"/> is the invariant worth asserting in tests: it is
/// true only where recorded worker consent authorised the crossing. If it is ever true
/// on a decision made with <c>workerConsentedToPortability: false</c>, the boundary has
/// been breached.
/// </remarks>
public sealed record WorkerRecordAccess
{
    private WorkerRecordAccess(
        bool isAllowed,
        string? denyReason,
        Guid? singleFarmScope,
        IReadOnlyList<Guid> permittedFarmIds,
        bool crossedFarmBoundary)
    {
        IsAllowed = isAllowed;
        DenyReason = denyReason;
        SingleFarmScope = singleFarmScope;
        PermittedFarmIds = permittedFarmIds;
        CrossedFarmBoundary = crossedFarmBoundary;
    }

    public bool IsAllowed { get; }

    /// <summary>Stable reason string; null on an allow. See <see cref="WorkerRecordPortability.DenyReasons"/>.</summary>
    public string? DenyReason { get; }

    /// <summary>
    /// The farm the read must be scoped to. Null means "not narrowed to one farm" — only
    /// ever produced for the worker reading his own record, or where
    /// <see cref="CrossedFarmBoundary"/> is true because he consented.
    /// </summary>
    public Guid? SingleFarmScope { get; }

    /// <summary>Farms whose records the caller may see. Empty on a denial.</summary>
    public IReadOnlyList<Guid> PermittedFarmIds { get; }

    /// <summary>True only when recorded worker consent authorised leaving the farm.</summary>
    public bool CrossedFarmBoundary { get; }

    internal static WorkerRecordAccess Allow(
        Guid? singleFarmScope, IReadOnlyList<Guid> permittedFarmIds, bool crossedFarmBoundary)
        => new(true, null, singleFarmScope, permittedFarmIds, crossedFarmBoundary);

    internal static WorkerRecordAccess Deny(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return new WorkerRecordAccess(false, reason, null, [], false);
    }
}
