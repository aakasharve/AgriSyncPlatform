using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): end-to-end coverage of
/// the assign-job-card pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the id is
/// missing, <see cref="ShramSafalErrors.Forbidden"/> when the caller
/// has no membership, and
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the
/// caller is a member but the role is below Mukadam.</item>
/// <item>The pipeline short-circuits at validator and authorizer.</item>
/// <item>The body's worker-membership check
/// (<see cref="ShramSafalErrors.JobCardWorkerNotMember"/>) propagates
/// through the pipeline when validator + authorizer pass but the
/// target worker is not on the farm.</item>
/// <item>Happy path runs the body: status flips to Assigned, an audit
/// row is emitted.</item>
/// </list>
/// </summary>
public sealed class AssignJobCardPipelineTests
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
        var v = new AssignJobCardValidator();
        var errs = v.Validate(new AssignJobCardCommand(
            JobCardId: Guid.Empty,
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_WorkerUserId_is_empty()
    {
        var v = new AssignJobCardValidator();
        var errs = v.Validate(new AssignJobCardCommand(
            JobCardId: Guid.NewGuid(),
            WorkerUserId: new UserId(Guid.Empty),
            CallerUserId: Mukadam,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new AssignJobCardValidator();
        var errs = v.Validate(new AssignJobCardCommand(
            JobCardId: Guid.NewGuid(),
            WorkerUserId: Worker,
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new AssignJobCardValidator();
        var errs = v.Validate(new AssignJobCardCommand(
            JobCardId: Guid.NewGuid(),
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: "assign-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardAssignRepo();
        var a = new AssignJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AssignJobCardCommand(
            JobCardId: Guid.NewGuid(),
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_has_no_membership()
    {
        var job = BuildDraftJobCard();
        var repo = new InMemoryJobCardAssignRepo();
        repo.SeedJobCard(job);
        // Stranger has no membership.
        var a = new AssignJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Stranger,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_JobCardRoleNotAllowed_when_caller_is_Worker()
    {
        var job = BuildDraftJobCard();
        var repo = new InMemoryJobCardAssignRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);
        var a = new AssignJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Theory]
    [InlineData(AppRole.Mukadam)]
    [InlineData(AppRole.PrimaryOwner)]
    [InlineData(AppRole.SecondaryOwner)]
    public async Task Authorizer_returns_Success_for_eligible_roles(AppRole role)
    {
        var job = BuildDraftJobCard();
        var repo = new InMemoryJobCardAssignRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, role);
        var a = new AssignJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_JobCardId_is_empty()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(new AssignJobCardCommand(
            JobCardId: Guid.Empty,
            WorkerUserId: Worker,
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

        var result = await pipeline.HandleAsync(new AssignJobCardCommand(
            JobCardId: Guid.NewGuid(),
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardRoleNotAllowed_for_Worker()
    {
        var job = BuildDraftJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);

        var result = await pipeline.HandleAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardWorkerNotMember_from_body_when_target_worker_is_not_on_farm()
    {
        // Validator + authorizer pass: caller is a Mukadam member.
        // But the worker's farm membership lookup returns null —
        // body fires JobCardWorkerNotMember.
        var job = BuildDraftJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);
        // No FarmMembership seeded for Worker.

        var result = await pipeline.HandleAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardWorkerNotMember, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var job = BuildDraftJobCard();
        var (pipeline, repo) = BuildPipeline(job);
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);
        repo.SetWorkerFarmMembership(Farm.Value, Worker.Value);

        var result = await pipeline.HandleAsync(new AssignJobCardCommand(
            JobCardId: job.Id,
            WorkerUserId: Worker,
            CallerUserId: Mukadam,
            ClientCommandId: "assign-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.Assigned, job.Status);
        Assert.Equal(Worker, job.AssignedWorkerUserId);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.assigned", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static JobCard BuildDraftJobCard()
    {
        return JobCard.CreateDraft(
            Guid.NewGuid(),
            Farm,
            PlotGuid,
            cropCycleId: null,
            Mukadam,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
    }

    private static (
        IHandler<AssignJobCardCommand, AssignJobCardResult> Pipeline,
        InMemoryJobCardAssignRepo Repo) BuildPipeline(JobCard? jobCard = null)
    {
        var repo = new InMemoryJobCardAssignRepo();
        if (jobCard is not null) repo.SeedJobCard(jobCard);

        var clock = new FixedClockForAssign(Now.AddHours(1));
        var rawHandler = new AssignJobCardHandler(repo, clock);

        var validator = new AssignJobCardValidator();
        var authorizer = new AssignJobCardAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<AssignJobCardCommand, AssignJobCardResult>(
                NullLogger<LoggingBehavior<AssignJobCardCommand, AssignJobCardResult>>.Instance),
            new ValidationBehavior<AssignJobCardCommand, AssignJobCardResult>(
                new IValidator<AssignJobCardCommand>[] { validator }),
            new AuthorizationBehavior<AssignJobCardCommand, AssignJobCardResult>(
                new IAuthorizationCheck<AssignJobCardCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForAssign(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// <see cref="AssignJobCardHandler"/> + <see cref="AssignJobCardAuthorizer"/>
    /// touch on the happy path.
    /// </summary>
    private sealed class InMemoryJobCardAssignRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();
        private readonly Dictionary<(Guid farmId, Guid userId), FarmMembership> _farmMemberships = new();

        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;
        public void SetWorkerFarmMembership(Guid farmId, Guid userId)
            => _farmMemberships[(farmId, userId)] = FarmMembership.Create(
                Guid.NewGuid(), new FarmId(farmId), new UserId(userId), AppRole.Worker, Now);

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var r) ? r : null);

        public override Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_farmMemberships.TryGetValue((farmId, userId), out var m) ? m : null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
