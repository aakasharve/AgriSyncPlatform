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
    private readonly List<Guid> _plotIds = [];

    private DailyLog() : base(Guid.Empty) { } // EF Core

    private DailyLog(
        Guid id,
        FarmId farmId,
        DailyLogScope scope,
        IReadOnlyCollection<Guid> plotIds,
        Guid? plotId,
        Guid? cropCycleId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance provenance,
        Guid? sourceAiJobId)
        : base(id)
    {
        // FIRST line of defence (LABOUR_PHASE2 P2.1). The ck_daily_logs_scope
        // CHECK constraint is the second. This guard runs on the ONLY path that
        // constructs a new DailyLog, so an invalid scope/plot combination is
        // unconstructible — not merely rejected at the database boundary.
        // EF Core materialises through the parameterless ctor above, so loading
        // a legacy row never runs this.
        EnsureScopeInvariant(scope, plotIds, plotId, cropCycleId);

        FarmId = farmId;
        Scope = scope;
        _plotIds.AddRange(plotIds);
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

    /// <summary>
    /// What the farmer asserted about WHERE this happened. Explicit rather than
    /// inferred from <see cref="PlotIds"/> cardinality, so a reader five years
    /// from now never has to know a convention to interpret the row.
    /// </summary>
    public DailyLogScope Scope { get; private set; } = DailyLogScope.Plot;

    /// <summary>
    /// The canonical spatial assertion: exactly one plot when
    /// <see cref="Scope"/> is <see cref="DailyLogScope.Plot"/>, two or more when
    /// <see cref="DailyLogScope.MultiPlot"/>, and EMPTY — never a sentinel — when
    /// <see cref="DailyLogScope.Farm"/>.
    /// </summary>
    public IReadOnlyCollection<Guid> PlotIds => _plotIds.AsReadOnly();

    /// <summary>
    /// Compatibility projection of the single-plot case: populated ONLY when
    /// <see cref="Scope"/> is <see cref="DailyLogScope.Plot"/>, and then always
    /// equal to the single member of <see cref="PlotIds"/>. Null for every other
    /// scope — a plot-less log has no plot, and we do not invent one.
    /// </summary>
    public Guid? PlotId { get; private set; }

    public Guid? CropCycleId { get; private set; }
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

    /// <summary>
    /// Plot-scoped log: the farmer named exactly one plot and its crop cycle.
    /// </summary>
    /// <remarks>
    /// The signature is UNCHANGED from Labour V1, deliberately — every existing
    /// call site keeps compiling and keeps meaning exactly what it meant before.
    /// <see cref="DailyLogScope"/> is not a parameter here because this factory
    /// can only ever produce <see cref="DailyLogScope.Plot"/>; the other two
    /// scopes have their own factories, so no caller can pair a scope with a
    /// plot reference that contradicts it.
    /// </remarks>
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
        => CreateCore(
            id,
            farmId,
            DailyLogScope.Plot,
            [plotId],
            plotId,
            cropCycleId,
            operatorUserId,
            logDate,
            idempotencyKey,
            location,
            createdAtUtc,
            provenance,
            sourceAiJobId);

    /// <summary>
    /// Multi-plot log (founder decision O-2): ONE shared engagement whose context
    /// contains several plots. Never fanned out into one row per plot — that is
    /// what inflates headcount today.
    /// </summary>
    /// <remarks>
    /// Takes no <c>plotId</c> and no <c>cropCycleId</c> parameter at all, so a
    /// multi-plot log cannot be given a single-plot identity by mistake.
    /// Cross-cycle attribution is deferred by decision, not by oversight.
    /// </remarks>
    public static DailyLog CreateForMultiPlot(
        Guid id,
        FarmId farmId,
        IReadOnlyCollection<Guid> plotIds,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance? provenance = null,
        Guid? sourceAiJobId = null)
        => CreateCore(
            id,
            farmId,
            DailyLogScope.MultiPlot,
            plotIds,
            plotId: null,
            cropCycleId: null,
            operatorUserId,
            logDate,
            idempotencyKey,
            location,
            createdAtUtc,
            provenance,
            sourceAiJobId);

    /// <summary>
    /// संपूर्ण शेत — a farm-wide log. The farmer named no plot, so this factory
    /// accepts no plot reference of any kind. There is no parameter through
    /// which a fabricated plot or crop cycle could enter.
    /// </summary>
    public static DailyLog CreateForFarm(
        Guid id,
        FarmId farmId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance? provenance = null,
        Guid? sourceAiJobId = null)
        => CreateCore(
            id,
            farmId,
            DailyLogScope.Farm,
            [],
            plotId: null,
            cropCycleId: null,
            operatorUserId,
            logDate,
            idempotencyKey,
            location,
            createdAtUtc,
            provenance,
            sourceAiJobId);

    private static DailyLog CreateCore(
        Guid id,
        FarmId farmId,
        DailyLogScope scope,
        IReadOnlyCollection<Guid> plotIds,
        Guid? plotId,
        Guid? cropCycleId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance? provenance,
        Guid? sourceAiJobId)
    {
        var effectiveProvenance = provenance ?? Provenance.Manual("unknown");

        var log = new DailyLog(
            id,
            farmId,
            scope,
            plotIds,
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
            scope,
            log.PlotIds,
            plotId,
            cropCycleId,
            logDate));

        return log;
    }

    /// <summary>
    /// The scope invariant, stated once. A FULL mirror of
    /// <c>ck_daily_logs_scope</c> — every clause the database enforces is
    /// enforced here first, so an invalid combination is unconstructible rather
    /// than merely rejected at the database boundary.
    /// </summary>
    /// <remarks>
    /// Two clauses are worth naming because losing either re-opens a real hole:
    /// <list type="bullet">
    /// <item>a plot-scoped log's <see cref="CropCycleId"/> must be SET — the
    /// column was <c>NOT NULL</c> for the whole life of the table and only the
    /// FARM-wide case needed that relaxed, so <c>ck_daily_logs_scope</c> restates
    /// it per-scope and this mirrors it;</item>
    /// <item>a plot-scoped log's compatibility <see cref="PlotId"/> must BE the
    /// single member of <see cref="PlotIds"/>, not merely non-null — otherwise a
    /// reader using one and a reader using the other return different plots for
    /// the same log.</item>
    /// </list>
    /// One rule here is still domain-ONLY and has no SQL counterpart:
    /// distinctness of <paramref name="plotIds"/>. <c>cardinality(plot_ids) >= 2</c>
    /// is satisfied by <c>{A,A}</c>, which is one plot written twice, not two
    /// plots. Stating that in the CHECK would need an ARRAY-to-set subquery; the
    /// domain is the cheaper and clearer place for it, so this guard is the ONLY
    /// thing standing between a raw-SQL fixture and a duplicate-plot MultiPlot row.
    /// </remarks>
    private static void EnsureScopeInvariant(
        DailyLogScope scope,
        IReadOnlyCollection<Guid> plotIds,
        Guid? plotId,
        Guid? cropCycleId)
    {
        ArgumentNullException.ThrowIfNull(plotIds);

        if (plotIds.Distinct().Count() != plotIds.Count)
        {
            throw new ArgumentException(
                "Plot ids must be distinct — a repeated plot is not a second plot.",
                nameof(plotIds));
        }

        var satisfied = scope switch
        {
            DailyLogScope.Plot =>
                plotIds.Count == 1 && plotId.HasValue && plotIds.First() == plotId.Value
                && cropCycleId.HasValue,
            DailyLogScope.MultiPlot =>
                plotIds.Count >= 2 && !plotId.HasValue && !cropCycleId.HasValue,
            DailyLogScope.Farm =>
                plotIds.Count == 0 && !plotId.HasValue && !cropCycleId.HasValue,
            _ => false,
        };

        if (!satisfied)
        {
            throw new ArgumentException(
                $"Scope '{scope}' is not consistent with {plotIds.Count} plot id(s), " +
                $"plotId={(plotId.HasValue ? "set" : "null")}, " +
                $"cropCycleId={(cropCycleId.HasValue ? "set" : "null")}.",
                nameof(scope));
        }
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

    /// <summary>
    /// LABOUR_PHASE2 Phase 3 — a labour engagement anchored to this log was
    /// corrected in place, so THIS log's modification clock moves.
    /// </summary>
    /// <remarks>
    /// <para><b>Without this, a correction is invisible to a second device and
    /// every test still passes.</b> <c>ssf.labour_assignments</c> has no
    /// <c>modified_at_utc</c> and <c>CorrectLabourHandler</c> mutates the row IN
    /// PLACE — that in-place mutation is what lets every reader see corrected truth
    /// without knowing corrections exist. But <c>/sync/pull</c> is a delta on
    /// <c>daily_logs.modified_at_utc</c>. So a correction would persist perfectly on
    /// the server, be reported as applied, and never reach Phone B.</para>
    ///
    /// <para><b>It records nothing about labour.</b> There is no labour state on
    /// this aggregate and none is added here: the method moves one timestamp, which
    /// is precisely what "something about this log changed" means to the sync
    /// cursor. Named for the event rather than the field so it can never become the
    /// general <c>Update</c>/<c>SetModifiedAt</c> this class deliberately does not
    /// have — and so a reader of the correction handler can see WHY the clock moved.</para>
    ///
    /// <para><b>Monotonic.</b> The clock only ever moves FORWARD. Assigning a
    /// smaller value would drop the log below a device's existing cursor and hide
    /// the very correction this exists to deliver, so a stale or skewed timestamp
    /// is ignored rather than obeyed.</para>
    /// </remarks>
    public void MarkLabourCorrected(DateTime correctedAtUtc)
    {
        if (correctedAtUtc > ModifiedAtUtc)
        {
            ModifiedAtUtc = correctedAtUtc;
        }
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
