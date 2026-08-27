// spec: dfes-companion-2026-07-11 (wave-1.3)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.3) — WHAT THE CREATE-TIME ATTESTATION IS
/// WORTH ON THE MONEY PATH.
///
/// <para><b>Why this suite exists.</b> Wave-1.3 made an owner's own log land on
/// <c>Verified</c> the moment it is created. <c>Verified</c> is not a cosmetic status:
/// <c>JobCard.MarkVerifiedForPayout</c> (JobCard.cs:206) refuses to authorise a payout
/// unless the linked daily log is exactly <c>Verified</c>. So the create-time
/// attestation now decides whether a worker's job card can be paid — and nothing
/// proved that boundary. Every test written for wave-1.3 stopped at the sync wire.</para>
///
/// <para><b>The boundary in one sentence:</b> the owner's own day authorises a payout;
/// the mukadam's does not, and must wait for a second person. If a future change ever
/// grants the <c>Confirmed → Verified</c> edge to a non-owner role, a mukadam would be
/// able to record his own work AND release his own pay in one act — the single worst
/// failure this product can have. That is what proof 3 pins.</para>
///
/// <para><b>The live gate is <c>MarkVerifiedForPayout</c>, reached from
/// <c>VerifyJobCardForPayoutHandler.cs:52</c>.</b> <c>JobCard.CheckEligibility</c>
/// (JobCard.cs:178) reads like the gate but has ZERO production callers — it is
/// referenced only from tests. Asserting against it would prove nothing about money.
/// Every proof below drives the real handler.</para>
/// </summary>
public sealed class PayoutAuthorityFollowsWhoRecordedTheDayTests
{
    private static readonly DateTime Now = new(2026, 8, 16, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("9a000000-0000-0000-0000-000000000001");
    private static readonly FarmId FarmIdVo = new(FarmGuid);
    private static readonly Guid PlotGuid = Guid.Parse("9a000000-0000-0000-0000-000000000002");
    private static readonly Guid CropCycleGuid = Guid.Parse("9a000000-0000-0000-0000-000000000003");

    private static readonly Guid OwnerGuid = Guid.Parse("9a000000-0000-0000-0000-000000000004");
    private static readonly Guid MukadamGuid = Guid.Parse("9a000000-0000-0000-0000-000000000005");
    private static readonly Guid WorkerGuid = Guid.Parse("9a000000-0000-0000-0000-000000000006");

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 (I1) — the attestation leaves an audit row. Two verification events
    // are created with nobody pressing an approve button; the ledger must say so.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_owners_self_attestation_writes_an_audit_row_that_could_never_be_backfilled()
    {
        var repo = SeedFarm();
        var created = await CreateDailyLogAsAsync(repo, OwnerGuid, AppRole.PrimaryOwner, "req-owner-audit");

        created.IsSuccess.Should().BeTrue();

        repo.AuditEvents.Select(a => a.Action).Should().ContainInOrder("Created", "VerificationChanged");

        var attestation = repo.AuditEvents.Single(a => a.Action == "VerificationChanged");
        attestation.EntityType.Should().Be("DailyLog");
        attestation.EntityId.Should().Be(created.Value!.Id);
        attestation.ActorUserId.Should().Be(new UserId(OwnerGuid));
        attestation.FarmId.Should().Be(FarmGuid);

        // The payload is what makes the row reconstructable years later: which way the
        // status moved, that no second person was involved, and the SERVER-DERIVED role
        // the authority actually rested on (not the role the caller claimed).
        attestation.Payload.Should().Contain("\"from\":\"Draft\"");
        attestation.Payload.Should().Contain("\"to\":\"Verified\"");
        attestation.Payload.Should().Contain("\"selfAttested\":true");
        attestation.Payload.Should().Contain("\"role\":\"PrimaryOwner\"");

        // Same act, same provenance as the Created row it rides beside.
        var createdRow = repo.AuditEvents.Single(a => a.Action == "Created");
        attestation.AppVersion.Should().Be(createdRow.AppVersion);
        attestation.DeviceId.Should().Be(createdRow.DeviceId);
        attestation.IpHash.Should().Be(createdRow.IpHash);
        attestation.ClientCommandId.Should().Be(createdRow.ClientCommandId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 (I2) — the reversibility marker. Both attestation events carry a
    // constant reason, so "which Verified logs were only ever self-attested?" stays
    // an answerable question. With null there, it would not be.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Both_attestation_events_carry_the_marker_a_future_tightening_would_need()
    {
        var repo = SeedFarm();
        var created = await CreateDailyLogAsAsync(repo, OwnerGuid, AppRole.PrimaryOwner, "req-owner-marker");

        var log = await repo.GetDailyLogByIdAsync(created.Value!.Id);
        log!.VerificationEvents.Should().HaveCount(2);
        log.VerificationEvents.Should().OnlyContain(
            e => e.Reason == DailyLog.SelfAttestationReason,
            "a null reason here would make self-attested and second-party approvals " +
            "indistinguishable, and no later migration could tell them apart");

        DailyLog.SelfAttestationReason.Should().Be("self-attested-at-creation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — THE BOUNDARY. A mukadam records the work; his own day cannot
    // release his own pay.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_mukadams_own_day_cannot_authorise_the_payout_for_that_days_job_card()
    {
        var repo = SeedFarm();

        var created = await CreateDailyLogAsAsync(repo, MukadamGuid, AppRole.Mukadam, "req-mukadam-payout");
        created.IsSuccess.Should().BeTrue("a foreman may absolutely record a day's work");

        var log = await repo.GetDailyLogByIdAsync(created.Value!.Id);
        log!.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft,
            "a mukadam holds Draft->Confirmed but not Confirmed->Verified, so nothing was attested");

        var jobCard = CompletedJobCardLinkedTo(repo, log.Id);

        // The owner is the one asking for the payout — an eligible role. The refusal
        // must come from the LOG's status, not from the caller's role, or this proof
        // would be passing for the wrong reason.
        var result = await new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(3)))
            .HandleAsync(new VerifyJobCardForPayoutCommand(
                JobCardId: jobCard.Id,
                CallerUserId: new UserId(OwnerGuid),
                ClientCommandId: "payout-mukadam-day"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardInvalidState");
        jobCard.Status.Should().Be(JobCardStatus.Completed,
            "the card must stay where it was — money waits for a second person");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4 — the same job card, the same owner, the same request: accepted once
    // the day it hangs off was recorded by the person with the authority to vouch.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_owners_own_day_authorises_the_payout_the_mukadams_could_not()
    {
        var repo = SeedFarm();

        var created = await CreateDailyLogAsAsync(repo, OwnerGuid, AppRole.PrimaryOwner, "req-owner-payout");
        var log = await repo.GetDailyLogByIdAsync(created.Value!.Id);
        log!.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified);

        var jobCard = CompletedJobCardLinkedTo(repo, log.Id);

        var result = await new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(3)))
            .HandleAsync(new VerifyJobCardForPayoutCommand(
                JobCardId: jobCard.Id,
                CallerUserId: new UserId(OwnerGuid),
                ClientCommandId: "payout-owner-day"));

        result.IsSuccess.Should().BeTrue(
            $"the linked log is Verified (got error: {result.Error?.Code})");
        jobCard.Status.Should().Be(JobCardStatus.VerifiedForPayout);
    }

    // ── Scenario builders ────────────────────────────────────────────────────

    private static PayoutScenarioRepo SeedFarm()
    {
        var repo = new PayoutScenarioRepo();
        repo.Seed(
            Farm.Create(FarmIdVo, "Payout Boundary Farm", new UserId(OwnerGuid), Now),
            Plot.Create(PlotGuid, FarmIdVo, "Plot A", 1.5m, Now),
            CropCycle.Create(CropCycleGuid, FarmIdVo, PlotGuid, "Grapes", "Fruiting",
                new DateOnly(2026, 1, 1), null, Now));
        repo.SetMembership(OwnerGuid, AppRole.PrimaryOwner);
        repo.SetMembership(MukadamGuid, AppRole.Mukadam);
        repo.SetMembership(WorkerGuid, AppRole.Worker);
        return repo;
    }

    /// <summary>
    /// Runs the REAL <see cref="CreateDailyLogHandler"/> so the attestation under test is
    /// the one production emits — not a hand-built DailyLog with events bolted on.
    /// </summary>
    private static async Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> CreateDailyLogAsAsync(
        PayoutScenarioRepo repo, Guid operatorGuid, AppRole claimedRoleIsIgnored, string clientRequestId)
    {
        var handler = new CreateDailyLogHandler(
            repo,
            new NewGuidIdGenerator(),
            new FixedClock(Now),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            new ShramSafal.Domain.Tests.Common.NullAiJobRepository(),
            NullLogger<CreateDailyLogHandler>.Instance,
            new LedgerDerivationService(repo),
            new ShramSafal.Domain.Tests.Common.NullDailyRichnessDerivationService());

        return await handler.HandleAsync(new CreateDailyLogCommand(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: operatorGuid,
            OperatorUserId: operatorGuid,
            LogDate: new DateOnly(2026, 8, 16),
            Location: null,
            DeviceId: "device-payout",
            ClientRequestId: clientRequestId,
            DailyLogId: null,
            ActorRole: claimedRoleIsIgnored.ToString(),
            ClientAppVersion: "1.0.0-test",
            AuditDeviceId: "test-device-payout",
            AuditIpHash: "sha256:test-ip-hash"));
    }

    private static JobCard CompletedJobCardLinkedTo(PayoutScenarioRepo repo, Guid dailyLogId)
    {
        var jobCard = JobCard.CreateDraft(
            Guid.NewGuid(),
            FarmIdVo,
            PlotGuid,
            CropCycleGuid,
            new UserId(MukadamGuid),
            new DateOnly(2026, 8, 16),
            [new JobCardLineItem("harvest", 3m, new Money(400m, Currency.Inr), null)],
            Now);

        jobCard.Assign(new UserId(WorkerGuid), new UserId(MukadamGuid), AppRole.Mukadam, Now);
        jobCard.Start(new UserId(WorkerGuid), Now.AddMinutes(5));
        jobCard.CompleteWithLog(dailyLogId, new UserId(WorkerGuid), Now.AddHours(2));

        repo.SeedJobCard(jobCard);
        return jobCard;
    }

    // ── Test doubles ─────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class NewGuidIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    /// <summary>
    /// Just enough store to run CreateDailyLogHandler and VerifyJobCardForPayoutHandler
    /// against the SAME log instance, so the second handler sees exactly what the first
    /// one attested. Everything not needed still throws (see the base class).
    /// </summary>
    private sealed class PayoutScenarioRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = [];
        private readonly Dictionary<Guid, JobCard> _jobCards = [];
        private readonly Dictionary<Guid, AppRole> _memberships = [];
        private Farm? _farm;
        private Plot? _plot;
        private CropCycle? _cropCycle;

        public List<AuditEvent> AuditEvents { get; } = [];

        public void Seed(Farm farm, Plot plot, CropCycle cropCycle)
        {
            _farm = farm;
            _plot = plot;
            _cropCycle = cropCycle;
        }

        public void SetMembership(Guid userId, AppRole role) => _memberships[userId] = role;

        public void SeedJobCard(JobCard jobCard) => _jobCards[jobCard.Id] = jobCard;

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(farmId == FarmGuid ? _farm : null);

        public override Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
            => Task.FromResult(plotId == PlotGuid ? _plot : null);

        public override Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
            => Task.FromResult(cropCycleId == CropCycleGuid ? _cropCycle : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(farmId == FarmGuid && _memberships.ContainsKey(userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(
                farmId == FarmGuid && _memberships.TryGetValue(userId, out var role) ? role : null);

        public override Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
            => Task.FromResult<DailyLog?>(_logs.Values.FirstOrDefault(l => l.IdempotencyKey == idempotencyKey));

        public override Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default)
        {
            _logs[log.Id] = log;
            return Task.CompletedTask;
        }

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var card) ? card : null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
