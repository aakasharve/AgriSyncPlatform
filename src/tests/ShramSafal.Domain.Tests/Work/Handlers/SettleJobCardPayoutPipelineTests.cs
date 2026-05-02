using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): end-to-end coverage
/// of the settle-job-card-payout pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs / non-positive amount /
/// blank currency code as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the id is
/// missing, <see cref="ShramSafalErrors.Forbidden"/> when the caller
/// has no membership, and
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the
/// caller's role is not PrimaryOwner / SecondaryOwner.</item>
/// <item>The pipeline short-circuits at validator and authorizer.</item>
/// <item>The body's status-machine gate
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>) propagates
/// through the pipeline when the job card is not in
/// VerifiedForPayout status.</item>
/// <item>Happy path runs the body: a labour_payout CostEntry is
/// added, the JobCard transitions to PaidOut, audit row emitted.</item>
/// </list>
/// </summary>
public sealed class SettleJobCardPayoutPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId Owner = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly UserId Agronomist = new(Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_JobCardId_is_empty()
    {
        var v = new SettleJobCardPayoutValidator();
        var errs = v.Validate(new SettleJobCardPayoutCommand(
            JobCardId: Guid.Empty,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new SettleJobCardPayoutValidator();
        var errs = v.Validate(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-1000)]
    public void Validator_yields_InvalidCommand_when_ActualPayoutAmount_is_non_positive(decimal amount)
    {
        var v = new SettleJobCardPayoutValidator();
        var errs = v.Validate(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: amount,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validator_yields_InvalidCommand_when_CurrencyCode_is_blank(string? code)
    {
        var v = new SettleJobCardPayoutValidator();
        var errs = v.Validate(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: code!,
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new SettleJobCardPayoutValidator();
        var errs = v.Validate(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: "settled",
            CallerUserId: Owner,
            ClientCommandId: "settle-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardSettleRepo();
        var a = new SettleJobCardPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_has_no_membership()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new InMemoryJobCardSettleRepo();
        repo.SeedJobCard(job);
        // Owner is not a member.
        var a = new SettleJobCardPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_JobCardRoleNotAllowed_when_caller_is_Mukadam()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new InMemoryJobCardSettleRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);
        var a = new SettleJobCardPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_PrimaryOwner()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new InMemoryJobCardSettleRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Owner.Value, AppRole.PrimaryOwner);
        var a = new SettleJobCardPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_SecondaryOwner()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new InMemoryJobCardSettleRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Owner.Value, AppRole.SecondaryOwner);
        var a = new SettleJobCardPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_amount_is_zero()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 0m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Empty(repo.AddedCostEntries);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardNotFound_when_jobcard_is_missing()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: Guid.NewGuid(),
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Empty(repo.AddedCostEntries);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardRoleNotAllowed_for_Mukadam()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Mukadam,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Empty(repo.AddedCostEntries);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardInvalidState_when_jobcard_is_not_VerifiedForPayout()
    {
        // Validator + authorizer pass (Owner is PrimaryOwner) but the
        // body's status check fires.
        var jobCompletedNotVerified = BuildCompletedJobCard();
        var (pipeline, repo) = BuildPipeline(jobCompletedNotVerified);
        repo.SetMembership(Farm.Value, Owner.Value, AppRole.PrimaryOwner);

        var result = await pipeline.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: jobCompletedNotVerified.Id,
            ActualPayoutAmount: 200m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardInvalidState, result.Error);
        Assert.Empty(repo.AddedCostEntries);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Owner.Value, AppRole.PrimaryOwner);

        var result = await pipeline.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id,
            ActualPayoutAmount: 250m,
            ActualPayoutCurrencyCode: "INR",
            SettlementNote: null,
            CallerUserId: Owner,
            ClientCommandId: "settle-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.PaidOut, result.Value!.JobCardStatus);
        Assert.Equal(JobCardStatus.PaidOut, job.Status);
        Assert.Single(repo.AddedCostEntries);
        Assert.Equal("labour_payout", repo.AddedCostEntries[0].Category);
        Assert.Equal(250m, repo.AddedCostEntries[0].Amount);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.paid-out", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static JobCard BuildVerifiedForPayoutJobCard()
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(),
            Farm,
            PlotGuid,
            cropCycleId: null,
            Mukadam,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
        job.Assign(Worker, Mukadam, AppRole.Mukadam, Now);
        job.Start(Worker, Now.AddMinutes(5));

        var log = DailyLog.Create(
            Guid.NewGuid(), Farm, PlotGuid, Guid.NewGuid(),
            Worker, new DateOnly(2026, 4, 21), null, null, Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Agronomist, Agronomist, Now.AddMinutes(30));
        log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.Agronomist, Agronomist, Now.AddHours(1));

        job.CompleteWithLog(log.Id, Worker, Now.AddHours(2));
        job.MarkVerifiedForPayout(VerificationStatus.Verified, Agronomist, AppRole.Agronomist, Now.AddHours(3));
        return job;
    }

    private static JobCard BuildCompletedJobCard()
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), Farm, PlotGuid, null, Mukadam,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
        job.Assign(Worker, Mukadam, AppRole.Mukadam, Now);
        var log = DailyLog.Create(Guid.NewGuid(), Farm, PlotGuid, Guid.NewGuid(), Worker, new DateOnly(2026, 4, 21), null, null, Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);
        job.CompleteWithLog(log.Id, Worker, Now.AddHours(2));
        // Status is Completed, not VerifiedForPayout.
        return job;
    }

    private static (
        IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult> Pipeline,
        InMemoryJobCardSettleRepo Repo) BuildPipeline(JobCard? jobCard = null)
    {
        var repo = new InMemoryJobCardSettleRepo();
        if (jobCard is not null) repo.SeedJobCard(jobCard);

        var clock = new FixedClockForSettle(Now.AddHours(4));
        var idGen = new SeqIdGenForSettle();
        var rawHandler = new SettleJobCardPayoutHandler(repo, idGen, clock);

        var validator = new SettleJobCardPayoutValidator();
        var authorizer = new SettleJobCardPayoutAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>(
                NullLogger<LoggingBehavior<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>>.Instance),
            new ValidationBehavior<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>(
                new IValidator<SettleJobCardPayoutCommand>[] { validator }),
            new AuthorizationBehavior<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>(
                new IAuthorizationCheck<SettleJobCardPayoutCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForSettle(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SeqIdGenForSettle : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// SettleJobCardPayoutHandler + SettleJobCardPayoutAuthorizer touch.
    /// </summary>
    private sealed class InMemoryJobCardSettleRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();

        public List<CostEntry> AddedCostEntries { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var r) ? r : null);

        public override Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
        {
            AddedCostEntries.Add(costEntry);
            return Task.CompletedTask;
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
