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
    /// </summary>
    /// <returns><c>true</c> when both attestation events were emitted.</returns>
    public bool TrySelfVerifyAsCreator(
        Guid confirmEventId,
        Guid verifyEventId,
        AppRole creatorRole,
        DateTime occurredAtUtc)
    {
        // Creation-time only. A log that already carries verification history has a
        // story of its own and must never be silently re-stamped.
        if (_verificationEvents.Count > 0 || CurrentVerificationStatus != VerificationStatus.Draft)
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

        Verify(confirmEventId, VerificationStatus.Confirmed, null, creatorRole, OperatorUserId, occurredAtUtc);
        Verify(verifyEventId, VerificationStatus.Verified, null, creatorRole, OperatorUserId, occurredAtUtc.AddMilliseconds(1));
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
}
