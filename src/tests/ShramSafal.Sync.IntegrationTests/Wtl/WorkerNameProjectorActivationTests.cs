// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Infrastructure.Wtl;
using Testcontainers.PostgreSql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Wtl;

/// <summary>
/// Task 2.4 (spec: 2026-07-13-labour-attendance-approval-design) — proves
/// the dormant <see cref="WorkerNameProjector"/> is genuinely activated by
/// the real <see cref="DailyLogTranscriptStore"/>: a voice-sourced
/// <see cref="DailyLog"/> whose <see cref="DailyLog.SourceAiJobId"/> points
/// at an AI job carrying a matching <see cref="Transcript"/> row produces a
/// <c>Worker</c> + <c>WorkerAssignment</c> after the SAME
/// <c>DailyLogCreatedEvent</c> outbox row a real <c>OutboxDispatcher</c>
/// cycle would deliver.
///
/// <para>
/// <b>Real pipeline, minimal harness.</b> This drives the actual
/// <see cref="DomainEventToOutboxInterceptor"/> / <see cref="OutboxTransactionInterceptor"/>
/// pair (same classes <c>AddShramSafalInfrastructure</c> wires) so
/// <c>DailyLog.Create</c>'s raised event genuinely lands in
/// <c>ssf.outbox_messages</c>, then replays it through
/// <see cref="OutboxDispatcher.RunCycleAsync"/> + a real
/// <see cref="InProcessOutboxPublisher"/> so the SAME deserialize-and-fan-out
/// path a production cycle uses invokes the real, DI-shaped
/// <see cref="WorkerNameProjector"/> — built from the real
/// <see cref="DailyLogTranscriptStore"/>, <see cref="WorkerRepository"/>,
/// and <see cref="ShramSafal.Infrastructure.Wtl.RegexWorkerNameExtractor"/>.
/// It intentionally skips <c>TenantConnectionInterceptor</c> (an orthogonal
/// RLS concern — see <c>GetLabourDataHandlerTests</c>'s doc comment on why
/// the Testcontainers bootstrap role already bypasses RLS) so the test
/// stays focused on the WTL activation seam.
/// </para>
///
/// <para>
/// <b>Transcript choice.</b> The seeded <see cref="Transcript"/> row is
/// written directly (bypassing <c>ParseVoiceInputHandler</c>'s PII-detector
/// call entirely) — exactly mirroring what the real write path persists
/// into <c>ssf.transcripts</c> for a transcript the third-party PII
/// detector scored as clean. See <c>DailyLogTranscriptStore</c>'s remarks
/// and the Task 2.4 report for why a transcript naming TWO dictionary-known
/// workers together would instead arrive here already redacted.
/// </para>
///
/// <para>
/// <b>Docker-gated.</b> <c>[Collection("RequiresDocker")]</c> +
/// <c>[Trait("Category","RequiresDocker")]</c> — same convention as the
/// sibling Labour tests. Local Docker-less environments (project policy —
/// see <c>feedback_avoid_docker_local_dev</c>) skip this test entirely; the
/// GitHub Actions <c>RequiresDocker</c> sweep runs it against a real
/// <c>postgres:16-alpine</c> container.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class WorkerNameProjectorActivationTests : IAsyncLifetime
{
#pragma warning disable CS0618 // parameterless PostgreSqlBuilder ctor obsolete in Testcontainers 4.x
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private string _conn = default!;
    private DomainEventToOutboxInterceptor _saveInterceptor = default!;
    private OutboxTransactionInterceptor _txInterceptor = default!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        _conn = _pg.GetConnectionString();
        await IntegrationMigrationChain.ApplyAsync(_conn);

        _saveInterceptor = new DomainEventToOutboxInterceptor(TimeProvider.System);
        _txInterceptor = new OutboxTransactionInterceptor(_saveInterceptor);
    }

    public async Task DisposeAsync()
    {
        await _pg.DisposeAsync();
    }

    /// <summary>Write-side context — carries the outbox interceptor pair.</summary>
    private ShramSafalDbContext NewWriteDbContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_conn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .AddInterceptors(_saveInterceptor, _txInterceptor)
            .Options);

    /// <summary>Plain context — no interceptors; used for reads/projector work/assertions.</summary>
    private ShramSafalDbContext NewPlainDbContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_conn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options);

    private OutboxDbContext NewOutboxDbContext() =>
        new(new DbContextOptionsBuilder<OutboxDbContext>().UseNpgsql(_conn).Options);

    [Fact]
    public async Task Voice_sourced_log_with_matching_transcript_creates_worker_and_assignment()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var aiJobId = Guid.NewGuid();
        var logId = Guid.NewGuid();

        // "रमेश आणि विलास आले" — matches RegexWorkerNameExtractor's
        // PairWithVerb pattern (name + आणि + name + आले), which captures
        // BOTH group(1) "रमेश" and group(2) "विलास" — neither is filtered
        // by the extractor's stopword list, so WorkerNameProjector creates
        // TWO Worker rows (and two WorkerAssignments) for this transcript,
        // same shape as the domain-level
        // Creates_workers_and_assignments_for_two_extracted_names test.
        // Separately: only "रमेश" is in the heuristic worker-name
        // dictionary and "विलास" carries no marker word, so
        // HeuristicWorkerNameDetector would score this transcript at the
        // discard threshold (Clean) rather than redact it — i.e. this is a
        // transcript that genuinely survives the real write-path's PII
        // gate unredacted. See DailyLogTranscriptStore's remarks for the
        // two-name case that does NOT survive.
        const string transcript = "रमेश आणि विलास आले";

        await using (var writeDb = NewWriteDbContext())
        {
            var repo = new ShramSafalRepository(writeDb);

            var farm = Farm.Create(farmId, "Task 2.4 WTL Activation Farm", ownerUserId, now);
            farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
            await repo.AddFarmAsync(farm);

            var aiJob = AiJob.Create(
                id: aiJobId,
                idempotencyKey: $"wtl-activation-{aiJobId}",
                operationType: AiOperationType.VoiceToStructuredLog,
                userId: ownerUserId.Value,
                farmId: farmId.Value,
                inputContentHash: null,
                rawInputRef: null);
            writeDb.AiJobs.Add(aiJob);

            var transcriptRow = Transcript.Create(
                aiJobId: aiJobId,
                aiJobAttemptId: Guid.NewGuid(),
                text: transcript,
                languageTag: "mr-IN",
                perTokenConfidenceJson: "[]");
            await repo.AddTranscriptAsync(transcriptRow);

            var log = DailyLog.Create(
                id: logId,
                farmId: farmId,
                plotId: Guid.NewGuid(),
                cropCycleId: Guid.NewGuid(),
                operatorUserId: ownerUserId,
                logDate: DateOnly.FromDateTime(now),
                idempotencyKey: null,
                location: null,
                createdAtUtc: now,
                sourceAiJobId: aiJobId);
            await repo.AddDailyLogAsync(log);

            await repo.SaveChangesAsync();
        }

        var processed = await DispatchOutboxOnceAsync();
        processed.Should().Be(1, "the DailyLog.Create outbox row is the only pending message");

        await using var readDb = NewPlainDbContext();
        var workers = await readDb.Workers.Where(w => w.FarmId == farmId).ToListAsync();
        workers.Should().HaveCount(2, "PairWithVerb captures BOTH names in \"रमेश आणि विलास आले\" and neither is stopword-filtered");
        workers.Select(w => w.Name.Raw).Should().BeEquivalentTo(new[] { "रमेश", "विलास" });

        foreach (var worker in workers)
        {
            var assignments = await readDb.WorkerAssignments
                .Where(a => a.WorkerId == worker.Id)
                .ToListAsync();
            assignments.Should().ContainSingle(a => a.DailyLogId == logId,
                $"the projector must link a WorkerAssignment to the seeded DailyLog for {worker.Name.Raw}");
        }
    }

    [Fact]
    public async Task Manual_log_without_source_ai_job_id_no_ops_without_exception()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var logId = Guid.NewGuid();

        await using (var writeDb = NewWriteDbContext())
        {
            var repo = new ShramSafalRepository(writeDb);

            var farm = Farm.Create(farmId, "Task 2.4 Manual-Log No-Op Farm", ownerUserId, now);
            farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
            await repo.AddFarmAsync(farm);

            // Manual log — no SourceAiJobId. DailyLogTranscriptStore must
            // return null (no AiJob to resolve a transcript through) and
            // the projector must no-op cleanly.
            var log = DailyLog.Create(
                id: logId,
                farmId: farmId,
                plotId: Guid.NewGuid(),
                cropCycleId: Guid.NewGuid(),
                operatorUserId: ownerUserId,
                logDate: DateOnly.FromDateTime(now),
                idempotencyKey: null,
                location: null,
                createdAtUtc: now);
            await repo.AddDailyLogAsync(log);

            await repo.SaveChangesAsync();
        }

        var act = async () => await DispatchOutboxOnceAsync();
        var processed = await act.Should().NotThrowAsync();
        processed.Subject.Should().Be(1, "the manual log's outbox row is still dispatched (and marked processed) even though the projector no-ops");

        await using var readDb = NewPlainDbContext();
        (await readDb.Workers.AnyAsync(w => w.FarmId == farmId)).Should().BeFalse(
            "a manual log has no transcript to extract names from — no Worker rows may appear");
        (await readDb.WorkerAssignments.AnyAsync(a => a.DailyLogId == logId)).Should().BeFalse();

        var outboxRow = await NewOutboxDbContext().OutboxMessages.SingleAsync(m => m.Payload.Contains(logId.ToString()));
        outboxRow.ProcessedOnUtc.Should().NotBeNull("the outbox message must be marked processed, not stuck retrying");
        outboxRow.Error.Should().BeNull();
    }

    /// <summary>
    /// Runs exactly one real <see cref="OutboxDispatcher"/> cycle wired to
    /// the real, activated <see cref="WorkerNameProjector"/> — built from
    /// the real <see cref="DailyLogTranscriptStore"/>,
    /// <see cref="WorkerRepository"/>, and
    /// <see cref="ShramSafal.Infrastructure.Wtl.RegexWorkerNameExtractor"/>,
    /// exactly as <c>AddShramSafalInfrastructure</c> now wires them post-
    /// Task-2.4. Returns the number of outbox rows the cycle processed.
    /// </summary>
    private async Task<int> DispatchOutboxOnceAsync()
    {
        await using var projectorDb = NewPlainDbContext();
        await using var outboxDb = NewOutboxDbContext();

        var projector = new WorkerNameProjector(
            transcriptStore: new DailyLogTranscriptStore(projectorDb),
            workers: new WorkerRepository(projectorDb),
            extractor: new ShramSafal.Infrastructure.Wtl.RegexWorkerNameExtractor(),
            analytics: new NoOpAnalyticsWriter(),
            clock: new FixedClock(DateTime.UtcNow),
            logger: NullLogger<WorkerNameProjector>.Instance);

        var registry = new SingleHandlerRegistry(new ProjectorHandlerAdapter(projector));
        var publisher = new InProcessOutboxPublisher(registry, NullLogger<InProcessOutboxPublisher>.Instance);

        return await OutboxDispatcher.RunCycleAsync(
            outboxDb,
            publisher,
            TimeProvider.System,
            NullLogger.Instance,
            OutboxDispatcher.DefaultMaxAttempts,
            CancellationToken.None);
    }

    // ── Minimal outbox-dispatch harness ─────────────────────────────────

    private sealed class ProjectorHandlerAdapter(IWorkerNameProjector projector) : IDomainEventHandlerAdapter
    {
        public async Task HandleAsync(IDomainEvent domainEvent, CancellationToken cancellationToken)
        {
            var typed = (ShramSafal.Domain.Events.DailyLogCreatedEvent)domainEvent;
            await projector.HandleAsync(typed, cancellationToken);
        }
    }

    private sealed class SingleHandlerRegistry(IDomainEventHandlerAdapter adapter) : IDomainEventHandlerRegistry
    {
        public IReadOnlyList<IDomainEventHandlerAdapter> ResolveHandlers(Type eventType) =>
            eventType == typeof(ShramSafal.Domain.Events.DailyLogCreatedEvent)
                ? new[] { adapter }
                : Array.Empty<IDomainEventHandlerAdapter>();
    }

    private sealed class NoOpAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }
}
