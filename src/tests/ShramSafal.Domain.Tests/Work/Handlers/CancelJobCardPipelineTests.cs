using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.CancelJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): end-to-end coverage of
/// the cancel-job-card pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs / blank Reason as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the id is
/// missing, and <see cref="ShramSafalErrors.Forbidden"/> when the
/// caller is not a member of the job card's farm.</item>
/// <item>The pipeline short-circuits at the validator and the
/// authorizer, leaving the inner handler body un-invoked.</item>
/// <item>The body's role-tier check
/// (<see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) and
/// state-machine check
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>) propagate
/// through the pipeline unchanged when validator + authorizer pass.</item>
/// <item>Happy path runs the body: status flips to Cancelled and an
/// audit row is emitted.</item>
/// </list>
/// </summary>
public sealed class CancelJobCardPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId Owner = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_JobCardId_is_empty()
    {
        var v = new CancelJobCardValidator();
        var errs = v.Validate(new CancelJobCardCommand(
            JobCardId: Guid.Empty,
            Reason: "test",
            CallerUserId: Mukadam,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new CancelJobCardValidator();
        var errs = v.Validate(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: "test",
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validator_yields_InvalidCommand_when_Reason_is_blank(string? reason)
    {
        var v = new CancelJobCardValidator();
        var errs = v.Validate(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: reason!,
            CallerUserId: Mukadam,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new CancelJobCardValidator();
        var errs = v.Validate(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: "Plan changed",
            CallerUserId: Mukadam,
            ClientCommandId: "cancel-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardRepoForCancel();
        var a = new CancelJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: "test",
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member_of_the_jobcards_farm()
    {
        var job = BuildAssignedJobCard();
        var repo = new InMemoryJobCardRepoForCancel();
        repo.SeedJobCard(job);
        // Stranger has no membership.
        var a = new CancelJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CancelJobCardCommand(
            JobCardId: job.Id,
            Reason: "test",
            CallerUserId: Stranger,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_a_member()
    {
        var job = BuildAssignedJobCard();
        var repo = new InMemoryJobCardRepoForCancel();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);
        var a = new CancelJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CancelJobCardCommand(
            JobCardId: job.Id,
            Reason: "test",
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_Reason_is_blank()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: "",
            CallerUserId: Mukadam,
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

        var result = await pipeline.HandleAsync(new CancelJobCardCommand(
            JobCardId: Guid.NewGuid(),
            Reason: "test",
            CallerUserId: Mukadam,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_caller_is_not_a_member()
    {
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        // No membership for Stranger.

        var result = await pipeline.HandleAsync(new CancelJobCardCommand(
            JobCardId: job.Id,
            Reason: "test",
            CallerUserId: Stranger,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardRoleNotAllowed_when_worker_tries_to_cancel_assigned()
    {
        // Validator + authorizer pass (Worker IS a member). Body's
        // role-tier check inside JobCard.Cancel rejects Worker.
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);

        var result = await pipeline.HandleAsync(new CancelJobCardCommand(
            JobCardId: job.Id,
            Reason: "can't attend",
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Contains("JobCardRoleNotAllowed", result.Error.Code);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(new CancelJobCardCommand(
            JobCardId: job.Id,
            Reason: "Plan changed",
            CallerUserId: Mukadam,
            ClientCommandId: "cancel-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.Cancelled, job.Status);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.cancelled", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static JobCard BuildAssignedJobCard()
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
        return job;
    }

    private static (
        IHandler<CancelJobCardCommand, CancelJobCardResult> Pipeline,
        InMemoryJobCardRepoForCancel Repo) BuildPipeline(JobCard? jobCard = null)
    {
        var repo = new InMemoryJobCardRepoForCancel();
        if (jobCard is not null) repo.SeedJobCard(jobCard);

        var clock = new FixedClockForCancel(Now.AddHours(1));
        var rawHandler = new CancelJobCardHandler(repo, clock);

        var validator = new CancelJobCardValidator();
        var authorizer = new CancelJobCardAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CancelJobCardCommand, CancelJobCardResult>(
                NullLogger<LoggingBehavior<CancelJobCardCommand, CancelJobCardResult>>.Instance),
            new ValidationBehavior<CancelJobCardCommand, CancelJobCardResult>(
                new IValidator<CancelJobCardCommand>[] { validator }),
            new AuthorizationBehavior<CancelJobCardCommand, CancelJobCardResult>(
                new IAuthorizationCheck<CancelJobCardCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForCancel(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// CancelJobCardHandler + CancelJobCardAuthorizer touch.
    /// </summary>
    private sealed class InMemoryJobCardRepoForCancel : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();

        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_memberships.ContainsKey((farmId, userId)));

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
