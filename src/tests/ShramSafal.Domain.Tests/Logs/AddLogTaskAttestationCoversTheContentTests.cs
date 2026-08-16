// spec: dfes-companion-2026-07-11 (wave-1.3)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.3) — I3. AN ATTESTATION MUST COVER THE
/// CONTENT IT ATTESTS TO.
///
/// <para><b>The defect.</b> <c>AddLogTaskHandler</c> called <c>log.AddTask</c> and never
/// <c>log.Edit</c>. Before wave-1.3 that was invisible: logs started <c>Draft</c>, so
/// there was no approval for a later task to slip under. Now an owner's own log starts
/// <c>Verified</c> — and <c>Verified</c> is what releases a worker's pay
/// (<c>JobCard.cs:206</c>). "Verified" could therefore mean "verified, plus three things
/// nobody ever looked at".</para>
///
/// <para><b>Why the obvious fix is a trap.</b> <c>VerificationStateMachine</c>
/// (<c>:85</c>) maps <c>Verified → Draft</c> on edit. Simply calling <c>Edit</c> would
/// re-open the owner's own day on his SECOND task and strand it in <c>Draft</c> forever
/// — the exact bug wave-1.3 fixed, reintroduced through a different door. So the handler
/// re-opens AND re-attests, but only for the person whose attestation it was.</para>
///
/// <para><b>Both directions are proven below</b>, because a fix that only proved the
/// owner's direction would look identical to one that let anybody's addition ride under
/// somebody else's approval.</para>
/// </summary>
public sealed class AddLogTaskAttestationCoversTheContentTests
{
    private static readonly DateTime CreatedAt = new(2026, 8, 16, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime TaskAddedAt = new(2026, 8, 16, 9, 0, 0, DateTimeKind.Utc);

    private static readonly Guid FarmGuid = Guid.Parse("7b000000-0000-0000-0000-000000000001");
    private static readonly FarmId FarmIdVo = new(FarmGuid);
    private static readonly Guid PlotGuid = Guid.Parse("7b000000-0000-0000-0000-000000000002");
    private static readonly Guid CropCycleGuid = Guid.Parse("7b000000-0000-0000-0000-000000000003");
    private static readonly Guid OwnerGuid = Guid.Parse("7b000000-0000-0000-0000-000000000004");
    private static readonly Guid MukadamGuid = Guid.Parse("7b000000-0000-0000-0000-000000000005");
    private static readonly Guid WorkerGuid = Guid.Parse("7b000000-0000-0000-0000-000000000006");

    // ─────────────────────────────────────────────────────────────────────────
    // DIRECTION 1 — the owner adds to his own day. It must stay closed, and the
    // attestation must move forward to cover what he just added.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_owners_second_task_of_the_day_keeps_his_day_verified_and_freshly_attested()
    {
        var (handler, repo, log) = BuildScenario(attestedByOwner: true);
        var attestationBefore = log.VerificationEvents.Max(e => e.OccurredAtUtc);

        var result = await handler.HandleAsync(NewTaskCommand(log.Id, actorUserId: OwnerGuid));

        result.IsSuccess.Should().BeTrue($"got error: {result.Error?.Code}");
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified,
            "a naive Edit would have left the owner's own day stranded in Draft on his " +
            "SECOND task — the exact bug wave-1.3 fixed");

        // The attestation is NEW, not the old one surviving a re-read. This is what makes
        // it cover the task: the events that say Verified are stamped after the task.
        log.VerificationEvents.Max(e => e.OccurredAtUtc).Should().BeAfter(attestationBefore,
            "the day is re-attested, not merely left alone — the timestamp is the proof " +
            "that the approval now post-dates the content it approves");

        // The trail records that the day was re-opened and re-closed, rather than never
        // having moved: Draft (edit) -> Confirmed -> Verified, all after creation.
        var afterTheTask = log.VerificationEvents
            .Where(e => e.OccurredAtUtc > attestationBefore)
            .OrderBy(e => e.OccurredAtUtc)
            .ToList();
        afterTheTask.Select(e => e.Status).Should().Equal(
            VerificationStatus.Draft, VerificationStatus.Confirmed, VerificationStatus.Verified);
        afterTheTask.Should().OnlyContain(e => e.VerifiedByUserId == new UserId(OwnerGuid));

        var auditRow = repo.AuditEvents.Single(a => a.Action == "VerificationChanged");
        auditRow.Payload.Should().Contain("\"from\":\"Verified\"").And.Contain("\"to\":\"Verified\"");
        auditRow.Payload.Should().Contain("\"reAttestedByCreator\":true");
        auditRow.Payload.Should().Contain("\"role\":\"PrimaryOwner\"");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIRECTION 2 — somebody else adds to the owner's day. It must re-open into
    // his inbox. This closes a real pre-existing hole on the money path.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Anyone_elses_task_re_opens_the_owners_day_into_his_inbox()
    {
        var (handler, repo, log) = BuildScenario(attestedByOwner: true);

        var result = await handler.HandleAsync(NewTaskCommand(log.Id, actorUserId: MukadamGuid));

        result.IsSuccess.Should().BeTrue("a mukadam is a member of this farm and may record work");
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft,
            "the owner approved a day that did not contain this task; his approval cannot " +
            "silently stretch to cover work somebody else appended afterwards");

        log.VerificationEvents.OrderBy(e => e.OccurredAtUtc).Last()
            .VerifiedByUserId.Should().Be(new UserId(MukadamGuid),
                "the re-open is attributed to whoever caused it");

        var auditRow = repo.AuditEvents.Single(a => a.Action == "VerificationChanged");
        auditRow.Payload.Should().Contain("\"from\":\"Verified\"").And.Contain("\"to\":\"Draft\"");
        auditRow.Payload.Should().Contain("\"reAttestedByCreator\":false");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIRECTION 2, THE MONEY CONSEQUENCE — a payout already authorised on the
    // strength of that approval must be withdrawn, not left standing.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Re_opening_the_day_withdraws_a_payout_that_was_authorised_on_it()
    {
        var (handler, repo, log) = BuildScenario(attestedByOwner: true);
        var jobCard = AuthorisedJobCardFor(repo, log.Id);
        jobCard.Status.Should().Be(JobCardStatus.VerifiedForPayout, "pre-condition");

        await handler.HandleAsync(NewTaskCommand(log.Id, actorUserId: MukadamGuid));

        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        jobCard.Status.Should().Be(JobCardStatus.Completed,
            "the payout authorisation rested on an approval that no longer covers the day's " +
            "work; leaving the card VerifiedForPayout would pay against a re-opened log");
    }

    [Fact]
    public async Task The_owners_own_addition_does_not_authorise_a_payout_by_itself()
    {
        var (handler, repo, log) = BuildScenario(attestedByOwner: true);
        var jobCard = CompletedJobCardFor(repo, log.Id);

        await handler.HandleAsync(NewTaskCommand(log.Id, actorUserId: OwnerGuid));

        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified);
        jobCard.Status.Should().Be(JobCardStatus.Completed,
            "typing another task is not an act of authorising money — only a person asking " +
            "for the payout may move the card");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE UNTOUCHED CASE — a day nobody has attested to (a mukadam's) is not
    // re-opened, not promoted, and emits no verification row at all.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_day_nobody_has_attested_to_is_left_exactly_where_it_was()
    {
        var (handler, repo, log) = BuildScenario(attestedByOwner: false);
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft, "pre-condition");

        var result = await handler.HandleAsync(NewTaskCommand(log.Id, actorUserId: MukadamGuid));

        result.IsSuccess.Should().BeTrue();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        log.VerificationEvents.Should().BeEmpty(
            "there was no approval to invalidate and none to grant — adding a task to a " +
            "Draft day must not touch the verification trail at all");
        repo.AuditEvents.Should().NotContain(a => a.Action == "VerificationChanged");
    }

    // ── Scenario builders ────────────────────────────────────────────────────

    private static (AddLogTaskHandler Handler, AddLogTaskScenarioRepo Repo, DailyLog Log)
        BuildScenario(bool attestedByOwner)
    {
        var operatorGuid = attestedByOwner ? OwnerGuid : MukadamGuid;

        var log = DailyLog.Create(
            Guid.NewGuid(),
            FarmIdVo,
            PlotGuid,
            CropCycleGuid,
            new UserId(operatorGuid),
            new DateOnly(2026, 8, 16),
            idempotencyKey: null,
            location: null,
            createdAtUtc: CreatedAt);

        if (attestedByOwner)
        {
            // Exactly what CreateDailyLogHandler produces for an owner's own log.
            log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt)
                .Should().BeTrue();
        }

        var repo = new AddLogTaskScenarioRepo(log,
            CropCycle.Create(CropCycleGuid, FarmIdVo, PlotGuid, "Grapes", "Fruiting",
                new DateOnly(2026, 1, 1), null, CreatedAt));
        repo.SetMembership(OwnerGuid, AppRole.PrimaryOwner);
        repo.SetMembership(MukadamGuid, AppRole.Mukadam);
        repo.SetMembership(WorkerGuid, AppRole.Worker);

        var clock = new FixedClock(TaskAddedAt);
        var handler = new AddLogTaskHandler(
            repo,
            new NewGuidIdGenerator(),
            clock,
            new AllowAllEntitlementPolicy(),
            new NoopComplianceService(),
            new OnLogVerifiedAutoVerifyJobCard(
                repo,
                new VerifyJobCardForPayoutHandler(repo, clock),
                clock,
                NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance));

        return (handler, repo, log);
    }

