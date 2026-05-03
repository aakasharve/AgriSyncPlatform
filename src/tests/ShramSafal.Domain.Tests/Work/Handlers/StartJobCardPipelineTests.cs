using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (StartJobCard): end-to-end coverage of
/// the start-job-card pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the id is
/// missing, and <see cref="ShramSafalErrors.Forbidden"/> when the
/// caller is not a member of the job card's farm.</item>
/// <item>The pipeline short-circuits at validator and authorizer.</item>
/// <item>The body's assigned-worker invariant
/// (<see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) propagates
/// through the pipeline when validator + authorizer pass but the
/// caller is a member who is not the assigned worker.</item>
/// <item>Happy path runs the body across the assigned worker: status
/// flips to InProgress, audit row emitted, StartedAtUtc populated.</item>
/// <item>Same-timestamp idempotency: re-issuing the start command for
/// the assigned worker after the job is already started returns
/// success with the original StartedAtUtc, without emitting a second
/// audit row.</item>
/// </list>
/// </summary>
public sealed class StartJobCardPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId OtherMember = new(Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_JobCardId_is_empty()
    {
        var v = new StartJobCardValidator();
        var errs = v.Validate(new StartJobCardCommand(
            JobCardId: Guid.Empty,
            CallerUserId: Worker,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new StartJobCardValidator();
        var errs = v.Validate(new StartJobCardCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new StartJobCardValidator();
        var errs = v.Validate(new StartJobCardCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: "start-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardStartRepo();
        var a = new StartJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new StartJobCardCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member()
    {
        var job = BuildAssignedJobCard();
        var repo = new InMemoryJobCardStartRepo();
        repo.SeedJobCard(job);
        // Stranger is not a member.
        var a = new StartJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new StartJobCardCommand(
            JobCardId: job.Id,
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
        var repo = new InMemoryJobCardStartRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Worker.Value);
        var a = new StartJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_JobCardId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: Guid.Empty,
            CallerUserId: Worker,
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

        var result = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: Guid.NewGuid(),
            CallerUserId: Worker,
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

        var result = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: Stranger,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardRoleNotAllowed_from_body_when_caller_is_member_but_not_assigned_worker()
    {
        // Validator + authorizer pass: OtherMember IS a member of the
        // farm. But JobCard.Start enforces "only the assigned worker
        // may start" — surfaced as JobCardRoleNotAllowed via the
        // body's InvalidOperationException catch.
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, OtherMember.Value);

        var result = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: OtherMember,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Worker.Value);

        var result = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: "start-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.InProgress, job.Status);
        Assert.NotNull(job.StartedAtUtc);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.started", repo.AuditEvents[0].Action);
    }

    [Fact]
    public async Task Pipeline_supports_same_timestamp_idempotency_when_assigned_worker_resubmits()
    {
        // Body's idempotency rule: if the JobCard is already started
        // AND the caller is the assigned worker, return success with
        // the existing StartedAtUtc — without emitting a fresh audit
        // row. This proves the pipeline doesn't break that contract.
        var job = BuildAssignedJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Worker.Value);

        var first = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: "start-idem-1"));
        Assert.True(first.IsSuccess);
        var firstStartedAt = first.Value!.StartedAtUtc;
        Assert.Single(repo.AuditEvents);

        var second = await pipeline.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: Worker,
            ClientCommandId: "start-idem-2"));

        Assert.True(second.IsSuccess);
        Assert.Equal(firstStartedAt, second.Value!.StartedAtUtc);
        // No new audit row from the idempotent re-issue.
        Assert.Single(repo.AuditEvents);
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
        IHandler<StartJobCardCommand, StartJobCardResult> Pipeline,
        InMemoryJobCardStartRepo Repo) BuildPipeline(JobCard? jobCard = null)
    {
        var repo = new InMemoryJobCardStartRepo();
        if (jobCard is not null) repo.SeedJobCard(jobCard);

        var clock = new FixedClockForStart(Now.AddHours(1));
        var rawHandler = new StartJobCardHandler(repo, clock);

        var validator = new StartJobCardValidator();
        var authorizer = new StartJobCardAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<StartJobCardCommand, StartJobCardResult>(
                NullLogger<LoggingBehavior<StartJobCardCommand, StartJobCardResult>>.Instance),
            new ValidationBehavior<StartJobCardCommand, StartJobCardResult>(
                new IValidator<StartJobCardCommand>[] { validator }),
            new AuthorizationBehavior<StartJobCardCommand, StartJobCardResult>(
                new IAuthorizationCheck<StartJobCardCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForStart(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// <see cref="StartJobCardHandler"/> + <see cref="StartJobCardAuthorizer"/>
    /// touch on the happy path.
    /// </summary>
    private sealed class InMemoryJobCardStartRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _memberships = new();

        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SetMembership(Guid farmId, Guid userId) => _memberships.Add((farmId, userId));

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_memberships.Contains((farmId, userId)));

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
