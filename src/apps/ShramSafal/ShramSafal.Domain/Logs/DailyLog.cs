using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
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
        DateTime createdAtUtc)
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
        DateTime createdAtUtc)
    {
        var log = new DailyLog(
            id,
            farmId,
            plotId,
            cropCycleId,
            operatorUserId,
            logDate,
            idempotencyKey,
            location,
            createdAtUtc);

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
}
