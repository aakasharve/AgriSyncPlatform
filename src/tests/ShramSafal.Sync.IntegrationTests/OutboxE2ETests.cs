using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING end-to-end (production-config): exercises
/// the full save-side outbox plumbing on
/// <see cref="ShramSafalDbContext"/> in the production interceptor
/// configuration — the same registration that
/// <c>AddShramSafalInfrastructure</c> wires. Adds a
/// <see cref="DailyLog"/> aggregate, calls
/// <c>SaveChangesAsync</c>, and asserts that the
/// <c>DailyLogCreatedEvent</c> the aggregate raised was committed as
/// an <see cref="OutboxMessage"/> row in <c>ssf.outbox_messages</c>
/// in the same transaction.
///
/// <para>
/// This bypasses the HTTP/sync-push surface deliberately — that's
/// already covered by the broader integration tests, which now also
/// exercise the interceptors thanks to the harness change in the
/// same commit. The point of this focused test is to prove the
/// vertical slice end-to-end at the DbContext level.
/// </para>
///
/// <para>
/// The dispatcher / publisher arms of the pipeline are not run here
/// — that's a BackgroundService whose plumbing is shallow. Unit-
/// level coverage of the publisher's deserialize-and-fan-out lives
/// in <c>AgriSync.BuildingBlocks.Tests</c>.
/// </para>
/// </summary>
public sealed class OutboxE2ETests
{
    [Fact]
    public async Task DailyLog_Create_writes_DailyLogCreatedEvent_to_outbox_in_same_SaveChanges()
    {
        var saveSide = new DomainEventToOutboxInterceptor(TimeProvider.System);
        var txSide = new OutboxTransactionInterceptor(saveSide);

        var dbName = $"outbox-e2e-{Guid.NewGuid()}";
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseInMemoryDatabase(dbName)
            .AddInterceptors(saveSide, txSide)
            .Options;

        var farmGuid = Guid.NewGuid();
        var operatorGuid = Guid.NewGuid();
        var plotGuid = Guid.NewGuid();
        var cropCycleGuid = Guid.NewGuid();
        var logId = Guid.NewGuid();

        await using (var ctx = new ShramSafalDbContext(options))
        {
            // Seed the parent farm so the log has a valid FarmId
            // anchor (Farm.Create raises no event today, so it doesn't
            // pollute the outbox count).
            var farm = Farm.Create(new FarmId(farmGuid), "Outbox E2E Farm",
                new UserId(operatorGuid), DateTime.UtcNow);
            ctx.Farms.Add(farm);
            await ctx.SaveChangesAsync();

            // Snapshot baseline outbox count (should be 0 since Farm
            // raises no events).
            var baseline = await ctx.OutboxMessages.CountAsync();
            Assert.Equal(0, baseline);

            // DailyLog.Create raises DailyLogCreatedEvent on the
            // aggregate. Adding it to the context and SaveChangesAsync
            // triggers SavingChangesAsync → the interceptor enqueues
            // an OutboxMessage in the SAME transaction → SavedChangesAsync
            // clears the in-memory queue.
            var log = DailyLog.Create(
                id: logId,
                farmId: new FarmId(farmGuid),
                plotId: plotGuid,
                cropCycleId: cropCycleGuid,
                operatorUserId: new UserId(operatorGuid),
                logDate: new DateOnly(2026, 4, 30),
                idempotencyKey: null,
                location: null,
                createdAtUtc: DateTime.UtcNow);

            ctx.DailyLogs.Add(log);
            await ctx.SaveChangesAsync();

            // Aggregate's in-memory queue must be drained — a retried
            // save must not re-emit.
            Assert.Empty(log.DomainEvents);
        }

        // Reopen the context to prove the OutboxMessage row was
        // genuinely committed (not just in change-tracker memory).
        await using (var ctx = new ShramSafalDbContext(options))
        {
            var rows = await ctx.OutboxMessages.OrderBy(m => m.OccurredOnUtc).ToListAsync();
            Assert.Single(rows);

            var row = rows[0];
            Assert.Contains("DailyLogCreatedEvent", row.Type);
            Assert.False(string.IsNullOrEmpty(row.Payload));
            Assert.Null(row.ProcessedOnUtc);
            Assert.Null(row.Error);
            // Payload must include the log id so a downstream subscriber
            // can correlate. The serializer uses default casing
            // (PropertyNameCaseInsensitive on the way back).
            Assert.Contains(logId.ToString(), row.Payload, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Idempotent_save_does_NOT_emit_duplicate_outbox_rows()
    {
        var saveSide = new DomainEventToOutboxInterceptor(TimeProvider.System);
        var txSide = new OutboxTransactionInterceptor(saveSide);

        var dbName = $"outbox-e2e-idem-{Guid.NewGuid()}";
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseInMemoryDatabase(dbName)
            .AddInterceptors(saveSide, txSide)
            .Options;

        var farmGuid = Guid.NewGuid();
        var operatorGuid = Guid.NewGuid();

        await using var ctx = new ShramSafalDbContext(options);
        ctx.Farms.Add(Farm.Create(new FarmId(farmGuid), "F", new UserId(operatorGuid), DateTime.UtcNow));
        await ctx.SaveChangesAsync();

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: new FarmId(farmGuid),
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid(),
            operatorUserId: new UserId(operatorGuid),
            logDate: new DateOnly(2026, 4, 30),
            idempotencyKey: null,
            location: null,
            createdAtUtc: DateTime.UtcNow);

        ctx.DailyLogs.Add(log);
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.OutboxMessages.CountAsync());

        // A no-op SaveChangesAsync (no new events on any tracked
        // aggregate) must NOT generate additional outbox rows.
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.OutboxMessages.CountAsync());
    }
}
