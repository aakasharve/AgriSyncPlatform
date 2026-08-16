using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Location;

namespace ShramSafal.Domain.Logs;

public sealed class DailyLog : Entity<Guid>
{
    private readonly List<LogTask> _tasks = [];
    private readonly List<VerificationEvent> _verificationEvents = [];

    private DailyLog() : base(Guid.Empty) { } // EF Core

    private DailyLog(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance provenance,
        Guid? sourceAiJobId)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        OperatorUserId = operatorUserId;
        LogDate = logDate;
        IdempotencyKey = idempotencyKey;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Location = location;
        Provenance = provenance;
        SourceAiJobId = sourceAiJobId;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public UserId OperatorUserId { get; private set; }
    public UserId CreatedByUserId => OperatorUserId;
    public DateOnly LogDate { get; private set; }
    public string? IdempotencyKey { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public LocationSnapshot? Location { get; private set; }
    public Provenance Provenance { get; private set; } = null!;
    public Guid? SourceAiJobId { get; private set; }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.6 ────────────────
    // ADR-DS-015 §C forward-compat seam for the future multi-evidence
    // consumer (m2m). Today this column carries
    // [{type: 'voice', voice_capture_id: ...}]; tomorrow it carries
    // weather/GPS/OCR/UPI evidence references. Persisted as a jsonb
    // string with a default empty array; ADR-DS-015 also requires the
    // column to describe immutable facts only (no mutable state) so the
    // future event-sourced migration is non-destructive.
    public string EvidenceSourcesJson { get; private set; } = "[]";

    public IReadOnlyCollection<LogTask> Tasks => _tasks.AsReadOnly();
    public IReadOnlyCollection<VerificationEvent> VerificationEvents => _verificationEvents.AsReadOnly();

    public VerificationStatus CurrentVerificationStatus =>
        _verificationEvents
            .OrderBy(v => v.OccurredAtUtc)
            .Select(v => v.Status)
            .DefaultIfEmpty(VerificationStatus.Draft)
            .Last();

    public VerificationStatus? LastVerificationStatus => CurrentVerificationStatus;

    public static DailyLog Create(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance? provenance = null,
        Guid? sourceAiJobId = null)
    {
        var effectiveProvenance = provenance ?? Provenance.Manual("unknown");

        var log = new DailyLog(
            id,
            farmId,
            plotId,
            cropCycleId,
            operatorUserId,
            logDate,
            idempotencyKey,
            location,
            createdAtUtc,
            effectiveProvenance,
            sourceAiJobId);

        log.Raise(new DailyLogCreatedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            farmId,
            plotId,
            cropCycleId,
            logDate));

        return log;
    }

    public LogTask AddTask(
        Guid taskId,
        string activityType,
        string? notes,
        DateTime occurredAtUtc,
        ExecutionStatus executionStatus = ExecutionStatus.Completed,
        string? deviationReasonCode = null,
        string? deviationNote = null)
    {
        if (string.IsNullOrWhiteSpace(activityType))
        {
            throw new ArgumentException("Activity type is required.", nameof(activityType));
        }

        var task = new LogTask(taskId, Id, activityType.Trim(), notes?.Trim(), occurredAtUtc, executionStatus, deviationReasonCode, deviationNote);
        _tasks.Add(task);
        ModifiedAtUtc = occurredAtUtc;
        return task;
    }

    public void AttachLocation(LocationSnapshot location)
    {
        if (Location is not null)
        {
            throw new InvalidOperationException("Location is immutable once attached.");
        }

        Location = location;
        ModifiedAtUtc = location.CapturedAtUtc;
    }

    public VerificationEvent Edit(
        Guid verificationEventId,
        UserId editedByUserId,
        DateTime occurredAtUtc,
        string? reason = "Edited")
    {
        var editMarker = new VerificationEvent(
            verificationEventId,
            Id,
            VerificationStatus.Draft,
            string.IsNullOrWhiteSpace(reason) ? "Edited" : reason.Trim(),
            editedByUserId,
            occurredAtUtc);

        _verificationEvents.Add(editMarker);
        ModifiedAtUtc = occurredAtUtc;
        return editMarker;
    }

