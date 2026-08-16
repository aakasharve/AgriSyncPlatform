using AgriSync.BuildingBlocks.Domain;

using ShramSafal.Domain.Common;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2; plan §3.2d) — a labour
/// engagement: who/how-many worked, the rate + basis, and (only if the farmer stated
/// it) a total. EXISTS-join child: plain <see cref="DailyLogId"/> FK, no farm_id, no
/// Provenance, no version chain.
/// <para><b>NO-MULTIPLY honesty rule (load-bearing, ADR §1 / §3.2d):</b> <see cref="TotalCost"/>
/// is stored exactly as supplied (NULL when not stated). It is NEVER computed from
/// rate × count — a per-vine/piece rate persists with a null total rather than a
/// fabricated one.</para>
/// </summary>
public sealed class LabourAssignment : Entity<Guid>
{
    private LabourAssignment() : base(Guid.Empty) { } // EF Core

    private LabourAssignment(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc,
        NumericCertainty? costCertainty, string? costSpokenText)
        : base(id)
    {
        DailyLogId = dailyLogId;
        EngagementType = engagementType;
        MaleCount = maleCount;
        FemaleCount = femaleCount;
        WorkerCount = workerCount;
        WagePerPerson = wagePerPerson;
        ContractUnit = contractUnit;
        ContractQuantity = contractQuantity;
        TotalCost = totalCost;          // NO-MULTIPLY: stored as-given, never computed
        LinkedActivityId = linkedActivityId;
        CreatedAtUtc = createdAtUtc;
        CostCertainty = costCertainty;
        CostSpokenText = costSpokenText;
    }

    public Guid DailyLogId { get; private set; }
    public LabourEngagementType EngagementType { get; private set; }
    public int? MaleCount { get; private set; }
    public int? FemaleCount { get; private set; }
    public int? WorkerCount { get; private set; }
    public decimal? WagePerPerson { get; private set; }
    public ContractUnit? ContractUnit { get; private set; }
    public decimal? ContractQuantity { get; private set; }
    public decimal? TotalCost { get; private set; }
    public Guid? LinkedActivityId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    // ── wave-3.12, spec Ruling 5 — how sure the farmer was of the COST ──
    /// <summary>NULL when he was never asked. Never defaulted to Reported (P4).
    /// <c>Unknown</c> is the only honest home for a cost he cannot recall:
    /// <c>CostEntry.Create</c> throws on <c>amount &lt;= 0</c>, so "आठवत नाही" must never
    /// become a CostEntry row at all.</summary>
    public NumericCertainty? CostCertainty { get; private set; }

    /// <summary>His own words for the cost, kept verbatim beside it.</summary>
    public string? CostSpokenText { get; private set; }

    public static LabourAssignment Create(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc,
        // wave-3.12 — trailing and OPTIONAL so every pre-existing call site keeps
        // compiling and keeps writing NULL, which is exactly "not asked, not stated".
        NumericCertainty? costCertainty = null, string? costSpokenText = null)
        => new(id, dailyLogId, engagementType, maleCount, femaleCount, workerCount,
               wagePerPerson, contractUnit, contractQuantity, totalCost, linkedActivityId, createdAtUtc,
               costCertainty, costSpokenText);
}