    private static AddLogTaskCommand NewTaskCommand(Guid logId, Guid actorUserId) => new(
        DailyLogId: logId,
        ActivityType: "spray",
        Notes: "second pass on the east block",
        OccurredAtUtc: TaskAddedAt,
        LogTaskId: null,
        ActorUserId: actorUserId,
        ActorRole: "primary_owner", // deliberately claimed by BOTH actors; must be ignored.
        ClientCommandId: "cmd-add-task");

    private static JobCard CompletedJobCardFor(AddLogTaskScenarioRepo repo, Guid dailyLogId)
    {
        var jobCard = JobCard.CreateDraft(
            Guid.NewGuid(),
            FarmIdVo,
            PlotGuid,
            CropCycleGuid,
            new UserId(MukadamGuid),
            new DateOnly(2026, 8, 16),
            [new JobCardLineItem("spray", 2m, new Money(300m, Currency.Inr), null)],
            CreatedAt);

        jobCard.Assign(new UserId(WorkerGuid), new UserId(MukadamGuid), AppRole.Mukadam, CreatedAt);
        jobCard.Start(new UserId(WorkerGuid), CreatedAt.AddMinutes(5));
        jobCard.CompleteWithLog(dailyLogId, new UserId(WorkerGuid), CreatedAt.AddHours(1));

        repo.SeedJobCard(jobCard);
        return jobCard;
    }

