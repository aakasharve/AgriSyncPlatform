using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): end-to-end coverage of
/// the create-job-card pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs / empty LineItems as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.Forbidden"/> when the caller has no
/// membership on the target farm, and
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the caller
/// is a member but the role is below Mukadam (Worker).</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer, leaving the inner handler body un-invoked (no audit row,
/// no JobCard added).</item>
/// <item>Happy path runs the body across all three eligible roles
/// (PrimaryOwner, SecondaryOwner, Mukadam): the JobCard is added in
/// Draft, an audit row is emitted, the result carries the new
/// JobCardId.</item>
/// </list>
/// </summary>
public sealed class CreateJobCardPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Owner = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    private static readonly IReadOnlyList<JobCardLineItemDto> ValidLineItems = new[]
    {
        new JobCardLineItemDto("spray", 4m, 50m, "INR", null)
    };

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new CreateJobCardValidator();
        var errs = v.Validate(BuildCommand(farmId: new FarmId(Guid.Empty))).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_PlotId_is_empty()
    {
        var v = new CreateJobCardValidator();
        var errs = v.Validate(BuildCommand(plotId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new CreateJobCardValidator();
        var errs = v.Validate(BuildCommand(callerUserId: new UserId(Guid.Empty))).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_LineItems_is_null()
    {
        var v = new CreateJobCardValidator();
        // Bypass the BuildCommand helper's null-coalescing so the
        // command DTO actually carries a null LineItems list.
        var cmd = new CreateJobCardCommand(
            FarmId: Farm,
            PlotId: PlotGuid,
            CropCycleId: null,
            PlannedDate: new DateOnly(2026, 4, 21),
            LineItems: null!,
            CallerUserId: Mukadam,
            ClientCommandId: null);
        var errs = v.Validate(cmd).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_LineItems_is_empty()
    {
        var v = new CreateJobCardValidator();
        var errs = v.Validate(BuildCommand(lineItems: Array.Empty<JobCardLineItemDto>())).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_invariants_pass()
    {
        var v = new CreateJobCardValidator();
        var errs = v.Validate(BuildCommand()).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_has_no_membership()
    {
        var repo = new InMemoryJobCardCreateRepo();
        var a = new CreateJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(BuildCommand(callerUserId: Stranger), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_JobCardRoleNotAllowed_when_caller_is_Worker()
    {
        var repo = new InMemoryJobCardCreateRepo();
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);
        var a = new CreateJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(BuildCommand(callerUserId: Worker), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Theory]
    [InlineData(AppRole.PrimaryOwner)]
    [InlineData(AppRole.SecondaryOwner)]
    [InlineData(AppRole.Mukadam)]
    public async Task Authorizer_returns_Success_for_eligible_roles(AppRole role)
    {
        var repo = new InMemoryJobCardCreateRepo();
        repo.SetMembership(Farm.Value, Owner.Value, role);
        var a = new CreateJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(BuildCommand(callerUserId: Owner), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_LineItems_is_empty()
    {
        var (pipeline, repo) = BuildPipeline();

        var result = await pipeline.HandleAsync(
            BuildCommand(lineItems: Array.Empty<JobCardLineItemDto>()));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Body adds the JobCard + audit row on success — their absence
        // proves the pipeline short-circuited before the handler ran.
        Assert.Empty(repo.AddedJobCards);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_caller_has_no_membership()
    {
        var (pipeline, repo) = BuildPipeline();
        // No membership set.

        var result = await pipeline.HandleAsync(BuildCommand(callerUserId: Stranger));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AddedJobCards);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardRoleNotAllowed_for_Worker()
    {
        var (pipeline, repo) = BuildPipeline();
        repo.SetMembership(Farm.Value, Worker.Value, AppRole.Worker);

        var result = await pipeline.HandleAsync(BuildCommand(callerUserId: Worker));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardRoleNotAllowed, result.Error);
        Assert.Empty(repo.AddedJobCards);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (pipeline, repo) = BuildPipeline();
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);

        var result = await pipeline.HandleAsync(BuildCommand(callerUserId: Mukadam));

        Assert.True(result.IsSuccess);
        Assert.NotEqual(Guid.Empty, result.Value!.JobCardId);
        Assert.Single(repo.AddedJobCards);
        Assert.Equal(JobCardStatus.Draft, repo.AddedJobCards[0].Status);
        Assert.Equal(Farm, repo.AddedJobCards[0].FarmId);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.created", repo.AuditEvents[0].Action);
    }

    [Fact]
    public async Task Pipeline_propagates_InvalidCommand_from_body_when_line_items_use_mixed_currencies()
    {
        // Validator + authorizer pass — the validator only checks shape
        // (non-empty LineItems list), and the authorizer only checks
        // role-tier. The body delegates to JobCard.CreateDraft, which
        // throws ArgumentException when line items use different
        // currencies. The handler's catch block surfaces this as
        // InvalidCommand — verifying that body-domain errors propagate
        // through the pipeline unchanged.
        var (pipeline, repo) = BuildPipeline();
        repo.SetMembership(Farm.Value, Mukadam.Value, AppRole.Mukadam);

        var mixedLineItems = new[]
        {
            new JobCardLineItemDto("spray", 4m, 50m, "INR", null),
            new JobCardLineItemDto("water", 2m, 5m, "USD", null)
        };

        var result = await pipeline.HandleAsync(BuildCommand(
            callerUserId: Mukadam,
            lineItems: mixedLineItems));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand, result.Error);
        // Body returned BEFORE adding the job card or emitting audit.
        Assert.Empty(repo.AddedJobCards);
        Assert.Empty(repo.AuditEvents);
    }

    // ---- helpers ----

    private static CreateJobCardCommand BuildCommand(
        FarmId? farmId = null,
        Guid? plotId = null,
        UserId? callerUserId = null,
        IReadOnlyList<JobCardLineItemDto>? lineItems = null)
    {
        return new CreateJobCardCommand(
            FarmId: farmId ?? Farm,
            PlotId: plotId ?? PlotGuid,
            CropCycleId: null,
            PlannedDate: new DateOnly(2026, 4, 21),
            LineItems: lineItems ?? ValidLineItems,
            CallerUserId: callerUserId ?? Mukadam,
            ClientCommandId: null);
    }

    private static (
        IHandler<CreateJobCardCommand, CreateJobCardResult> Pipeline,
        InMemoryJobCardCreateRepo Repo) BuildPipeline()
    {
        var repo = new InMemoryJobCardCreateRepo();
        var clock = new FixedClockForCreate(Now);
        var idGen = new SeqIdGenForCreate();
        var rawHandler = new CreateJobCardHandler(repo, idGen, clock);

        var validator = new CreateJobCardValidator();
        var authorizer = new CreateJobCardAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CreateJobCardCommand, CreateJobCardResult>(
                NullLogger<LoggingBehavior<CreateJobCardCommand, CreateJobCardResult>>.Instance),
            new ValidationBehavior<CreateJobCardCommand, CreateJobCardResult>(
                new IValidator<CreateJobCardCommand>[] { validator }),
            new AuthorizationBehavior<CreateJobCardCommand, CreateJobCardResult>(
                new IAuthorizationCheck<CreateJobCardCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FixedClockForCreate(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SeqIdGenForCreate : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    /// <summary>
    /// In-memory repository covering only the methods that
    /// <see cref="CreateJobCardHandler"/> + <see cref="CreateJobCardAuthorizer"/>
    /// touch on the happy path.
    /// </summary>
    private sealed class InMemoryJobCardCreateRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();

        public List<JobCard> AddedJobCards { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();

        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var r) ? r : null);

        public override Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default)
        {
            AddedJobCards.Add(jobCard);
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
