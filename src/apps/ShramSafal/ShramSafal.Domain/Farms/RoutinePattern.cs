using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed <b>DIRECT-farm_id</b> row (ADR 0023 §2) — RoutineMemory (§8.1): the farmer's
/// CONFIRMED "as usual" routine per farm+plot+operation-type (typical duration/method/source),
/// used to resolve "नेहमी प्रमाणे" by derivation (provenance:'derived'), never a blank guess.
/// A living per-farm aggregate; <see cref="SampleCount"/> = confirmed logs backing it.
/// Carries its own <see cref="FarmId"/> (direct RLS). Derived farm-level facts — no PII,
/// no farmer free-text → KEEP on erasure. No Provenance, no version chain.
/// </summary>
public sealed class RoutinePattern : Entity<Guid>
{
    private RoutinePattern() : base(Guid.Empty) { } // EF Core

    private RoutinePattern(
        Guid id, Guid farmId, Guid? plotId, string operationType,
        decimal? typicalDurationHours, string? typicalMethod, string? typicalSource,
        int sampleCount, DateTime createdAtUtc, DateTime updatedAtUtc)
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(operationType))
        {
            throw new ArgumentException(
                "operationType is required — the routine pattern key.",
                nameof(operationType));
        }

        if (sampleCount < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(sampleCount),
                "sampleCount must be >= 1 — a confirmed pattern is backed by at least one log.");
        }

        FarmId = farmId;
        PlotId = plotId;
        OperationType = operationType.Trim();
        TypicalDurationHours = typicalDurationHours;
        TypicalMethod = typicalMethod;
        TypicalSource = typicalSource;
        SampleCount = sampleCount;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = updatedAtUtc;
    }

    public Guid FarmId { get; private set; }                   // tenancy key — direct RLS
    public Guid? PlotId { get; private set; }                  // null = farm-wide pattern; set = plot-specific
    public string OperationType { get; private set; } = null!; // required, non-blank — the discriminator (e.g. "irrigation", "spray")
    public decimal? TypicalDurationHours { get; private set; } // nullable
    public string? TypicalMethod { get; private set; }         // nullable (e.g. "drip", "flood", "blower")
    public string? TypicalSource { get; private set; }         // nullable (e.g. "motor", "canal")
    public int SampleCount { get; private set; }               // >= 1 — confirmed logs backing this pattern
    public DateTime CreatedAtUtc { get; private set; }         // first seen
    public DateTime UpdatedAtUtc { get; private set; }         // last reinforced

    public static RoutinePattern Create(
        Guid id, Guid farmId, Guid? plotId, string operationType,
        decimal? typicalDurationHours, string? typicalMethod, string? typicalSource,
        int sampleCount, DateTime createdAtUtc, DateTime updatedAtUtc)
        => new(id, farmId, plotId, operationType, typicalDurationHours, typicalMethod,
               typicalSource, sampleCount, createdAtUtc, updatedAtUtc);
}
