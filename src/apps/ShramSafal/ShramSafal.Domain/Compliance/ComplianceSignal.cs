using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Compliance;

public sealed class ComplianceSignal : Entity<Guid>
{
    private ComplianceSignal() : base(Guid.Empty) { } // EF Core

    private ComplianceSignal(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid? cropCycleId,
        string ruleCode,
        ComplianceSeverity severity,
        ComplianceSuggestedAction suggestedAction,
        string titleEn,
        string titleMr,
        string descriptionEn,
        string descriptionMr,
        string payloadJson,
        DateTime firstSeenAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        RuleCode = ruleCode;
        Severity = severity;
        SuggestedAction = suggestedAction;
        TitleEn = titleEn;
        TitleMr = titleMr;
        DescriptionEn = descriptionEn;
        DescriptionMr = descriptionMr;
        PayloadJson = payloadJson;
        FirstSeenAtUtc = firstSeenAtUtc;
        LastSeenAtUtc = firstSeenAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid? CropCycleId { get; private set; }
    public string RuleCode { get; private set; } = string.Empty;
    public ComplianceSeverity Severity { get; private set; }
    public ComplianceSuggestedAction SuggestedAction { get; private set; }   // CEI-I6
    public string TitleEn { get; private set; } = string.Empty;
    public string TitleMr { get; private set; } = string.Empty;
    public string DescriptionEn { get; private set; } = string.Empty;
    public string DescriptionMr { get; private set; } = string.Empty;
    public string PayloadJson { get; private set; } = "{}";
    public DateTime FirstSeenAtUtc { get; private set; }
    public DateTime LastSeenAtUtc { get; private set; }
    public DateTime? AcknowledgedAtUtc { get; private set; }
    public UserId? AcknowledgedByUserId { get; private set; }
    public DateTime? ResolvedAtUtc { get; private set; }
    public UserId? ResolvedByUserId { get; private set; }
    public string? ResolutionNote { get; private set; }

    public bool IsOpen => AcknowledgedAtUtc is null && ResolvedAtUtc is null;

    public static ComplianceSignal Open(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid? cropCycleId,
        string ruleCode,
        ComplianceSeverity severity,
        ComplianceSuggestedAction suggestedAction,
        string titleEn,
        string titleMr,
        string descriptionEn,
        string descriptionMr,
        string payloadJson,
        DateTime firstSeenAtUtc)
    {
        var signal = new ComplianceSignal(
            id, farmId, plotId, cropCycleId, ruleCode,
            severity, suggestedAction,
            titleEn, titleMr, descriptionEn, descriptionMr,
            payloadJson, firstSeenAtUtc);

        signal.Raise(new ComplianceSignalRaisedEvent(
            id, farmId, plotId, ruleCode, severity, suggestedAction, firstSeenAtUtc));

        return signal;
    }

    // Called when the evaluator re-runs and the same condition still holds.
    public void Refresh(DateTime occurredAtUtc)
    {
        LastSeenAtUtc = occurredAtUtc;
    }

    public void Acknowledge(UserId userId, DateTime occurredAtUtc)
    {
        if (ResolvedAtUtc.HasValue)
            throw new InvalidOperationException("Signal is already resolved.");

        AcknowledgedAtUtc = occurredAtUtc;
        AcknowledgedByUserId = userId;
    }

    public void Resolve(UserId userId, string note, DateTime occurredAtUtc)
    {
        if (ResolvedAtUtc.HasValue)
            throw new InvalidOperationException("Signal is already resolved.");

        if (string.IsNullOrWhiteSpace(note))
            throw new InvalidOperationException("A resolution note is required.");

        if (note.Trim().Length < 3)
            throw new InvalidOperationException("Resolution note must be at least 3 characters.");

        ResolvedAtUtc = occurredAtUtc;
        ResolvedByUserId = userId;
        ResolutionNote = note.Trim();
    }

    // Update payload (used by handler-coupled ProtocolBreakInStage rule)
    public void UpdatePayload(string payloadJson)
    {
        PayloadJson = payloadJson;
    }
}
