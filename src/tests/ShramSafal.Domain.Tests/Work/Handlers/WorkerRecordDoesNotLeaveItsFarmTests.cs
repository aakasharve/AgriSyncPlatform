// spec: dfes-companion-2026-07-11 (wave-4.4) — founder model, 2026-08-17.
//
// WorkerRecordPortabilityTests proves the RULE. This file proves the rule is WIRED —
// that the two live TIER 1 read paths which could carry a farm's operational detail past
// the farm that recorded it actually consult it, rather than the guard sitting
// unreferenced in Domain.
//
// Both surfaces authorised on "does the caller share ANY farm with this worker" and then
// returned data scoped to no farm at all:
//   GET /workers/{id}/profile?farmId=...  → farmId optional; null = every farm he worked
//   GET /workers/{id}/job-cards           → no farm parameter exists at all
//
// These are tier 1: which plot, which crop, what it cost. They never travel, and NO
// consent opens them — a worker cannot license away his employer's books. Every refusal
// here is therefore paired not with a consenting call (there is none that would work) but
// with a call that IS permitted, so the denial is shown to be a decision rather than an
// artefact of the test never getting that far. What the worker CAN license is tested in
// WorkerReputationTravelsWithHimTests.

using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class WorkerRecordDoesNotLeaveItsFarmTests
{
    private static readonly DateTime Now = new(2026, 8, 17, 8, 0, 0, DateTimeKind.Utc);

    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmBGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid PlotGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");

    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);

    // Owns farm B only. He employs the same man farm A employs.
    private static readonly Guid OwnerOfBGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly UserId OwnerOfBUserId = new(OwnerOfBGuid);

    // ── The profile path — a farm's own operational record of its own work ──────────

    [Fact]
    public async Task An_unscoped_request_is_pinned_to_the_single_farm_they_share()
    {
        // The ordinary flow the CEI end-to-end lifecycle exercises: a shared-farm member
        // opens the profile and the client names no farm. Ruling A permits it — but the
        // metrics read must still be pinned, not left spanning every farm he has worked.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: false);

        var result = await NewProfileHandler(repo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue("a shared-farm member may read that farm's record");
        repo.MetricsScopesRequested.Should().ContainSingle()
            .Which.Should().BeEquivalentTo([FarmBGuid],
                "the unscoped request must be narrowed, never left open-ended");
    }

    [Fact]
    public async Task Farm_Bs_owner_cannot_pull_a_score_spanning_both_farms_they_share()
    {
        // Two shared farms owned by two different people — the score would fold farm A's
        // record of him into farm B's.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false);

        var refused = await NewProfileHandler(repo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("ShramSafal.WorkerRecordPortabilityForbidden");
        repo.MetricsScopesRequested.Should().BeEmpty("a refusal must not read his metrics at all");

        // Recorded consent does NOT rescue it. Tier 1 is the farm's record, not his.
        var consentingRepo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: true);

        var stillRefused = await NewProfileHandler(consentingRepo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        stillRefused.IsFailure.Should().BeTrue(
            "no consent of the worker's opens his employer's operational record");

        // POSITIVE CONTROL — FOUNDER RULING, 2026-08-17. The identical call by a caller who
        // OWNS both farms is allowed, and the metrics read spans both. This is what proves
        // the refusals above are decisions: the same two-farm fold IS reachable, for the
        // one person entitled to it.
        var ownerOfBothRepo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false,
            callerOwnedFarmIds: [FarmAGuid, FarmBGuid]);

        var allowed = await NewProfileHandler(ownerOfBothRepo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        allowed.IsSuccess.Should().BeTrue("two farms of his own are one owner's own record");
        ownerOfBothRepo.MetricsScopesRequested.Should().ContainSingle()
            .Which.Should().BeEquivalentTo([FarmAGuid, FarmBGuid]);
    }

    [Fact]
    public async Task Farm_Bs_owner_cannot_name_farm_A_and_read_the_workers_record_there()
    {
        var refused = await RunProfile(requestedFarmId: FarmAGuid, workerConsented: false);

        refused.IsFailure.Should().BeTrue(
            "the caller is not a member of farm A; its record of this man is not his to read");
        refused.Error.Code.Should().Be("ShramSafal.WorkerRecordPortabilityForbidden");

        var stillRefused = await RunProfile(requestedFarmId: FarmAGuid, workerConsented: true);
        stillRefused.IsFailure.Should().BeTrue(
            "tier 1 does not travel, so his consent changes nothing here");

        // POSITIVE CONTROL — the same handler, same caller, naming the farm he IS in,
        // succeeds. So the refusals above are the guard talking, not a broken path.
        var allowed = await RunProfile(requestedFarmId: FarmBGuid, workerConsented: false);
        allowed.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task The_metrics_read_is_never_handed_an_unscoped_farm_for_a_third_party()
    {
        // The refusals above are only worth something if a permitted read still reaches
        // the metrics call — and reaches it pinned to the permitted farms. This asserts
        // what the repository was ASKED, not merely what the handler returned.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: false);

        var result = await NewProfileHandler(repo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId, ScopedFarmId: FarmBGuid));

        result.IsSuccess.Should().BeTrue("farm B is shared — ruling A allows this outright");
        repo.MetricsScopesRequested.Should().ContainSingle()
            .Which.Should().BeEquivalentTo([FarmBGuid]);
    }

    [Fact]
    public async Task A_worker_reading_his_own_profile_is_not_gated_on_his_own_consent()
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false);

        var result = await NewProfileHandler(repo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue("his record is his to read, whole");
    }

    // ── The job-card path — "what he did at ARVE Farms in exact things" ─────────────

    [Fact]
    public async Task Farm_Bs_owner_sees_only_farm_Bs_job_cards_for_a_worker_they_share()
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: false,
            workerJobCards: [BuildAssignedJobCard(new FarmId(FarmAGuid)), BuildAssignedJobCard(new FarmId(FarmBGuid))]);

        var result = await new GetJobCardsForWorkerHandler(repo).HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle(
            "farm A's record of this man's work is not farm B's to see");
        result.Value.Single().FarmId.Should().Be(FarmBGuid);
    }

    [Fact]
    public async Task Even_with_his_consent_recorded_the_work_history_does_not_follow_him()
    {
        // The founder's line: Patil Farms "must not be able to see what he did at ARVE
        // Farms in exact things". A job card is exactly that — plot, activity, rate. So
        // this is the one place the tier model differs from the binary guard it replaced,
        // which DID hand both cards over on his consent.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: true,
            workerJobCards: [BuildAssignedJobCard(new FarmId(FarmAGuid)), BuildAssignedJobCard(new FarmId(FarmBGuid))]);

        var result = await new GetJobCardsForWorkerHandler(repo).HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle("his consent does not license his employer's records");
        result.Value.Single().FarmId.Should().Be(FarmBGuid);

        // POSITIVE CONTROL — PROVE THE FARM-A CARD IS VISIBLE AT ALL. The assertion above
        // is only meaningful if the repository really did offer two cards and one was
        // dropped by the filter. The worker reading his own history gets both, from the
        // same repository, through the same handler.
        var self = await new GetJobCardsForWorkerHandler(repo).HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, WorkerUserId));

        self.IsSuccess.Should().BeTrue();
        self.Value!.Should().HaveCount(2, "the farm-A card exists and is reachable — it was filtered, not missing");
        self.Value.Select(c => c.FarmId).Should().Contain(FarmAGuid);
    }

    [Fact]
    public async Task A_worker_still_sees_his_whole_job_history_across_every_farm()
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false,
            workerJobCards: [BuildAssignedJobCard(new FarmId(FarmAGuid)), BuildAssignedJobCard(new FarmId(FarmBGuid))]);

        var result = await new GetJobCardsForWorkerHandler(repo).HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().HaveCount(2, "narrowing another man's view must not narrow his own");
    }

    // ── The seam itself ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_repository_that_says_nothing_grants_nothing()
    {
        // The fail-closed property stated directly. This is what makes "the day someone
        // builds a portable record it cannot ship without consent" true: the seams deny by
        // omission, so granting has to be a deliberate act somebody writes.
        ShramSafal.Application.Ports.IShramSafalRepository silent = new SilentRepo();

        (await silent.HasWorkerRecordPortabilityConsentAsync(WorkerUserId)).Should().BeFalse();
        (await silent.GetOwnedFarmIdsForUserAsync(OwnerOfBGuid)).Should().BeEmpty(
            "an implementation that claims no ownership must not get the own-farms widening");
        (await silent.GetWorkerStatementsAsync(WorkerUserId)).Should().BeEmpty(
            "and silence from the farms is silence, never an invented statement");
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────────

    private static GetWorkerProfileHandler NewProfileHandler(RecordingRepo repo)
        => new(repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

    private static async Task<AgriSync.BuildingBlocks.Results.Result<WorkerProfileDto>> RunProfile(
        Guid? requestedFarmId, bool workerConsented)
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: workerConsented);

        return await NewProfileHandler(repo).HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId, ScopedFarmId: requestedFarmId));
    }

    private static JobCard BuildAssignedJobCard(FarmId farmId)
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, PlotGuid, null, OwnerOfBUserId,
            new DateOnly(2026, 8, 17),
            [new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null)],
            Now);

        job.Assign(WorkerUserId, OwnerOfBUserId, AppRole.Mukadam, Now);
        return job;
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>Overrides nothing about portability — inherits the closed defaults.</summary>
    private sealed class SilentRepo : StubShramSafalRepository
    {
    }

    private sealed class RecordingRepo(
        List<Guid> workerFarmIds,
        List<Guid> callerFarmIds,
        bool workerConsented,
        List<JobCard>? workerJobCards = null,
        List<Guid>? callerOwnedFarmIds = null) : StubShramSafalRepository
    {
        /// <summary>Every farm scope the handler actually asked metrics for.</summary>
        public List<IReadOnlyCollection<Guid>> MetricsScopesRequested { get; } = [];

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(userId == WorkerGuid ? workerFarmIds : callerFarmIds);

        public override Task<List<Guid>> GetOwnedFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(callerOwnedFarmIds ?? []);

        public override Task<bool> HasWorkerRecordPortabilityConsentAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerConsented);

        public override Task<WorkerMetricsDto> GetWorkerMetricsAsync(
            UserId workerUserId, IReadOnlyCollection<Guid> scopedFarmIds, DateTime since30d, CancellationToken ct = default)
        {
            MetricsScopesRequested.Add(scopedFarmIds);
            return Task.FromResult(new WorkerMetricsDto(4, 4, 0, 4, 4, 2, 2));
        }

        public override Task<List<JobCard>> GetJobCardsForWorkerAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerJobCards ?? []);

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>(
                [new SyncOperatorDto(WorkerGuid, "Ramesh Patil", "Worker")]);
    }
}
