// spec: 2026-08-28-labour-v2-release-1 (Task 8.5, B001 named observer)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Labour V2 R1 Task 8.5, B001 ruling — the disturbance dedup's residual has a
/// NAMED OBSERVER, and this pins it.
///
/// <para>The farm-day lookup-before-write in <c>LedgerDerivationService</c> is
/// application-level, not DB-enforced: two DEVICES pushing the same (farm, day,
/// byte-identical reason) in overlapping READ-COMMITTED transactions can both
/// miss the lookup and both commit — a duplicate identical row, the pre-fix
/// status quo. That residual is tolerated (edge window, downstream-idempotent,
/// and the schema cure is a two-truths shape this release forbids) but it must
/// not be SILENT: per this repo's law that a swallowed failure names its
/// landing place, <c>ShramSafalRepository.GetDisturbanceEventForFarmDayAsync</c>
/// notices &gt;1 live matches for one identity and warns — farm, day, count and
/// reason LENGTH only, never the reason text (the farmer's free text may be
/// sensitive). So a raced duplicate surfaces at the next same-day derivation
/// instead of never.</para>
///
/// <para>EF-InMemory harness on the REAL <c>ShramSafalRepository</c> — the
/// observer's logic (materialize, count, warn, return oldest) is
/// provider-independent; the Npgsql translation of the identical query is
/// already proven by the RequiresPostgres F2 suite, which runs through this
/// same method via the handler.</para>
/// </summary>
public sealed class DisturbanceDedupObserverTests
{
    private static readonly Guid FarmGuid = Guid.Parse("dddd1111-1111-1111-1111-111111111111");
    private static readonly Guid PlotGuid = Guid.Parse("dddd2222-2222-2222-2222-222222222222");
    private static readonly Guid CropCycleGuid = Guid.Parse("dddd3333-3333-3333-3333-333333333333");
    private static readonly Guid OperatorGuid = Guid.Parse("dddd4444-4444-4444-4444-444444444444");
    private static readonly DateOnly LogDate = new(2026, 6, 20);
    private static readonly DateTime FixedNow = new(2026, 6, 20, 8, 0, 0, DateTimeKind.Utc);

    // Devanagari on purpose: the assertion below proves the farmer's words are
    // NOT reproduced in the warning, only their length.
    private const string RainReason = "पाऊस आला, काम थांबलं";

    [Fact]
    public async Task two_identical_live_rows_fire_the_warning_and_the_oldest_wins()
    {
        await using var db = NewInMemoryDb();
        var log1 = MakeLog(Guid.Parse("dddd5555-5555-5555-5555-555555555555"));
        var log2 = MakeLog(Guid.Parse("dddd6666-6666-6666-6666-666666666666"));
        var older = MakeDisturbance(Guid.Parse("dddd7777-7777-7777-7777-777777777777"), log1.Id, RainReason, FixedNow);
        var newer = MakeDisturbance(Guid.Parse("dddd8888-8888-8888-8888-888888888888"), log2.Id, RainReason, FixedNow.AddMinutes(5));
        db.AddRange(log1, log2, older, newer);
        await db.SaveChangesAsync();

        var logger = new CapturingLogger();
        var repository = new ShramSafalRepository(db, logger);

        var result = await repository.GetDisturbanceEventForFarmDayAsync(FarmGuid, LogDate, RainReason);

        result.Should().NotBeNull();
        result!.Id.Should().Be(older.Id, "the OLDEST live row answers deterministically for a raced day");

        logger.Entries.Should().ContainSingle(e => e.Level == LogLevel.Warning,
            "a duplicate identity is the B001 residual and must be NOTICED, not silent");
        var message = logger.Entries.Single(e => e.Level == LogLevel.Warning).Message;
        message.Should().Contain("2", "the live count names the size of the duplication");
        message.Should().Contain(FarmGuid.ToString(), "the farm locates the duplicate");
        message.Should().Contain(RainReason.Length.ToString(), "the reason LENGTH is the identity hint");
        message.Should().NotContain(RainReason,
            "the reason is the farmer's free text and may be sensitive — never reproduced in logs");
    }

    [Fact]
    public async Task a_single_live_row_returns_quietly_with_no_warning()
    {
        // The observer must not cry wolf: the ordinary one-row day logs nothing.
        await using var db = NewInMemoryDb();
        var log = MakeLog(Guid.Parse("dddd5555-5555-5555-5555-555555555555"));
        var only = MakeDisturbance(Guid.Parse("dddd7777-7777-7777-7777-777777777777"), log.Id, RainReason, FixedNow);
        db.AddRange(log, only);
        await db.SaveChangesAsync();

        var logger = new CapturingLogger();
        var repository = new ShramSafalRepository(db, logger);

        var result = await repository.GetDisturbanceEventForFarmDayAsync(FarmGuid, LogDate, RainReason);

        result.Should().NotBeNull();
        result!.Id.Should().Be(only.Id);
        logger.Entries.Should().BeEmpty("one live row per identity is the healthy state");
    }

    // ── harness ──────────────────────────────────────────────────────────────

    private static ShramSafalDbContext NewInMemoryDb()
        => new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseInMemoryDatabase($"disturbance-observer-{Guid.NewGuid()}")
            .Options);

    private static DailyLog MakeLog(Guid logId)
        => DailyLog.Create(
            id: logId,
            farmId: new FarmId(FarmGuid),
            plotId: PlotGuid,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorGuid),
            logDate: LogDate,
            idempotencyKey: $"log-key-{logId:N}",
            location: null,
            createdAtUtc: FixedNow,
            provenance: Provenance.Manual("1.2.3"),
            sourceAiJobId: null);

    private static DisturbanceEvent MakeDisturbance(Guid id, Guid dailyLogId, string reason, DateTime createdAtUtc)
        => DisturbanceEvent.Create(
            id: id,
            dailyLogId: dailyLogId,
            scope: DisturbanceScope.Partial,
            reason: reason,
            severity: null,
            blockedSegmentsJson: null,
            weatherEventId: null,
            createdAtUtc: createdAtUtc);

    private sealed class CapturingLogger : ILogger<ShramSafalRepository>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }
}
