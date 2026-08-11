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
        Guid? linkedActivityId, DateTime createdAtUtc, LabourTime time,
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
        DurationHours = time.Hours;
        TimeBasis = time.Basis;
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

    /// <summary>
    /// Hours worked — paired with <see cref="TimeBasis"/> so it always travels with its
    /// provenance. Alone, a duration is a lie about whether anyone measured it; see
    /// <see cref="LabourTime"/> for why.
    /// </summary>
    public decimal DurationHours { get; private set; }

    /// <summary>Whether <see cref="DurationHours"/> was stated by the farmer or assumed by the server.</summary>
    public LabourTimeBasis TimeBasis { get; private set; }

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
        Guid? linkedActivityId, DateTime createdAtUtc, LabourTime time,
        LabourShift? shift = null, string? task = null, IReadOnlyList<string>? workerNames = null)
    {
        // Closes default(LabourTime): a readonly record struct always has an implicit
        // public parameterless constructor, so the zero value is reachable no matter how
        // the named factories on LabourTime are locked down. Basis == Unspecified is what
        // makes that reachable-but-never-intended state detectable; Hours <= 0 is the
        // second half (LabourTime.Explicit/Assumed already guard it, but Create must not
        // trust an unvalidated caller of the struct's implicit default ctor).
        if (time.Basis == LabourTimeBasis.Unspecified || time.Hours <= 0)
        {
            throw new ArgumentException(
                "LabourTime must be explicitly Explicit or Assumed with positive hours — " +
                "default(LabourTime) is not a valid duration.", nameof(time));
        }

        var workerNamesJson = workerNames is null || workerNames.Count == 0
            ? "[]"
            : JsonSerializer.Serialize(workerNames, WorkerNamesSerializerOptions);

        return new(id, dailyLogId, engagementType, maleCount, femaleCount, workerCount,
               wagePerPerson, contractUnit, contractQuantity, totalCost, linkedActivityId, createdAtUtc, time,
               shift, task, workerNamesJson);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CORRECTION (Task 12b.1b, spec: 2026-07-13-labour-attendance-approval-design)
    //
    // "Mutated in place" is what makes a correction visible to every reader
    // without any of them knowing corrections exist. Before this task the class
    // had no mutator at all, so that was not expressible — which invites a later
    // implementer to widen the property setters instead. These are the ONLY two
    // mutators, they are intention-named, and there is deliberately no
    // general-purpose Update: the correctable surface is exactly labour
    // quantity and duration, and nothing else may move.
    //
    // NEITHER TRIPS THE SINGLE-PRODUCER PIN. LabourAnchorRules.
    // LabourAssignment_is_constructed_in_exactly_one_production_file matches the
    // literal string "LabourAssignment.Create(" — these methods call no factory
    // and construct nothing, so the pin stays green and stays MEANINGFUL. Do not
    // "fix" the pin to also cover correction: correction is not construction,
    // and a pin widened to catch it would fire on this very file.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Task 12b.2 — corrects the headcount, all three numbers TOGETHER in one
    /// operation, so the row can never land in a contradictory state such as
    /// <c>WorkerCount=6, Male=5, Female=4</c>.
    ///
    /// <para><b>Silence stays NULL (P4).</b> When none of the three is stated
    /// the count is preserved as <c>null</c> — "we were not told" — rather than
    /// resolved to a fabricated <c>0</c>. This mirrors
    /// <c>LabourAssignmentFactory.FromParsed</c> exactly, so a corrected row and
    /// a freshly recorded row obey the same rule. An explicitly stated 0 still
    /// stores 0 and stays distinguishable from silence.</para>
    /// </summary>
    public void CorrectHeadcount(int? workerCount, int? maleCount, int? femaleCount)
    {
        // The split is stored exactly as stated; only the total is resolved.
        MaleCount = maleCount;
        FemaleCount = femaleCount;
        WorkerCount = (workerCount ?? maleCount ?? femaleCount) is null
            ? null
            : LabourHeadcount.Resolve(workerCount, maleCount, femaleCount);
    }

    /// <summary>
    /// Task 12b.3 — corrects the duration and its basis ATOMICALLY.
    ///
    /// <para>It takes a <see cref="LabourTime"/>, never a bare
    /// <c>decimal</c>, precisely so <see cref="DurationHours"/> can never be
    /// moved without <see cref="TimeBasis"/> travelling with it (P8): a
    /// duration with no provenance is a lie about whether anyone measured
    /// it.</para>
    ///
    /// <para>Validated on the SAME rules as <see cref="Create"/> — an
    /// <see cref="LabourTimeBasis.Unspecified"/> basis or non-positive hours
    /// throws, because <c>default(LabourTime)</c> is reachable through the
    /// struct's implicit parameterless constructor no matter how its named
    /// factories are locked down.</para>
    ///
    /// <para>A reviewer who says nothing about hours must never reach this
    /// method: silence is not a correction, and the existing
    /// <see cref="LabourTimeBasis.Assumed"/> value is then left exactly as it
    /// was rather than overwritten with a guess. That decision belongs to the
    /// caller, which is why there is no "null means leave it" overload
    /// here.</para>
    /// </summary>
    public void CorrectDuration(LabourTime time)
    {
        if (time.Basis == LabourTimeBasis.Unspecified || time.Hours <= 0)
        {
            throw new ArgumentException(
                "LabourTime must be explicitly Explicit or Assumed with positive hours — " +
                "default(LabourTime) is not a valid duration.", nameof(time));
        }

        DurationHours = time.Hours;
        TimeBasis = time.Basis;
    }
}
