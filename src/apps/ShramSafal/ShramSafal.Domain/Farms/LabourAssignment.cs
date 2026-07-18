using System.Text.Encodings.Web;
using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;

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
    // Devanagari worker names must round-trip readably in jsonb, not as \uXXXX escapes.
    private static readonly JsonSerializerOptions WorkerNamesSerializerOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private LabourAssignment() : base(Guid.Empty) { } // EF Core

    private LabourAssignment(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc,
        LabourShift? shift, string? task, string workerNamesJson)
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
        Shift = shift;
        Task = task;
        WorkerNamesJson = workerNamesJson;
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

    /// <summary>Which shift the engagement covers (पूर्ण/अर्धा/रात्रपाळी) — descriptive, not money.</summary>
    public LabourShift? Shift { get; private set; }

    /// <summary>Free-text task spoken by the farmer (फवारणी/छाटणी/…) — descriptive, not money.</summary>
    public string? Task { get; private set; }

    /// <summary>
    /// Worker names as stated, serialized as a JSON array. Never null — defaults to
    /// <c>"[]"</c> when the farmer named no one. Purely descriptive; plays no part
    /// in the NO-MULTIPLY money invariant above.
    /// </summary>
    /// <remarks>
    /// WARNING: Serialized with <see cref="JavaScriptEncoder.UnsafeRelaxedJsonEscaping"/>
    /// for readable Devanagari in jsonb, but NOT HTML-safe. Never embed raw JSON in HTML,
    /// &lt;script&gt;, Html.Raw, or dangerouslySetInnerHTML — deserialize and render as text only.
    /// </remarks>
    public string WorkerNamesJson { get; private set; } = "[]";

    public static LabourAssignment Create(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc,
        LabourShift? shift = null, string? task = null, IReadOnlyList<string>? workerNames = null)
    {
        var workerNamesJson = workerNames is null || workerNames.Count == 0
            ? "[]"
            : JsonSerializer.Serialize(workerNames, WorkerNamesSerializerOptions);

        return new(id, dailyLogId, engagementType, maleCount, femaleCount, workerCount,
               wagePerPerson, contractUnit, contractQuantity, totalCost, linkedActivityId, createdAtUtc,
               shift, task, workerNamesJson);
    }
}
