using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Events;

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
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public UserId OperatorUserId { get; private set; }
    public DateOnly LogDate { get; private set; }
    public string? IdempotencyKey { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public IReadOnlyCollection<LogTask> Tasks => _tasks.AsReadOnly();
    public IReadOnlyCollection<VerificationEvent> VerificationEvents => _verificationEvents.AsReadOnly();

    public VerificationStatus? LastVerificationStatus =>
        _verificationEvents
            .OrderBy(v => v.OccurredAtUtc)
            .Select(v => (VerificationStatus?)v.Status)
            .LastOrDefault();

    public static DailyLog Create(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        UserId operatorUserId,
        DateOnly logDate,
        string? idempotencyKey,
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

    public LogTask AddTask(Guid taskId, string activityType, string? notes, DateTime occurredAtUtc)
    {
        if (string.IsNullOrWhiteSpace(activityType))
        {
            throw new ArgumentException("Activity type is required.", nameof(activityType));
        }

        var task = new LogTask(taskId, Id, activityType.Trim(), notes?.Trim(), occurredAtUtc);
        _tasks.Add(task);
        return task;
    }

    public VerificationEvent Verify(
        Guid verificationEventId,
        VerificationStatus status,
        string? reason,
        UserId verifiedByUserId,
        DateTime occurredAtUtc)
    {
        if (status == VerificationStatus.Rejected && string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Reason is required when rejecting a log.", nameof(reason));
        }

        var verification = new VerificationEvent(
            verificationEventId,
            Id,
            status,
            string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
            verifiedByUserId,
            occurredAtUtc);

        _verificationEvents.Add(verification);

        Raise(new LogVerifiedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            status,
            verifiedByUserId));

        return verification;
    }
}
