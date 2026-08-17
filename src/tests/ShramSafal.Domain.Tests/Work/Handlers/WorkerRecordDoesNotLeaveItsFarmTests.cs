// spec: dfes-companion-2026-07-11 (wave-4.4) — founder ruling A, 2026-08-17.
//
// WorkerRecordPortabilityTests proves the RULE. This file proves the rule is WIRED —
// that the two live read paths which could carry a worker's identity past the farm that
// recorded it actually consult it, rather than the guard sitting unreferenced in Domain.
//
// Both surfaces authorised on "does the caller share ANY farm with this worker" and then
// returned data scoped to no farm at all:
//   GET /workers/{id}/profile?farmId=...  → farmId optional; null = every farm he worked
//   GET /workers/{id}/job-cards           → no farm parameter exists at all
//
// Every refusal here is paired with the same call under recorded consent, which succeeds.
// That pairing is the point: it shows the boundary is reachable, so the denial is a
// decision and not an artefact of the test never getting that far.

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

    // ── The profile path — a reliability number that would follow the man ───────────

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

        var handler = new GetWorkerProfileHandler(
            repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

        var result = await handler.HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue("a shared-farm member may read that farm's record");
        repo.MetricsScopesRequested.Should().ContainSingle().Which.Should().Be(
            FarmBGuid, "the unscoped request must be narrowed, never passed through as null");
    }

    [Fact]
    public async Task Farm_Bs_owner_cannot_pull_a_score_spanning_both_farms_they_share()
    {
        // Two shared farms — the score would fold one farm's record into the other's.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false);

        var handler = new GetWorkerProfileHandler(
            repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

        var refused = await handler.HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("ShramSafal.WorkerRecordPortabilityForbidden");
        repo.MetricsScopesRequested.Should().BeEmpty("a refusal must not read his metrics at all");

        // POSITIVE CONTROL — the guard is reachable and does open on his consent.
        var consentingRepo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: true);

        var allowed = await new GetWorkerProfileHandler(
                consentingRepo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance)
            .HandleAsync(new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId));

        allowed.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task Farm_Bs_owner_cannot_name_farm_A_and_read_the_workers_record_there()
    {
        var refused = await RunProfile(requestedFarmId: FarmAGuid, workerConsented: false);

        refused.IsFailure.Should().BeTrue(
            "the caller is not a member of farm A; its record of this man is not his to read");
        refused.Error.Code.Should().Be("ShramSafal.WorkerRecordPortabilityForbidden");

        var allowed = await RunProfile(requestedFarmId: FarmAGuid, workerConsented: true);
        allowed.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task The_metrics_read_is_never_handed_an_unscoped_farm_for_a_third_party()
    {
        // The refusals above are only worth something if a permitted read still reaches
        // the metrics call — and reaches it pinned to one farm. A null scope there means
        // "every farm he ever worked", so this asserts what the repository was ASKED,
        // not merely what the handler returned.
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: false);

        var handler = new GetWorkerProfileHandler(
            repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

        var result = await handler.HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, OwnerOfBUserId, ScopedFarmId: FarmBGuid));

        result.IsSuccess.Should().BeTrue("farm B is shared — ruling A allows this outright");
        repo.MetricsScopesRequested.Should().ContainSingle().Which.Should().Be(FarmBGuid);
    }

    [Fact]
    public async Task A_worker_reading_his_own_profile_is_not_gated_on_his_own_consent()
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false);

        var handler = new GetWorkerProfileHandler(
            repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

        var result = await handler.HandleAsync(
            new GetWorkerProfileQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue("his record is his to read, whole");
    }

    // ── The job-card path — a work history that would follow the man ────────────────

    [Fact]
    public async Task Farm_Bs_owner_sees_only_farm_Bs_job_cards_for_a_worker_they_share()
    {
        var atFarmA = BuildAssignedJobCard(new FarmId(FarmAGuid));
        var atFarmB = BuildAssignedJobCard(new FarmId(FarmBGuid));

        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: false,
            workerJobCards: [atFarmA, atFarmB]);

        var handler = new GetJobCardsForWorkerHandler(repo);
        var result = await handler.HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle(
            "farm A's record of this man's work is not farm B's to see");
        result.Value.Single().FarmId.Should().Be(FarmBGuid);
    }

    [Fact]
    public async Task With_his_consent_recorded_the_work_history_does_follow_him()
    {
        // The positive control for the test above. Two cards come back, so the filter is
        // genuinely consent-driven rather than always dropping the other farm's rows.
        var atFarmA = BuildAssignedJobCard(new FarmId(FarmAGuid));
        var atFarmB = BuildAssignedJobCard(new FarmId(FarmBGuid));

        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: true,
            workerJobCards: [atFarmA, atFarmB]);

        var handler = new GetJobCardsForWorkerHandler(repo);
        var result = await handler.HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, OwnerOfBUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().HaveCount(2);
    }

    [Fact]
    public async Task A_worker_still_sees_his_whole_job_history_across_every_farm()
    {
        var atFarmA = BuildAssignedJobCard(new FarmId(FarmAGuid));
        var atFarmB = BuildAssignedJobCard(new FarmId(FarmBGuid));

        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmAGuid, FarmBGuid],
            workerConsented: false,
            workerJobCards: [atFarmA, atFarmB]);

        var handler = new GetJobCardsForWorkerHandler(repo);
        var result = await handler.HandleAsync(
            new GetJobCardsForWorkerQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().HaveCount(2, "narrowing another man's view must not narrow his own");
    }

    // ── The seam itself ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_repository_that_says_nothing_about_portability_grants_nothing()
    {
        // The fail-closed property stated directly. This is what makes "the day someone
        // builds a portable record it cannot ship without consent" true: the seam denies
        // by omission, so granting has to be a deliberate act somebody writes.
        ShramSafal.Application.Ports.IShramSafalRepository silent = new SilentRepo();

        var granted = await silent.HasWorkerRecordPortabilityConsentAsync(WorkerUserId);

        granted.Should().BeFalse();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────────

    private static async Task<AgriSync.BuildingBlocks.Results.Result<WorkerProfileDto>> RunProfile(
        Guid? requestedFarmId, bool workerConsented)
    {
        var repo = new RecordingRepo(
            workerFarmIds: [FarmAGuid, FarmBGuid],
            callerFarmIds: [FarmBGuid],
            workerConsented: workerConsented);

        var handler = new GetWorkerProfileHandler(
            repo, new FixedClock(Now), NullLogger<GetWorkerProfileHandler>.Instance);

        return await handler.HandleAsync(
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

    /// <summary>Overrides nothing about portability — inherits the closed default.</summary>
    private sealed class SilentRepo : StubShramSafalRepository
    {
    }

    private sealed class RecordingRepo(
        List<Guid> workerFarmIds,
        List<Guid> callerFarmIds,
        bool workerConsented,
        List<JobCard>? workerJobCards = null) : StubShramSafalRepository
    {
        /// <summary>Every farm scope the handler actually asked metrics for.</summary>
        public List<Guid?> MetricsScopesRequested { get; } = [];

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult(userId == WorkerGuid ? workerFarmIds : callerFarmIds);

        public override Task<bool> HasWorkerRecordPortabilityConsentAsync(
            UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerConsented);

        public override Task<WorkerMetricsDto> GetWorkerMetricsAsync(
            UserId workerUserId, Guid? scopedFarmId, DateTime since30d, CancellationToken ct = default)
        {
            MetricsScopesRequested.Add(scopedFarmId);
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
