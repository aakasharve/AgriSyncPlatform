// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3) - shared builders for the product-identity score, points and reads
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Common;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>Names and builders every product-identity test uses. Fake phone numbers only (none are needed here); fixed ids.</summary>
internal static class ProductDay
{
    public static readonly Guid TheFarm = Guid.Parse("33000000-0000-4000-8000-000000000001");
    public static readonly Guid OtherFarm = Guid.Parse("33000000-0000-4000-8000-000000000002");
    public static readonly Guid PlotA = Guid.Parse("33000000-0000-4000-8000-000000000011");
    public static readonly Guid PlotB = Guid.Parse("33000000-0000-4000-8000-000000000012");
    public static readonly Guid Cycle = Guid.Parse("33000000-0000-4000-8000-000000000021");
    public static readonly Guid Speaker = Guid.Parse("33000000-0000-4000-8000-000000000031");
    public static readonly Guid Checker = Guid.Parse("33000000-0000-4000-8000-000000000032");
    public static readonly Guid Owner = Guid.Parse("33000000-0000-4000-8000-000000000033");
    public static readonly Guid Stranger = Guid.Parse("33000000-0000-4000-8000-000000000034");

    /// <summary>The work day. 06:00 UTC on it is 11:30 IST, still the same farm-local day.</summary>
    public static readonly DateOnly Day = new(2026, 11, 8);

    public static DateTime NoonOn(DateOnly day) => day.ToDateTime(new TimeOnly(6, 0), DateTimeKind.Utc);

    // Words the library knows (match-cases.json): Found / Ambiguous / NotFound.
    public const string FoundName = "calcium nitrate";
    public const string FoundName2 = "Progibb";
    public const string AmbiguousName = "GA3";
    public const string UnknownName = "प्रेम गोल्ड";

    public static string FoundId => InputCatalog.Match(FoundName, null).ProductId!;
    public static string FoundId2 => InputCatalog.Match(FoundName2, null).ProductId!;

    /// <summary>A stored content document naming these products in one input event "e1" (slots in order).</summary>
    public static string Document(params string[] names) =>
        "{\"schema\":1,\"inputs\":[{\"id\":\"e1\",\"method\":\"Spray\",\"mix\":["
        + string.Join(",", names.Select((n, i) => $"{{\"id\":\"m{i}\",\"productName\":\"{n}\"}}"))
        + "]}]}";

    /// <summary>A saved record with one spraying task (so the day owes dose, carrier and the product part).</summary>
    public static DailyLog SprayLog(DateOnly? day = null, Guid? plot = null, Guid? speaker = null, Guid? farm = null)
    {
        var logDay = day ?? Day;
        var created = NoonOn(logDay);
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(farm ?? TheFarm), plot ?? PlotA, Cycle, new UserId(speaker ?? Speaker),
            logDay, idempotencyKey: null, location: null, createdAtUtc: created);
        log.AddTask(Guid.NewGuid(), "Spraying", notes: null, occurredAtUtc: created, executionStatus: ExecutionStatus.Completed);
        return log;
    }

    public static DailyLogContent ContentOf(DailyLog log, string document, int version = 1) =>
        DailyLogContent.Create(
            Guid.NewGuid(), log, 1, document, version == 1 ? DailyLogContent.OriginCreate : DailyLogContent.OriginRevision,
            version == 1 ? null : version - 1, log.OperatorUserId, NoonOn(log.LogDate), null, null);

    public static InputIdentityAssertion Answer(
        DailyLog log,
        IdentityVerdict verdict,
        Guid by,
        bool isCheck = false,
        string? productId = null,
        Guid? attachment = null,
        DateTime? at = null,
        string eventId = "e1",
        int slot = 0,
        string spoken = FoundName) =>
        InputIdentityAssertion.Record(
            Guid.NewGuid(), log.FarmId, log.PlotId, log.Id, eventId, slot, spoken,
            verdict == IdentityVerdict.Confirmed ? productId ?? FoundId : productId,
            verdict, verdict == IdentityVerdict.Photo ? attachment ?? Guid.NewGuid() : attachment,
            InputCatalog.Version, new UserId(by), at ?? NoonOn(log.LogDate), Guid.NewGuid().ToString("N"), isCheck);

    public static Attachment PhotoRow(Guid id, Guid? farm = null) =>
        Attachment.Create(id, new FarmId(farm ?? TheFarm), Guid.NewGuid(), "InputIdentityAssertion", "packet.jpg", "image/jpeg",
            new UserId(Speaker), NoonOn(Day));

    /// <summary>The newest row per (record, event, slot, speaker-or-check): what the real repository member returns.</summary>
    public static IReadOnlyList<InputIdentityAssertion> Newest(IEnumerable<InputIdentityAssertion> rows) =>
        rows.GroupBy(a => (a.DailyLogId, a.InputEventId, a.MixIndex, a.IsCheck))
            .Select(g => g.OrderByDescending(a => a.AssertedAtUtc).ThenByDescending(a => a.Id).First())
            .ToList();
}