    private static JobCard AuthorisedJobCardFor(AddLogTaskScenarioRepo repo, Guid dailyLogId)
    {
        var jobCard = CompletedJobCardFor(repo, dailyLogId);
        jobCard.MarkVerifiedForPayout(
            VerificationStatus.Verified, new UserId(OwnerGuid), AppRole.PrimaryOwner, CreatedAt.AddHours(2));
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

    private sealed class NoopComplianceService : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }

    /// <summary>
    /// Holds the SAME DailyLog and JobCard instances the handler mutates, so the
    /// assertions read the objects production would have written.
    /// </summary>
    private sealed class AddLogTaskScenarioRepo(DailyLog log, CropCycle cropCycle)
        : Work.Handlers.StubShramSafalRepository
    {
        private readonly Dictionary<Guid, AppRole> _memberships = [];
        private readonly Dictionary<Guid, JobCard> _jobCards = [];

        public List<AuditEvent> AuditEvents { get; } = [];

        public void SetMembership(Guid userId, AppRole role) => _memberships[userId] = role;

        public void SeedJobCard(JobCard jobCard) => _jobCards[jobCard.Id] = jobCard;

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult<DailyLog?>(log.Id == dailyLogId ? log : null);

        public override Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
            => Task.FromResult<CropCycle?>(cropCycle.Id == cropCycleId ? cropCycle : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(farmId == FarmGuid && _memberships.ContainsKey(userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(
                farmId == FarmGuid && _memberships.TryGetValue(userId, out var role) ? role : null);

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var card) ? card : null);

        public override Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.Values.FirstOrDefault(c => c.LinkedDailyLogId == dailyLogId));

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