    public VerificationEvent Verify(
        Guid verificationEventId,
        VerificationStatus status,
        string? reason,
        AppRole callerRole,
        UserId verifiedByUserId,
        DateTime occurredAtUtc)
    {
        var currentStatus = CurrentVerificationStatus;
        if (!VerificationStateMachine.CanTransitionWithRole(currentStatus, status, callerRole))
        {
            throw new InvalidOperationException("Transition not allowed for role.");
        }

        if (status == VerificationStatus.Disputed && string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Reason is required when disputing a log.", nameof(reason));
        }

        var verification = new VerificationEvent(
            verificationEventId,
            Id,
            status,
            reason,
            verifiedByUserId,
            occurredAtUtc);

        _verificationEvents.Add(verification);
        ModifiedAtUtc = occurredAtUtc;

        Raise(new LogVerifiedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            status,
            verifiedByUserId));

        return verification;
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — the marker stamped on the INTERMEDIATE
    /// <see cref="VerificationStatus.Confirmed"/> event that
    /// <see cref="VerifyReachingTarget"/> emits when the target is two hops away.
    ///
    /// <para>Same purpose as <see cref="SelfAttestationReason"/>: the ledger must be able to
    /// tell an event a human produced from one the machine produced on the way somewhere. An
    /// owner who taps "approve" on a foreman's Draft log presses ONE button; the FSM requires
    /// TWO events. Without this marker the resulting <c>Confirmed</c> row is indistinguishable
    /// from a separate, deliberate act of confirmation that never happened.</para>
    ///
    /// <para>Machine-readable and stable. Do not localise it, do not reword it.</para>
    /// </summary>
    public const string EnRouteConfirmReason = "confirmed-en-route";

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.3) — the marker stamped on
    /// <see cref="VerificationEvent.Reason"/> for BOTH events
    /// <see cref="TrySelfVerifyAsCreator"/> emits.
    ///
    /// <para><b>Why a constant and not <c>null</c>.</b> A self-attestation is a weaker
    /// claim than a second person's approval: the same human recorded the day and
    /// vouched for it. Today the pilot accepts that trade — an owner's word about his
    /// own farm is the best evidence that exists. If it is ever tightened (an
    /// attestation from the creator no longer authorises a payout, say), the question
    /// asked of the data will be "which Verified logs were only ever self-attested?"
    /// With <c>null</c> in this column that question is UNANSWERABLE after the fact —
    /// every attestation, self and second-party, looks identical. With this marker it
    /// is a one-line predicate over a column that already exists (the Disputed path
    /// requires <c>reason</c>, so this is ZERO schema change).</para>
    ///
    /// <para>The value is deliberately machine-readable and stable. Do not localise it,
    /// do not reword it — anything that reads it is looking for this exact string.</para>
    /// </summary>
    public const string SelfAttestationReason = "self-attested-at-creation";

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.5) — the marker stamped on both events
    /// <see cref="TrySelfVerifyAsCreator"/> emits when it is called by the ONE-TIME
    /// BACKFILL over days recorded before wave-1.3 shipped.
    ///
    /// <para><b>Why it is not <see cref="SelfAttestationReason"/>.</b> Those two markers
    /// describe genuinely different acts and must never be conflated. A row carrying
    /// <see cref="SelfAttestationReason"/> means: at the moment this farmer saved this
    /// day, the server derived his authority and he attested to it. A row carrying THIS
    /// marker means: nobody attested to anything at the time — the server reconstructed,
    /// weeks later, an attestation the farmer would have made had wave-1.3 existed. That
    /// is a defensible repair (the same person, the same authority, the same farm, and
    /// he has been looking at the day as his own ever since) but it is a WEAKER claim
    /// than a live one, and the ledger has to be able to say which it is holding.</para>
    ///
    /// <para><b>What it buys.</b> The backfill is a bulk write over a pilot's history.
    /// If it is ever found to have over-reached, "undo exactly the rows this backfill
    /// created, and nothing a human actually did" is a one-line predicate on this
    /// column. With <see cref="SelfAttestationReason"/> on both, the reconstructed rows
    /// would be permanently indistinguishable from the real ones and the backfill would
    /// be IRREVERSIBLE — the Cofounder Oath's "reversible by default" spent for the sake
    /// of reusing a string.</para>
    ///
    /// <para>Machine-readable and stable. Do not localise it, do not reword it.</para>
    /// </summary>
    public const string BackfilledAttestationReason = "self-attested-backfilled";

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — REACH <paramref name="target"/> BY WALKING
    /// ONLY EDGES <paramref name="callerRole"/> ALREADY HOLDS.
    ///
    /// <para><b>Why this exists.</b> An owner reviewing a foreman's day presses ONE button, and
    /// the log he presses it on is sitting in <see cref="VerificationStatus.Draft"/>. There is no
    /// <c>Draft → Verified</c> edge in <see cref="VerificationStateMachine"/> for ANY role, so
    /// <see cref="Verify"/> alone refuses the only approval the pilot actually needs. The
    /// tempting fix — add the edge — is the one change that would break the trust model outright:
    /// <c>Draft → X</c> edges are open to every role, so a <c>Draft → Verified</c> edge would let
    /// a mukadam approve his own work. Nothing here loosens the machine; this method only walks
    /// it.</para>
    ///
    /// <para><b>The rule, stated once.</b> Take the direct edge when the role holds it. Otherwise,
    /// from <see cref="VerificationStatus.Draft"/> only, pass THROUGH
    /// <see cref="VerificationStatus.Confirmed"/> — and through nothing else, ever. Confirmed is
    /// the one status that asserts nothing beyond "this day was recorded", which is already true
    /// of any log that exists. Every other status is a human claim: a dispute needs a reason a
    /// person gave, a correction request needs a dispute to have happened first. A server that
    /// manufactured those on the way past would be fabricating content
    /// (<c>docs/AGRISYNC-DOCTRINE.md</c> P4), so it refuses instead.</para>
    ///
    /// <para><b>Both events are credited to <paramref name="verifiedByUserId"/>.</b> The
    /// intermediate hop is not attributed to the log's operator: he never confirmed anything.
    /// It is the reviewer who, by approving, acknowledges the day was recorded — so it is the
    /// reviewer's act, marked <see cref="EnRouteConfirmReason"/> so the ledger can always tell
    /// it from a button somebody pressed.</para>
    ///
    /// <para><b>Why the 1 ms offset.</b> <see cref="CurrentVerificationStatus"/> resolves by
    /// <c>OrderBy(OccurredAtUtc).Last()</c>. Two events sharing one instant would leave the fold
    /// at the mercy of row order after an EF reload, and the log could read back
    /// <c>Confirmed</c> — which the client's ring does not count. Same reasoning as
    /// <see cref="TrySelfVerifyAsCreator"/>.</para>
    ///
    /// <para>The caller MUST derive <paramref name="callerRole"/> from the operator's membership
    /// on the server. A client-supplied role would make the device the authority on its own
    /// approval, which is exactly what the FSM exists to prevent.</para>
    /// </summary>
    /// <returns>The events emitted, in the order they occurred; never empty.</returns>
    /// <exception cref="InvalidOperationException">
    /// No path to <paramref name="target"/> that <paramref name="callerRole"/> may walk.
    /// </exception>
    /// <exception cref="ArgumentException">
    /// <paramref name="target"/> is <see cref="VerificationStatus.Disputed"/> with no reason.
    /// </exception>
    public IReadOnlyList<VerificationEvent> VerifyReachingTarget(
        VerificationStatus target,
        string? reason,
        AppRole callerRole,
        UserId verifiedByUserId,
        DateTime occurredAtUtc,
        Guid targetEventId,
        Guid enRouteEventId)
    {
        var current = CurrentVerificationStatus;

        if (VerificationStateMachine.CanTransitionWithRole(current, target, callerRole))
        {
            return [Verify(targetEventId, target, reason, callerRole, verifiedByUserId, occurredAtUtc)];
        }

        // The ONLY status the server may pass through. See the rule above.
        var canWalkViaConfirmed =
            current == VerificationStatus.Draft
            && target != VerificationStatus.Confirmed
            && VerificationStateMachine.CanTransitionWithRole(
                VerificationStatus.Draft, VerificationStatus.Confirmed, callerRole)
            && VerificationStateMachine.CanTransitionWithRole(
                VerificationStatus.Confirmed, target, callerRole);

        if (!canWalkViaConfirmed)
        {
            throw new InvalidOperationException("Transition not allowed for role.");
        }

        // Validate the FINAL hop before writing the intermediate one, so a rejection with
        // no reason cannot leave a stranded Confirmed event behind. Verify() would throw on
        // the second call, but by then the first is already in _verificationEvents and the
        // aggregate is dirty — the sync path's transaction rolls that back, the direct HTTP
        // path does not, and "it happens to be inside a transaction today" is not a rule.
        if (target == VerificationStatus.Disputed && string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Reason is required when disputing a log.", nameof(reason));
        }

        var enRoute = Verify(
            enRouteEventId, VerificationStatus.Confirmed, EnRouteConfirmReason,
            callerRole, verifiedByUserId, occurredAtUtc);
        var arrived = Verify(
            targetEventId, target, reason,
            callerRole, verifiedByUserId, occurredAtUtc.AddMilliseconds(1));

        return [enRoute, arrived];
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.3) — an owner's own log must come back
    /// from the server as a day that counts.
    ///
    /// <para><b>Why this exists.</b> Verification is derived, not stored:
    /// <see cref="CurrentVerificationStatus"/> folds <see cref="VerificationEvents"/>, and
    /// <c>DailyLogConfiguration</c> <c>Ignore</c>s both properties — there is no column a
    /// client could write. <see cref="Create"/> emits ZERO verification events, so EVERY
    /// synced log came back <see cref="VerificationStatus.Draft"/>, the farm owner's own
    /// included. The device stamps his log approved on save; the next pull overwrote that
    /// with the server's Draft and his day fell out of the closed-day count again.</para>
    ///
    /// <para><b>Why two events and not a new FSM edge.</b> When the creating operator's
    /// SERVER-DERIVED role already holds both edges the machine defines — Draft→Confirmed
    /// ("I recorded this") and Confirmed→Verified ("I, an owner, vouch for it") — both acts
    /// genuinely happened, by the same person, at the moment of creation. So we WALK the
    /// existing edges instead of adding a Draft→Verified shortcut. Nothing in
    /// <see cref="VerificationStateMachine"/> is loosened, and an operator who holds only
    /// the first edge (Mukadam, Worker, Consultant) gets NOTHING here: his log stays Draft
    /// and still needs an owner. That is the whole point of the state machine and the pilot
    /// depends on it.</para>
    ///
    /// <para><b>Why the 1 ms offset.</b> <see cref="CurrentVerificationStatus"/> resolves by
    /// <c>OrderBy(OccurredAtUtc).Last()</c>. Two events sharing one instant would leave the
    /// fold at the mercy of row order after an EF reload — the log could read back
    /// <c>Confirmed</c>, which the client's ring does not count, and the bug would return
    /// looking like a client regression. Two distinct acts get two distinct instants.</para>
    ///
    /// <para>The caller MUST derive <paramref name="creatorRole"/> from the operator's
    /// membership on the server. A client-supplied role would make the device the authority
    /// on its own approval, which is exactly what the FSM exists to prevent.</para>
    ///
    /// <para><b>Both events carry <see cref="SelfAttestationReason"/>.</b> See that field —
    /// it is the marker that keeps this decision reversible.</para>
    ///
    /// <para><b>Not creation-only.</b> The only state guard is "the log is in Draft". A
    /// caller that has just walked a log back to Draft — <c>AddLogTaskHandler</c>, when the
    /// log's own operator adds a second task to a day he already attested to — may ask for
    /// a fresh attestation covering the new content. That caller owns the identity check
    /// (actor == operator); this method owns the state and role checks.</para>
    /// </summary>
    /// <param name="reason">
    /// spec: dfes-companion-2026-07-11 (wave-1.5) — the marker both emitted events carry.
    /// Defaults to <see cref="SelfAttestationReason"/> (the live create-time path). The
    /// one-time backfill over pre-wave-1.3 history passes
    /// <see cref="BackfilledAttestationReason"/> instead, so a reconstructed attestation
    /// is never mistaken for one made at the moment the farmer saved the day. The ROLE
    /// AND STATE RULES BELOW ARE THE SAME LINES either way — that is the point of adding
    /// a parameter rather than a second method: the backfill cannot drift into attesting
    /// something the live path would have refused.
    /// </param>
    /// <returns><c>true</c> when both attestation events were emitted.</returns>
    public bool TrySelfVerifyAsCreator(
        Guid confirmEventId,
        Guid verifyEventId,
        AppRole creatorRole,
        DateTime occurredAtUtc,
        string reason = SelfAttestationReason)
    {
        // The log must be sitting in Draft — nothing else is re-stamped, ever.
        //
        // spec: dfes-companion-2026-07-11 (wave-1.3) — I3. This used to ALSO refuse any
        // log carrying verification history at all (`_verificationEvents.Count > 0`),
        // which made the method literally creation-time-only. That extra clause is now
        // gone, because AddLogTaskHandler has to re-attest a day it just re-opened: it
        // Edits a Verified log back to Draft so the attestation covers the new task, then
        // asks this method to re-stamp it. With the old clause the owner's SECOND task of
        // the day left his log stranded in Draft forever — the exact bug wave-1.3 fixed,
        // reintroduced through a different door.
        //
        // Dropping it is safe because the Draft check does the real work: a log that has
        // been Confirmed, Verified, Disputed or is CorrectionPending is refused here just
        // as before. What can now be re-attested is a log that some caller has already
        // deliberately walked back to Draft — and the CALLER still has to prove the actor
        // is the log's own operator before it asks (AddLogTaskHandler does exactly that).
        if (CurrentVerificationStatus != VerificationStatus.Draft)
        {
            return false;
        }

        // Authority is asked of the state machine itself, so this can never drift from
        // the roles the machine actually permits.
        var canConfirm = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Draft, VerificationStatus.Confirmed, creatorRole);
        var canVerify = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed, VerificationStatus.Verified, creatorRole);
        if (!canConfirm || !canVerify)
        {
            return false;
        }

        Verify(confirmEventId, VerificationStatus.Confirmed, reason, creatorRole, OperatorUserId, occurredAtUtc);
        Verify(verifyEventId, VerificationStatus.Verified, reason, creatorRole, OperatorUserId, occurredAtUtc.AddMilliseconds(1));
        return true;
    }

    public VerificationEvent? Edit(
        Guid verificationEventId,
        UserId editedByUserId,
        DateTime occurredAtUtc)
    {
        var currentStatus = CurrentVerificationStatus;
        var nextStatus = VerificationStateMachine.GetNextStatusForEdit(currentStatus);
        if (nextStatus == currentStatus)
        {
            return null;
        }

        var verification = new VerificationEvent(
            verificationEventId,
            Id,
            nextStatus,
            null,
            editedByUserId,
            occurredAtUtc);

        _verificationEvents.Add(verification);

        Raise(new LogVerifiedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            nextStatus,
            editedByUserId));

        return verification;
    }

    // ── SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.6 ────────────────
    // Sets the forward-compat evidence-sources jsonb payload. Per
    // ADR-DS-015 the m2m consumer is deferred to a future spec; this
    // mutator exists only so the column can be populated by the voice
    // pipeline today ([{type: 'voice', voice_capture_id: ...}]) and by
    // future evidence sources tomorrow. Empty / whitespace input falls
    // back to the canonical "[]" so the column NEVER goes null.
    public void SetEvidenceSourcesJson(string? evidenceSourcesJson)
    {
        EvidenceSourcesJson = string.IsNullOrWhiteSpace(evidenceSourcesJson)
            ? "[]"
            : evidenceSourcesJson.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }

    // ── wave-3.10, founder decision 8 (2026-08-16) ───────────────────────
    /// <summary>
    /// The farmer's OWN statement about the day ("NO_WORK_PLANNED"), copied verbatim from
    /// his declaration. NULL on every ordinary work day and on every log written before
    /// this change; <see cref="ShramSafal.Domain.Logs.DailyLog"/> never infers it and
    /// nothing defaults it to "WORK_RECORDED" — "he did not say" and "he said it was a
    /// rest day" are different facts (doctrine P4).
    ///
    /// <para>It lives HERE, on the log, rather than as a <c>DisturbanceEvent</c>, for two
    /// reasons. First, "there was no work today" is a statement about the DAY, not about a
    /// blockage: as a disturbance it would set <c>HasDisturbance</c> for a plain rest day
    /// and be reported as <c>blocked</c> instead of <c>rest</c>. Second,
    /// <c>DisturbanceEvent.Create</c> requires a non-empty reason, so a farmer who
    /// declared his day and skipped the optional chips would have had his record silently
    /// dropped — doctrine P9 forbids an optional field rejecting a record.</para>
    ///
    /// <para>Canonical, not best-effort: it is stamped BEFORE the primary save, so it is
    /// as durable as the log itself and never depends on the non-blocking side-car.</para>
    /// </summary>
    public string? DayOutcome { get; private set; }

    /// <summary>
    /// Records the farmer's declaration. Blank / whitespace clears it to NULL rather than
    /// storing an empty string, so "absent" has exactly one representation. Normalised to
    /// upper case because <c>DfesLensExtractor.DeclaredNoWork</c> compares case-insensitively
    /// against the wire vocabulary and the stored value should read the same as the wire.
    /// </summary>
    public void SetDayOutcome(string? dayOutcome)
    {
        DayOutcome = string.IsNullOrWhiteSpace(dayOutcome) ? null : dayOutcome.Trim().ToUpperInvariant();
        ModifiedAtUtc = DateTime.UtcNow;
    }
}