/// <summary>
/// The store behind the product-identity tests: strict (every member the day's score and points do not read throws), holding
/// records, their latest content, answers and attachment rows, and the farm-day rows the recompute writes.
/// </summary>
internal class ProductRepo : FakeShramSafalRepository, IShramSafalRepository
{
    public List<DailyLog> Logs { get; } = [];
    public Dictionary<Guid, DailyLogContent> Contents { get; } = [];
    public List<InputIdentityAssertion> Answers { get; } = [];
    public Dictionary<Guid, Attachment> Attachments { get; } = [];
    public List<DailyRichnessAggregate> Aggregates { get; } = [];
    public List<Plot> Plots { get; } = [];
    public HashSet<Guid> Members { get; } = [];
    public Dictionary<Guid, AppRole> Roles { get; } = [];

    public DailyLog AddLog(DailyLog log, string? document)
    {
        Logs.Add(log);
        if (document is not null)
        {
            Contents[log.Id] = ProductDay.ContentOf(log, document);
        }

        return log;
    }

    public override Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<DailyLog>>(Logs.Where(l => (Guid)l.FarmId == farmId && l.LogDate == localDate).ToList());

    public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) =>
        Task.FromResult(Logs.FirstOrDefault(l => l.Id == dailyLogId));

    public override Task<IReadOnlyList<ObservationEvent>> GetObservationEventsForDailyLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ObservationEvent>>([]);

    public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) =>
        Task.FromResult(Aggregates.FirstOrDefault(a => a.FarmId == farmId && a.LocalDate == localDate));

    public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) =>
        GetDailyRichnessAggregateAsync(farmId, localDate, ct);

    public override Task AddDailyRichnessAggregateAsync(DailyRichnessAggregate aggregate, CancellationToken ct = default)
    {
        Aggregates.Add(aggregate);
        return Task.CompletedTask;
    }

    public override Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) =>
        Task.FromResult(Attachments.GetValueOrDefault(attachmentId));

    Task<IReadOnlyList<DailyLogContent>> IShramSafalRepository.GetCurrentDailyLogContentsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<DailyLogContent>>(dailyLogIds.Where(Contents.ContainsKey).Select(id => Contents[id]).ToList());

    public override Task<IReadOnlyList<InputIdentityAssertion>> GetLatestInputIdentityAssertionsForLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default) =>
        Task.FromResult(ProductDay.Newest(Answers.Where(a => dailyLogIds.Contains(a.DailyLogId))));

    public override Task<IReadOnlyList<InputIdentityAssertion>> GetInputIdentityAssertionsForLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<InputIdentityAssertion>>(
            Answers.Where(a => dailyLogIds.Contains(a.DailyLogId)).OrderBy(a => a.AssertedAtUtc).ThenBy(a => a.Id).ToList());

    public override Task<IReadOnlyList<InputIdentityAssertion>> GetInputIdentityAssertionsGivenBetweenAsync(Guid farmId, DateTime fromUtc, DateTime toUtcExclusive, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<InputIdentityAssertion>>(
            Answers.Where(a => (Guid)a.FarmId == farmId && a.AssertedAtUtc >= fromUtc && a.AssertedAtUtc < toUtcExclusive)
                .OrderBy(a => a.AssertedAtUtc).ToList());

    // The reads the per-plot and the approval-queue handlers use.
    public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
        Task.FromResult(farmId == ProductDay.TheFarm && (Members.Contains(userId) || Roles.ContainsKey(userId)));

    public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
        Task.FromResult<AppRole?>(farmId == ProductDay.TheFarm && Roles.TryGetValue(userId, out var role) ? role : null);

    public override Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) =>
        Task.FromResult(Plots.Where(p => (Guid)p.FarmId == farmId).ToList());
}

internal sealed class NoJobs : IAiJobRepository
{
    public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => Task.FromResult<AiJob?>(null);
    public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddAsync(AiJob job, CancellationToken ct = default) => throw new NotSupportedException();
    public Task UpdateAsync(AiJob job, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => throw new NotSupportedException();
    public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => throw new NotSupportedException();
    public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
}

internal sealed class SeqIds : IIdGenerator
{
    private int n;

    public Guid New()
    {
        n++;
        var bytes = new byte[16];
        BitConverter.GetBytes(n).CopyTo(bytes, 0);
        bytes[15] = 0x77;
        return new Guid(bytes);
    }
}

internal sealed class ClockAt(DateTime utcNow) : IClock
{
    public DateTime UtcNow { get; } = utcNow;
}
