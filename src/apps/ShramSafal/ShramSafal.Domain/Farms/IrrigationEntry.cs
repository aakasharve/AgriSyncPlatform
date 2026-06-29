using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §2; plan §3.2e) — one
/// irrigation/fertigation/spray-carrier entry. EXISTS-join child: carries only the
/// parent FK (<see cref="DailyLogId"/>), no own farm_id, no Provenance, no version
/// chain (children replaced wholesale on parent supersession).
/// </summary>
public sealed class IrrigationEntry : Entity<Guid>
{
    private IrrigationEntry() : base(Guid.Empty) { } // EF Core

    private IrrigationEntry(
        Guid id, Guid dailyLogId, IrrigationRole role, bool weatherAdjusted,
        string? method, string? source, decimal? durationHours, decimal? waterVolumeLitres,
        Guid? linkedActivityId, DateTime createdAtUtc)
        : base(id)
    {
        DailyLogId = dailyLogId;
        Role = role;
        WeatherAdjusted = weatherAdjusted;
        Method = method;
        Source = source;
        DurationHours = durationHours;
        WaterVolumeLitres = waterVolumeLitres;
        LinkedActivityId = linkedActivityId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public IrrigationRole Role { get; private set; }
    public bool WeatherAdjusted { get; private set; }          // weather cut/adjusted the duration (plan §3.2e)
    public string? Method { get; private set; }                // drip / flood / sprinkler ...
    public string? Source { get; private set; }                // borewell / canal ...
    public decimal? DurationHours { get; private set; }
    public decimal? WaterVolumeLitres { get; private set; }
    public Guid? LinkedActivityId { get; private set; }        // spray-carrier → its ApplicationBatch/operation
    public DateTime CreatedAtUtc { get; private set; }

    public static IrrigationEntry Create(
        Guid id, Guid dailyLogId, IrrigationRole role, bool weatherAdjusted,
        string? method, string? source, decimal? durationHours, decimal? waterVolumeLitres,
        Guid? linkedActivityId, DateTime createdAtUtc)
        => new(id, dailyLogId, role, weatherAdjusted, method, source,
               durationHours, waterVolumeLitres, linkedActivityId, createdAtUtc);
}
