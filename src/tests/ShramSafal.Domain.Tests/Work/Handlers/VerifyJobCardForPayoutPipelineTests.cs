using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyJobCardForPayout): end-to-end
/// coverage of the verify-job-card-for-payout pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the id is
/// missing, <see cref="ShramSafalErrors.Forbidden"/> when the caller
/// has no membership, and
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the role
/// is not in the eligible set
/// (PrimaryOwner / SecondaryOwner / Agronomist /
/// FpcTechnicalManager).</item>
/// <item>The pipeline short-circuits at validator and authorizer.</item>
/// <item>The body's CEI-I9 invariant (linked log must be Verified)
/// propagates through the pipeline as
/// <see cref="ShramSafalErrors.JobCardInvalidState"/>.</item>
/// <item>Happy path runs the body across all four eligible roles:
/// status flips to VerifiedForPayout, audit row emitted.</item>
/// </list>
/// </summary>
public sealed class VerifyJobCardForPayoutPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId Caller = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly UserId Agronomist = new(Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_JobCardId_is_empty()
    {
        var v = new VerifyJobCardForPayoutValidator();
        var errs = v.Validate(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.Empty,
            CallerUserId: Caller,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new VerifyJobCardForPayoutValidator();
        var errs = v.Validate(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new VerifyJobCardForPayoutValidator();
        var errs = v.Validate(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Caller,
            ClientCommandId: "verify-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardVerifyRepo();
        var a = new VerifyJobCardForPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Caller,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_has_no_membership()
    {
        var (job, _) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new InMemoryJobCardVerifyRepo();
        repo.SeedJobCard(job);
        var a = new VerifyJobCardForPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Stranger,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_JobCardRoleNotAllowed_when_caller_is_Worker()
    {
        var (job, _) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new InMemoryJobCardVerifyRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);
        var a = new VerifyJobCardForPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_JobCardRoleNotAllowed_when_caller_is_Mukadam()
    {
        // Mukadam can assign / cancel but is NOT in the verify-for-
        // payout eligible set — proves the role-tier rule excludes
        // operational roles below owner/agronomist tier.
        var (job, _) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new InMemoryJobCardVerifyRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);
        var a = new VerifyJobCardForPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
    }

    [Theory]
    [InlineData(AppRole.PrimaryOwner)]
    [InlineData(AppRole.SecondaryOwner)]
    [InlineData(AppRole.Agronomist)]
    [InlineData(AppRole.FpcTechnicalManager)]
    public async Task Authorizer_returns_Success_for_eligible_roles(AppRole role)
    {
        var (job, _) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new InMemoryJobCardVerifyRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Caller.Value, role);
        var a = new VerifyJobCardForPayoutAuthorizer(repo);

        var result = await a.AuthorizeAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Caller,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_JobCardId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.Empty,
            CallerUserId: Caller,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardNotFound_when_jobcard_is_missing()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Caller,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardRoleNotAllowed_for_Worker()
    {
        var (job, _) = BuildCompletedJobCardWithLog(logVerified: true);
        var (pipeline, repo) = BuildPipeline(job, null);
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);

        var result = await pipeline.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardInvalidState_when_linked_log_is_not_verified()
    {
        // Validator + authorizer pass: Caller is an Agronomist, which
        // is in the eligible set. But the linked DailyLog is still in
        // Draft status, so JobCard.MarkVerifiedForPayout (CEI-I9)
        // throws InvalidOperationException — the body's catch surfaces
        // this as JobCardInvalidState. This proves the body's
        // aggregate-state check propagates through the pipeline
        // unchanged when validator + authorizer pass.
        var (job, log) = BuildCompletedJobCardWithLog(logVerified: false);
        var (pipeline, repo) = BuildPipeline(job, log);
        repo.SetMembership(Farm.Value, Caller.Value, AppRole.Agronomist);

        var result = await pipeline.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Caller,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardInvalidState, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (job, log) = BuildCompletedJobCardWithLog(logVerified: true);
        var (pipeline, repo) = BuildPipeline(job, log);
        repo.SetMembership(Farm.Value, Caller.Value, AppRole.Agronomist);

        var result = await pipeline.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: Caller,
            ClientCommandId: "verify-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.VerifiedForPayout, job.Status);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.verified-for-payout", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static (JobCard job, DailyLog log) BuildCompletedJobCardWithLog(bool logVerified)
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
            Guid.NewGuid(),
            Farm,
            PlotGuid,
            Guid.NewGuid(),
            Worker,
            new DateOnly(2026, 4, 21),
            null, null,
            Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);

        job.CompleteWithLog(log.Id, Worker, Now.AddHours(2));

        if (logVerified)
        {
            // Draft -> Confirmed -> Verified (state machine requires two steps)
            log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Agronomist, Agronomist, Now.AddHours(2));
            log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.Agronomist, Agronomist, Now.AddHours(3));
        }

        return (job, log);
    }

    private static (
        IHandler<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult> Pipeline,
        InMemoryJobCardVerifyRepo Repo) BuildPipeline(JobCard? jobCard = null, DailyLog? dailyLog = null)
    {
        var repo = new InMemoryJobCardVerifyRepo();
        if (jobCard is not null) repo.SeedJobCard(jobCard);
        if (dailyLog is not null) repo.SeedLog(dailyLog);

        var clock = new FixedClockForVerify(Now.AddHours(4));
        var rawHandler = new VerifyJobCardForPayoutHandler(repo, clock);

        var validator = new VerifyJobCardForPayoutValidator();
        var authorizer = new VerifyJobCardForPayoutAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>(
                NullLogger<LoggingBehavior<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>>.Instance),
            new ValidationBehavior<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>(
                new IValidator<VerifyJobCardForPayoutCommand>[] { validator }),
            new AuthorizationBehavior<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>(
                new IAuthorizationCheck<VerifyJobCardForPayoutCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForVerify(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// <see cref="VerifyJobCardForPayoutHandler"/> +
    /// <see cref="VerifyJobCardForPayoutAuthorizer"/> touch.
    /// </summary>
    private sealed class InMemoryJobCardVerifyRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();

        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var l) ? l : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var r) ? r : null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
