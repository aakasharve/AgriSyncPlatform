using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Logs;
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

    private static DailyLogCreatedEvent MakeEvent(Guid? logId = null)
    {
        // LABOUR_PHASE2 P2.1 — the event now carries the farmer's spatial
        // assertion. This projector reads only DailyLogId, so the scope is
        // irrelevant to what is under test here; a plot-scoped event keeps the
        // fixture identical in meaning to what it was before.
        var plotId = Guid.NewGuid();
        return new DailyLogCreatedEvent(
            eventId: Guid.NewGuid(),
            occurredOnUtc: DateTime.UtcNow,
            dailyLogId: logId ?? Guid.NewGuid(),
            farmId: FarmA,
            scope: DailyLogScope.Plot,
            plotIds: [plotId],
            plotId: plotId,
            cropCycleId: Guid.NewGuid(),
            logDate: DateOnly.FromDateTime(DateTime.UtcNow));
    }

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
    public async Task Anti_merge_2026_07_19_creates_a_new_worker_even_when_a_same_named_worker_already_exists()
    {
        // 2026-07-19 founder Decision 5 sub-question 2 (spec
        // 2026-07-13-labour-attendance-approval-design): the projector must
        // NEVER merge across distinct DailyLogCreatedEvent invocations by
        // name alone — two different real people sharing a common name
        // (e.g. रमेश) on the same farm must not collapse into one Worker
        // record. This replaces the old "Reuses_existing_worker_..." test,
        // which asserted the exact behaviour that WAS the bug.
        var (projector, repo, _) = Build(transcript: "आज रमेश आला");
        var existing = new Worker(FarmA, WorkerName.From("रमेश"), DateTimeOffset.UtcNow.AddDays(-3));
        existing.RegisterAssignment(); // existing count = 1 — an unrelated, previously-seen रमेश.
        repo.PreSeedExisting(existing);

        await projector.HandleAsync(MakeEvent(), CancellationToken.None);

        // A brand-new Worker row is created for THIS occurrence — never
        // reused, even though a same-named Worker already exists on the
        // farm. The pre-seeded worker is left completely untouched.
        repo.AddedWorkers.Should().HaveCount(1);
        repo.AddedWorkers.Single().Should().NotBeSameAs(existing);
        repo.AddedAssignments.Should().HaveCount(1);
        existing.AssignmentCount.Should().Be(1, "the pre-existing worker must not be touched by an unrelated occurrence of the same name");
    }

    [Fact]
    public async Task Emits_one_worker_named_event_per_new_assignment()
    {
        var (projector, repo, analytics) = Build(transcript: "आज रमेश आणि सुनील आले");
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

        // 2026-07-19 RULING (founder Decision 5 sub-question 1): analytics.events
        // is append-only (DO INSTEAD NOTHING on UPDATE/DELETE) — a raw name written
        // there can never be scrubbed. The event must carry the Worker's own Guid id
        // (a non-identifying reference), never the raw or normalized name text.
        analytics.Emitted.Should().AllSatisfy(e =>
        {
            e.PropsJson.Should().NotContain("रमेश", "the raw name must never reach the un-scrubbable analytics table");
            e.PropsJson.Should().NotContain("सुनील", "the raw name must never reach the un-scrubbable analytics table");
            e.PropsJson.Should().NotContain("workerName", "the old raw-name field must be gone, not just empty");
            e.PropsJson.Should().NotContain("normalizedName", "the old raw-name field must be gone, not just empty");
            e.PropsJson.Should().Contain("workerId", "a non-identifying worker reference must replace the raw name");
        });
        foreach (var worker in repo.AddedWorkers)
        {
            analytics.Emitted.Should().ContainSingle(e => e.PropsJson.Contains(worker.Id.ToString()),
                "each emitted event's workerId must resolve back to one of the workers this invocation created");
        }
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
        // Test-only bookkeeping of "workers that already exist in the farm's
        // population" — NOT part of IWorkerRepository. The interface
        // deliberately has no find-by-name lookup (2026-07-19 anti-merge
        // fix), so this exists purely so a test can assert a pre-seeded
        // worker is left untouched, never so the projector can consult it.
        public List<Worker> PreSeeded { get; } = [];
        public List<Worker> AddedWorkers { get; } = [];
        public List<WorkerAssignment> AddedAssignments { get; } = [];
        public int SaveCount { get; private set; }

        public void PreSeedExisting(Worker worker) => PreSeeded.Add(worker);

        public void Add(Worker worker) => AddedWorkers.Add(worker);

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
