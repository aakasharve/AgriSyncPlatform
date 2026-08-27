// spec: dfes-companion-2026-07-11 (wave-4.4) — founder model, 2026-08-17.
//
// The founder's scenario, run end to end through the handler:
//
//   "when Patil Farms want to hire Ramesh they must not be able to see what he did at ARVE
//    Farms in exact things — but must be able to see what ARVE Farm reviewed about him
//    [plus] Shram Safal generated number of completed tasks or completed field work hours."
//
// So each test here asks two questions of the same repository at once: what DID travel
// (tiers 2 and 3) and what did NOT (tier 1). Asserting only the first would prove the
// feature works; asserting only the second would prove nothing at all, since a handler
// that returned an error every time would pass it. Both together are the design.

using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;
using ShramSafal.Application.UseCases.Work.GetWorkerReputation;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class WorkerReputationTravelsWithHimTests
{
    private static readonly DateTime Now = new(2026, 8, 17, 8, 0, 0, DateTimeKind.Utc);

    private static readonly Guid ArveGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid PatilGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly FarmId Arve = new(ArveGuid);
    private static readonly FarmId Patil = new(PatilGuid);
    private static readonly Guid PlotGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");

    private static readonly Guid RameshGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId Ramesh = new(RameshGuid);

    private static readonly Guid PatilOwnerGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly UserId PatilOwner = new(PatilOwnerGuid);
    private static readonly UserId ArveOwner = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    // ── The headline ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Patil_Farms_gets_ARVE_Farms_word_and_a_count_and_none_of_ARVE_Farms_data()
    {
        var repo = FullRepo(workerConsented: true);

        var reputation = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        reputation.IsSuccess.Should().BeTrue();

        // TIER 2 — ARVE's own word came across, and it says who is vouching.
        var fromArve = reputation.Value!.Statements.Should()
            .ContainSingle(s => s.FarmId == ArveGuid).Subject;
        fromArve.FarmName.Should().Be("ARVE Farms",
            "a reader must know who is vouching, not just that somebody did");
        fromArve.Remark.Should().Contain("sprayer");

        // TIER 3 — the count Shram Safal derived, across both farms.
        reputation.Value.CompletedTasks.Should().Be(2);
        reputation.Value.CrossedFarmBoundary.Should().BeTrue("this is what he licensed");

        // TIER 1 — and ARVE's operational detail did NOT come with it. Same repository,
        // same caller, same worker: the job-card read still hands back only Patil's own
        // card. This is the half of the founder's sentence that is easy to lose.
        var jobCards = await new GetJobCardsForWorkerHandler(repo).HandleAsync(
            new GetJobCardsForWorkerQuery(Ramesh, PatilOwner));

        jobCards.IsSuccess.Should().BeTrue();
        jobCards.Value!.Should().ContainSingle().Which.FarmId.Should().Be(PatilGuid,
            "what he did at ARVE in exact things stays at ARVE");
    }

    // ── Consent is the switch, and it is his ────────────────────────────────────────

    [Fact]
    public async Task Without_his_consent_ARVE_Farms_word_stays_at_ARVE_Farms()
    {
        var repo = FullRepo(workerConsented: false);

        var reputation = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        reputation.IsSuccess.Should().BeTrue(
            "Patil may still read its own half — narrowing, not refusing, is the rule");
        reputation.Value!.Statements.Should().ContainSingle()
            .Which.FarmId.Should().Be(PatilGuid);
        reputation.Value.CompletedTasks.Should().Be(1, "only the work done at Patil");
        reputation.Value.CrossedFarmBoundary.Should().BeFalse();

        // POSITIVE CONTROL is the headline test above, on the identical repository with
        // consent recorded: two statements, count of 2. Without that pairing the single
        // statement here could equally be a handler that never reads ARVE's rows at all.
    }

    [Fact]
    public async Task A_stranger_gets_nothing_even_at_the_travelling_tiers()
    {
        var repo = FullRepo(workerConsented: true, callerFarmIds: []);

        var refused = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, Stranger));

        refused.IsFailure.Should().BeTrue(
            "portability lets a record follow him between his employers, not become a public lookup");
        refused.Error.Code.Should().Contain("Forbidden");
    }

    [Fact]
    public async Task A_worker_reads_his_own_standing_without_consenting_to_anything()
    {
        var repo = FullRepo(workerConsented: false);

        var mine = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, Ramesh));

        mine.IsSuccess.Should().BeTrue();
        mine.Value!.Statements.Should().HaveCount(2, "both farms' words about him are his to read");
        mine.Value.CompletedTasks.Should().Be(2);
    }

    // ── Absence renders as absence ──────────────────────────────────────────────────

    [Fact]
    public async Task A_farm_that_wrote_nothing_renders_as_nothing_not_as_a_zero()
    {
        // An owner may say nothing, forever. That silence must not become an empty star
        // row, a zero score, or "not yet rated" phrasing implying a review was owed.
        var silentRepo = new ReputationRepo(
            workerFarmIds: [PatilGuid],
            callerFarmIds: [PatilGuid],
            workerConsented: false,
            statements: [],
            workerJobCards: [CompletedCard(Patil)]);

        var result = await NewHandler(silentRepo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Statements.Should().BeEmpty("silence is silence");

        // The count still came through, which proves this handler is alive and that the
        // empty statement list above is a real absence rather than a dead read path.
        result.Value.CompletedTasks.Should().Be(1);

        // And the same handler over the same shape WITH a statement returns it — so the
        // emptiness above is about what the farm wrote, not about the plumbing.
        var speakingRepo = new ReputationRepo(
            workerFarmIds: [PatilGuid],
            callerFarmIds: [PatilGuid],
            workerConsented: false,
            statements: [Statement(Patil, "Patil Farms", "Steady hand at pruning.")],
            workerJobCards: [CompletedCard(Patil)]);

        var spoken = await NewHandler(speakingRepo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        spoken.Value!.Statements.Should().ContainSingle()
            .Which.Remark.Should().Be("Steady hand at pruning.");
    }

    [Fact]
    public async Task A_worker_with_no_completed_work_shows_no_count_rather_than_a_zero()
    {
        var repo = new ReputationRepo(
            workerFarmIds: [PatilGuid],
            callerFarmIds: [PatilGuid],
            workerConsented: false,
            statements: [],
            workerJobCards: [AssignedCard(Patil)]);

        var result = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        result.IsSuccess.Should().BeTrue();
        result.Value!.CompletedTasks.Should().BeNull(
            "'we have not seen him finish work here' is not 'he finished none'");
        result.Value.CompletedTasks.Should().NotBe(0);
        result.Value.FieldWorkHours.Should().BeNull("nothing records hours actually worked");
    }

    // ── What the reputation read must never reach for ───────────────────────────────

    [Fact]
    public async Task The_reputation_never_carries_the_stubbed_reliability_score()
    {
        // GetWorkerMetricsAsync returns hard-coded zeros today — it is not derived from
        // anything. A zero dressed as a score is the fabricated number P4 forbids, and
        // making it portable would be the worst possible version of that. So the tier-3
        // path must not touch it at all.
        var repo = FullRepo(workerConsented: true);

        var result = await NewHandler(repo).HandleAsync(
            new GetWorkerReputationQuery(Ramesh, PatilOwner));

        result.IsSuccess.Should().BeTrue();
        repo.MetricsWasRead.Should().BeFalse(
            "the portable record is derived from job cards, never from the zeroed metrics stub");
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────────

    private static GetWorkerReputationHandler NewHandler(ReputationRepo repo)
        => new(repo, NullLogger<GetWorkerReputationHandler>.Instance);

    /// <summary>Ramesh works at both farms; each has written about him; each has one
    /// completed card of his.</summary>
    private static ReputationRepo FullRepo(bool workerConsented, List<Guid>? callerFarmIds = null)
        => new(
            workerFarmIds: [ArveGuid, PatilGuid],
            callerFarmIds: callerFarmIds ?? [PatilGuid],
            workerConsented: workerConsented,
            statements:
            [
                Statement(Arve, "ARVE Farms", "Reliable with the sprayer. Turns up when he says he will."),
                Statement(Patil, "Patil Farms", "Two seasons with us."),
            ],
            workerJobCards: [CompletedCard(Arve), CompletedCard(Patil)]);

    private static WorkerStatement Statement(FarmId farmId, string farmName, string remark)
        => WorkerStatement.Write(Guid.NewGuid(), farmId, farmName, Ramesh, ArveOwner, remark, Now);

    private static JobCard AssignedCard(FarmId farmId)
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, PlotGuid, null, ArveOwner,
            new DateOnly(2026, 8, 17),
            [new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null)],
            Now);

        job.Assign(Ramesh, ArveOwner, AppRole.Mukadam, Now);
        return job;
    }

    private static JobCard CompletedCard(FarmId farmId)
    {
        var job = AssignedCard(farmId);
        job.CompleteWithLog(Guid.NewGuid(), ArveOwner, Now);
        return job;
    }

    private sealed class ReputationRepo(
        List<Guid> workerFarmIds,
        List<Guid> callerFarmIds,
        bool workerConsented,
        List<WorkerStatement> statements,
        List<JobCard> workerJobCards) : StubShramSafalRepository
    {
        public bool MetricsWasRead { get; private set; }

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(userId == RameshGuid ? workerFarmIds : callerFarmIds);

        public override Task<bool> HasWorkerRecordPortabilityConsentAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerConsented);

        public override Task<IReadOnlyList<WorkerStatement>> GetWorkerStatementsAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<WorkerStatement>>(statements);

        public override Task<List<JobCard>> GetJobCardsForWorkerAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerJobCards);

        public override Task<WorkerMetricsDto> GetWorkerMetricsAsync(
            UserId workerUserId, IReadOnlyCollection<Guid> scopedFarmIds, DateTime since30d, CancellationToken ct = default)
        {
            MetricsWasRead = true;
            return Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));
        }
    }
}
