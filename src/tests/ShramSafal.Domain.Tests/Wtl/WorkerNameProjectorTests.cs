using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Wtl;
using ShramSafal.Infrastructure.Wtl;
using Xunit;

namespace ShramSafal.Domain.Tests.Wtl;

/// <summary>
/// Behaviour matrix for <see cref="WorkerNameProjector"/> — DWC v2 §2.10.
/// </summary>
/// <remarks>
/// <para>
/// The projector subscribes to <c>DailyLogCreatedEvent</c>, resolves the
/// transcript via <see cref="IDailyLogTranscriptStore"/>, runs the regex
/// extractor, and writes <c>Worker</c> + <c>WorkerAssignment</c> rows
/// through <see cref="IWorkerRepository"/>. These tests use in-memory
/// fakes for both the store and the repository so the contract is
/// asserted without standing up EF Core.
/// </para>
/// </remarks>
public sealed class WorkerNameProjectorTests
{
    private static readonly FarmId FarmA = new(Guid.Parse("11111111-1111-4111-8111-111111111111"));

    private static DailyLogCreatedEvent MakeEvent(Guid? logId = null) => new(
        eventId: Guid.NewGuid(),
        occurredOnUtc: DateTime.UtcNow,
        dailyLogId: logId ?? Guid.NewGuid(),
        farmId: FarmA,
        plotId: Guid.NewGuid(),
        cropCycleId: Guid.NewGuid(),
        logDate: DateOnly.FromDateTime(DateTime.UtcNow));

    private static (WorkerNameProjector projector, FakeWorkerRepo repo, FakeAnalyticsWriter analytics) Build(
        string? transcript)
    {
        var repo = new FakeWorkerRepo();
        var analytics = new FakeAnalyticsWriter();
        var projector = new WorkerNameProjector(
            transcriptStore: new FakeTranscriptStore(transcript),
            workers: repo,
            extractor: new RegexWorkerNameExtractor(),
            analytics: analytics,
            clock: new FixedClock(new DateTime(2026, 5, 3, 10, 0, 0, DateTimeKind.Utc)),
            logger: NullLogger<WorkerNameProjector>.Instance);
        return (projector, repo, analytics);
    }

    [Fact]
    public async Task NoOps_when_transcript_is_null()
    {
        var (projector, repo, analytics) = Build(transcript: null);

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().BeEmpty();
        repo.AddedAssignments.Should().BeEmpty();
        repo.SaveCount.Should().Be(0);
        analytics.Emitted.Should().BeEmpty();
    }

    [Fact]
    public async Task NoOps_when_transcript_is_whitespace()
    {
        var (projector, repo, analytics) = Build(transcript: "   ");

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().BeEmpty();
        repo.AddedAssignments.Should().BeEmpty();
        analytics.Emitted.Should().BeEmpty();
    }

    [Fact]
    public async Task NoOps_when_extractor_returns_no_names()
    {
        // "दोन मजूर आले" — extractor returns empty per the precision-over-recall rules.
        var (projector, repo, analytics) = Build(transcript: "दोन मजूर आले");

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().BeEmpty();
        repo.AddedAssignments.Should().BeEmpty();
        analytics.Emitted.Should().BeEmpty();
    }

    [Fact]
    public async Task Creates_workers_and_assignments_for_two_extracted_names()
    {
        var (projector, repo, analytics) = Build(transcript: "आज रमेश आणि सुनील आले");
        var ev = MakeEvent();

        await projector.HandleAsync(ev, CancellationToken.None);

        repo.AddedWorkers.Should().HaveCount(2);
        repo.AddedWorkers.Select(w => w.Name.Raw).Should().BeEquivalentTo(new[] { "रमेश", "सुनील" });
        repo.AddedWorkers.Should().AllSatisfy(w => w.FarmId.Should().Be(FarmA));
        repo.AddedAssignments.Should().HaveCount(2);
        repo.AddedAssignments.Should().AllSatisfy(a =>
        {
            a.DailyLogId.Should().Be(ev.DailyLogId);
            a.Confidence.Should().Be(0.85m);
        });
        repo.SaveCount.Should().Be(1);
    }

