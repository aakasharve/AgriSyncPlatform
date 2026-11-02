// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99, carried from the MU-4 third review (R3-L1).
//
// A seat that reads only his own records (the कामगार label, or the स्वतःचं काम scope) gets nothing of another worker on
// that farm (MU-4 fix pass 2, N1). The reputation route used to let such a seat OPEN the lookup: once the worker has
// consented to his standing travelling, the one shared farm let the other farms' word about him through, while this
// farm's own word was (rightly) dropped. The rule: the shared farm that opens the lookup must be one where the caller
// reads more than his own records. Portability cannot be granted on Postgres today (the repository answers "no consent"),
// so the rule is proved here on the handler, with the consent the founder's model allows.
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Work.GetWorkerReputation;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class WorkerReputationOwnRecordsSeatTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 8, 0, 0, DateTimeKind.Utc);

    private static readonly Guid Arve = Guid.Parse("aaaaaaaa-0000-4000-8000-0000000000a1");
    private static readonly Guid Patil = Guid.Parse("bbbbbbbb-0000-4000-8000-0000000000b1");
    private static readonly Guid Kale = Guid.Parse("cccccccc-0000-4000-8000-0000000000c1");
    private static readonly Guid PlotGuid = Guid.Parse("eeeeeeee-0000-4000-8000-0000000000e1");

    private static readonly UserId Ramesh = new(Guid.Parse("11111111-0000-4000-8000-000000000001"));
    private static readonly UserId Suresh = new(Guid.Parse("22222222-0000-4000-8000-000000000002"));
    private static readonly UserId ArveOwner = new(Guid.Parse("33333333-0000-4000-8000-000000000003"));

    [Fact]
    public async Task An_own_records_seat_on_the_one_shared_farm_does_not_open_a_reputation_that_travels()
    {
        // Suresh is a कामगार at Patil; Ramesh works at ARVE and Patil and has consented to his standing travelling.
        var repo = new Repo(sureshFarms: [Patil], sureshSeats: new() { [Patil] = Seat(AppRole.Worker) });

        var answer = await Handler(repo).HandleAsync(new GetWorkerReputationQuery(Ramesh, Suresh));

        answer.IsFailure.Should().BeTrue("a seat that may not read even this farm's word about him opens nothing");
        answer.Error.Code.Should().Be("ShramSafal.Forbidden", "the same answer as sharing no farm with him");
    }

    [Fact]
    public async Task The_own_work_scope_is_the_same_own_records_rule()
    {
        var ownWork = Seat(AppRole.Mukadam) with { PlotScope = MembershipPlotScope.OwnWork };
        var repo = new Repo(sureshFarms: [Patil], sureshSeats: new() { [Patil] = ownWork });

        (await Handler(repo).HandleAsync(new GetWorkerReputationQuery(Ramesh, Suresh))).IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task A_seat_that_reads_the_farms_records_still_opens_it_and_the_word_travels()
    {
        // The control: the same farm, a मुकादम who reads the farm's records — the founder's Patil-Farms case, unchanged.
        var repo = new Repo(sureshFarms: [Patil], sureshSeats: new() { [Patil] = Seat(AppRole.Mukadam) });

        var answer = await Handler(repo).HandleAsync(new GetWorkerReputationQuery(Ramesh, Suresh));

        answer.IsSuccess.Should().BeTrue();
        answer.Value!.Statements.Select(s => s.FarmId).Should().BeEquivalentTo([Arve, Patil]);
        answer.Value.CrossedFarmBoundary.Should().BeTrue();
    }

    [Fact]
    public async Task Another_farm_where_he_reads_the_records_opens_it_and_the_own_records_farm_stays_out()
    {
        // Suresh is a कामगार at Patil but a मुकादम at Kale, where Ramesh also works: Kale opens the lookup.
        var repo = new Repo(
            sureshFarms: [Patil, Kale],
            sureshSeats: new() { [Patil] = Seat(AppRole.Worker), [Kale] = Seat(AppRole.Mukadam) },
            rameshFarms: [Arve, Patil, Kale]);

        var answer = await Handler(repo).HandleAsync(new GetWorkerReputationQuery(Ramesh, Suresh));

        answer.IsSuccess.Should().BeTrue();
        answer.Value!.Statements.Select(s => s.FarmId).Should().BeEquivalentTo([Arve, Kale],
            "Patil's word about another worker is not a कामगार's there (MU-4 N1)");
    }

    [Fact]
    public async Task His_own_standing_is_his_whatever_his_seat()
    {
        var repo = new Repo(sureshFarms: [Patil], sureshSeats: new() { [Patil] = Seat(AppRole.Worker) }, asRamesh: true);

        (await Handler(repo).HandleAsync(new GetWorkerReputationQuery(Ramesh, Ramesh))).IsSuccess.Should().BeTrue();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private static GetWorkerReputationHandler Handler(Repo repo) => new(repo, NullLogger<GetWorkerReputationHandler>.Instance);

    private static FarmAccess Seat(AppRole role) => new(role, MembershipStatus.Active, IsRegistrant: false, StoredPermissions: null);

    private sealed class Repo(
        List<Guid> sureshFarms,
        Dictionary<Guid, FarmAccess> sureshSeats,
        List<Guid>? rameshFarms = null,
        bool asRamesh = false) : StubShramSafalRepository
    {
        private readonly List<Guid> _rameshFarms = rameshFarms ?? [Arve, Patil];

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(userId == Ramesh.Value ? _rameshFarms : sureshFarms);

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(userId == Suresh.Value && sureshSeats.TryGetValue(farmId, out var seat) ? seat
                : asRamesh && userId == Ramesh.Value ? Seat(AppRole.Worker)
                : null);

        public override Task<bool> HasWorkerRecordPortabilityConsentAsync(UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(true);

        public override Task<IReadOnlyList<WorkerStatement>> GetWorkerStatementsAsync(UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<WorkerStatement>>(
                _rameshFarms.Select(f => WorkerStatement.Write(Guid.NewGuid(), new FarmId(f), $"farm-{f}", Ramesh, ArveOwner, "Reliable.", Now)).ToList());

        public override Task<List<JobCard>> GetJobCardsForWorkerAsync(UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(_rameshFarms.Select(f => CompletedCard(new FarmId(f))).ToList());

        private static JobCard CompletedCard(FarmId farmId)
        {
            var job = JobCard.CreateDraft(
                Guid.NewGuid(), farmId, PlotGuid, null, ArveOwner, new DateOnly(2026, 11, 1),
                [new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null)], Now);
            job.Assign(Ramesh, ArveOwner, AppRole.Mukadam, Now);
            job.CompleteWithLog(Guid.NewGuid(), ArveOwner, Now);
            return job;
        }
    }
}
