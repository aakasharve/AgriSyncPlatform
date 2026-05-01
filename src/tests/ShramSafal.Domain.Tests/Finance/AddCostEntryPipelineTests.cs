using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): end-to-end coverage of
/// the add-cost-entry pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs, blank Category, non-positive
/// Amount, the labour-payout routing rule, and explicit-but-empty
/// CostEntryId — all with the right Error / ErrorKind.</item>
/// <item>The authorizer surfaces FarmNotFound when the farm id
/// resolves to nothing, and Forbidden when the caller is not a
/// member of the target farm.</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer — the body's analytics emission does not happen.</item>
/// <item>The happy path runs the body: an audit row is written and
/// the LogCreated-class CostEntryAdded analytics event is emitted.</item>
/// </list>
/// </summary>
public sealed class AddCostEntryPipelineTests
{
    private static readonly Guid CreatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(farmId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CreatedByUserId_is_empty()
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(createdByUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validator_yields_InvalidCommand_when_Category_is_blank(string? category)
    {
        var v = new AddCostEntryValidator();
        // Build the command directly to bypass MakeCommand's `?? "seed"`
        // fallback, which would otherwise hide a null Category.
        var cmd = new AddCostEntryCommand(
            FarmId: FarmGuid,
            PlotId: null,
            CropCycleId: null,
            Category: category!,
            Description: "test",
            Amount: 100m,
            CurrencyCode: "INR",
            EntryDate: new DateOnly(2026, 4, 30),
            CreatedByUserId: CreatorUserId);
        var errs = v.Validate(cmd).ToList();
        Assert.Single(errs);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Validator_yields_InvalidCommand_when_Amount_is_non_positive(decimal amount)
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(amount: amount)).ToList();
        Assert.Single(errs);
    }

    [Theory]
    [InlineData("labour_payout")]
    [InlineData("Labour_Payout")]
    [InlineData("LABOUR_PAYOUT")]
    [InlineData("  labour_payout  ")]
    public void Validator_yields_UseSettleJobCardForLabourPayout_for_labour_payout_category(string category)
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(category: category)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.UseSettleJobCardForLabourPayout, errs[0]);
        Assert.Equal(ErrorKind.Forbidden, errs[0].Kind);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_explicit_CostEntryId_is_empty()
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(costEntryId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_accepts_null_CostEntryId_handler_will_generate_one()
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(costEntryId: null)).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_caller_shape_invariants_pass()
    {
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand()).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public void Validator_only_first_failure_per_call_when_two_gates_are_violated()
    {
        // empty FarmId AND labour_payout — InvalidCommand wins
        // (most-significant gate group fires first via yield-break).
        var v = new AddCostEntryValidator();
        var errs = v.Validate(MakeCommand(farmId: Guid.Empty, category: "labour_payout")).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_FarmNotFound_when_farm_id_resolves_to_nothing()
    {
        var repo = new InMemoryShramSafalRepository();
        // No farm seeded.
        var a = new AddCostEntryAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        // No membership for CreatorUserId.
        var a = new AddCostEntryAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        repo.SetMembership(FarmGuid, CreatorUserId, AppRole.Worker);
        var a = new AddCostEntryAuthorizer(repo);

        var result = await a.AuthorizeAsync(MakeCommand(), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_Amount_is_non_positive()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: true);

        var result = await pipeline.HandleAsync(MakeCommand(amount: 0));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_for_labour_payout_category()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: true);

        var result = await pipeline.HandleAsync(MakeCommand(category: "labour_payout"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.UseSettleJobCardForLabourPayout.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_FarmNotFound_when_farm_is_missing()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: false);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_caller_is_not_a_member()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(MakeFarm());
        // No membership.
        var (pipeline, analytics) = BuildPipelineFor(repo);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (pipeline, _, analytics) = BuildPipeline(seedAll: true);

        var result = await pipeline.HandleAsync(MakeCommand());

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        Assert.False(result.Value!.IsPotentialDuplicate);
        // Body emits a single CostEntryAdded analytics event on success
        // — its presence proves the pipeline forwarded the call to the
        // body and the body progressed past the entitlement gate, plot/
        // crop-cycle lookups (skipped here because both are null),
        // duplicate detection, audit, and save.
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.CostEntryAdded, analytics.Events[0].EventType);
    }

    // ---- helpers ----

    private static AddCostEntryCommand MakeCommand(
        Guid? farmId = null,
        Guid? createdByUserId = null,
        string? category = null,
        decimal? amount = null,
        Guid? costEntryId = null)
        => new(
            FarmId: farmId ?? FarmGuid,
            PlotId: null,
            CropCycleId: null,
            Category: category ?? "seed",
            Description: "test",
            Amount: amount ?? 100m,
            CurrencyCode: "INR",
            EntryDate: new DateOnly(2026, 4, 30),
            CreatedByUserId: createdByUserId ?? CreatorUserId,
            Location: null,
            CostEntryId: costEntryId,
            ActorRole: "operator",
            ClientCommandId: $"req-{Guid.NewGuid():N}");

    private static Farm MakeFarm() =>
        Farm.Create(new FarmId(FarmGuid), "Patil Farm",
            new UserId(CreatorUserId), new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private static (
        IHandler<AddCostEntryCommand, AddCostEntryResultDto> Pipeline,
        InMemoryShramSafalRepository Repo,
        CapturingAnalyticsWriter Analytics) BuildPipeline(bool seedAll)
    {
        var repo = new InMemoryShramSafalRepository();

        if (seedAll)
        {
            repo.AddFarm(MakeFarm());
            repo.SetMembership(FarmGuid, CreatorUserId, AppRole.Worker);
        }

        var (pipeline, analytics) = BuildPipelineFor(repo);
        return (pipeline, repo, analytics);
    }

    private static (
        IHandler<AddCostEntryCommand, AddCostEntryResultDto> Pipeline,
        CapturingAnalyticsWriter Analytics) BuildPipelineFor(InMemoryShramSafalRepository repo)
    {
        var clock = new AddCostEntryFixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new CapturingAnalyticsWriter();

        var rawHandler = new AddCostEntryHandler(
            repo,
            new AddCostEntryFixedIdGenerator(Guid.Parse("88888888-8888-8888-8888-888888888888")),
            clock,
            new AllowAllEntitlementPolicy(),
            analytics);

        var validator = new AddCostEntryValidator();
        var authorizer = new AddCostEntryAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<AddCostEntryCommand, AddCostEntryResultDto>(
                NullLogger<LoggingBehavior<AddCostEntryCommand, AddCostEntryResultDto>>.Instance),
            new ValidationBehavior<AddCostEntryCommand, AddCostEntryResultDto>(
                new IValidator<AddCostEntryCommand>[] { validator }),
            new AuthorizationBehavior<AddCostEntryCommand, AddCostEntryResultDto>(
                new IAuthorizationCheck<AddCostEntryCommand>[] { authorizer }));

        return (pipeline, analytics);
    }

    private sealed class AddCostEntryFixedClock : IClock
    {
        public AddCostEntryFixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class AddCostEntryFixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public AddCostEntryFixedIdGenerator(Guid id) { _id = id; }
        public Guid New() => _id;
    }

    private sealed class CapturingAnalyticsWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            Events.Add(e);
            return Task.CompletedTask;
        }
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default)
        {
            Events.AddRange(events);
            return Task.CompletedTask;
        }
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