    [Fact]
    public async Task Increments_assignment_count_on_each_new_worker()
    {
        var (projector, repo, _) = Build(transcript: "आज रमेश आणि सुनील आले");

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().AllSatisfy(w => w.AssignmentCount.Should().Be(1));
    }

    [Fact]
    public async Task Reuses_existing_worker_for_known_normalized_name()
    {
        var (projector, repo, _) = Build(transcript: "आज रमेश आला");
        // Pre-seed: Ramesh already known on the farm with a previous assignment.
        var existing = new Worker(FarmA, WorkerName.From("रमेश"), DateTimeOffset.UtcNow.AddDays(-3));
        existing.RegisterAssignment(); // existing count = 1
        repo.PreSeedExisting(existing);

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().BeEmpty(); // No NEW worker added.
        repo.AddedAssignments.Should().HaveCount(1);
        existing.AssignmentCount.Should().Be(2);
    }

    [Fact]
    public async Task Emits_one_worker_named_event_per_new_assignment()
    {
        var (projector, _, analytics) = Build(transcript: "आज रमेश आणि सुनील आले");
        var ev = MakeEvent();

        await projector.HandleAsync(ev, CancellationToken.None);

        analytics.Emitted.Should().HaveCount(2);
        analytics.Emitted.Should().AllSatisfy(e =>
        {
            e.EventType.Should().Be("worker.named");
            e.FarmId.Should().Be(FarmA);
            e.ActorRole.Should().Be("system");
            e.Trigger.Should().Be("wtl.projector");
            e.SchemaVersion.Should().Be("v1");
            e.PropsJson.Should().Contain(ev.DailyLogId.ToString());
        });
    }

    [Fact]
    public async Task Dedupes_duplicate_names_within_single_transcript()
    {
        // Same name appears twice — should produce one worker, one assignment.
        var (projector, repo, analytics) = Build(transcript: "रमेश आणि रमेश आले");

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        repo.AddedWorkers.Should().HaveCount(1);
        repo.AddedAssignments.Should().HaveCount(1);
        analytics.Emitted.Should().HaveCount(1);
    }

    // ── Fakes ──────────────────────────────────────────────────────────

    private sealed class FakeTranscriptStore(string? transcript) : IDailyLogTranscriptStore
    {
        public Task<string?> GetTranscriptAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(transcript);
    }

    private sealed class FakeWorkerRepo : IWorkerRepository
    {
        private readonly Dictionary<(FarmId, string), Worker> _byNormalized = new();
        public List<Worker> AddedWorkers { get; } = [];
        public List<WorkerAssignment> AddedAssignments { get; } = [];
        public int SaveCount { get; private set; }

        public void PreSeedExisting(Worker worker)
        {
            _byNormalized[(worker.FarmId, worker.Name.Normalized)] = worker;
        }

        public Task<Worker?> FindByNormalizedNameAsync(FarmId farmId, string normalized, CancellationToken ct = default)
            => Task.FromResult(_byNormalized.TryGetValue((farmId, normalized), out var w) ? w : null);

        public void Add(Worker worker)
        {
            AddedWorkers.Add(worker);
            _byNormalized[(worker.FarmId, worker.Name.Normalized)] = worker;
        }

        public void AddAssignment(WorkerAssignment assignment) => AddedAssignments.Add(assignment);

        public Task<IReadOnlyList<Worker>> GetTopByAssignmentCountAsync(FarmId farmId, int limit, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<Worker>>([]);

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCount += 1;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAnalyticsWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Emitted { get; } = [];
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
        {
            Emitted.Add(analyticsEvent);
            return Task.CompletedTask;
        }
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
        {
            Emitted.AddRange(events);
            return Task.CompletedTask;
        }
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }
}
