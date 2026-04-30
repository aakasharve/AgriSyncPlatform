using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// Sub-plan 03 Task 8: end-to-end coverage of the IssueFarmInvite
/// pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs as InvalidCommand.</item>
/// <item>The authorizer translates IAuthorizationEnforcer throws into
/// a Forbidden Result.Failure.</item>
/// <item>The pipeline-wrapped IHandler short-circuits at the right
/// stage and only invokes the inner handler when both layers pass.</item>
/// </list>
/// </summary>
public sealed class IssueFarmInvitePipelineTests
{
    private static readonly UserId Caller = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly FarmId Farm = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var validator = new IssueFarmInviteValidator();
        var errors = validator.Validate(new IssueFarmInviteCommand(new FarmId(Guid.Empty), Caller)).ToList();
        Assert.Single(errors);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errors[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var validator = new IssueFarmInviteValidator();
        var errors = validator.Validate(new IssueFarmInviteCommand(Farm, new UserId(Guid.Empty))).ToList();
        Assert.Single(errors);
    }

    [Fact]
    public void Validator_yields_no_errors_when_both_ids_are_present()
    {
        var validator = new IssueFarmInviteValidator();
        var errors = validator.Validate(new IssueFarmInviteCommand(Farm, Caller)).ToList();
        Assert.Empty(errors);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_Success_when_enforcer_does_not_throw()
    {
        var authorizer = new IssueFarmInviteAuthorizer(new AllowAllAuthorizationEnforcer());
        var result = await authorizer.AuthorizeAsync(new IssueFarmInviteCommand(Farm, Caller), default);
        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_enforcer_throws_Unauthorized()
    {
        var authorizer = new IssueFarmInviteAuthorizer(new RejectingEnforcer());
        var result = await authorizer.AuthorizeAsync(new IssueFarmInviteCommand(Farm, Caller), default);
        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_command_is_invalid()
    {
        var (pipeline, _, analytics) = BuildPipeline(allowAuthz: true);

        var result = await pipeline.HandleAsync(
            new IssueFarmInviteCommand(new FarmId(Guid.Empty), new UserId(Guid.Empty)));

        Assert.False(result.IsSuccess);
        // ValidationBehavior aggregates errors — the Code + Kind survive
        // verbatim from the validator's first emitted Error; the
        // Description gets a "Code: " prefix when joined. We assert on
        // the stable identity (Code, Kind), not the joined description.
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Inner handler emits an analytics event on success — its absence
        // proves the pipeline short-circuited before the handler body ran.
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_when_caller_is_not_owner()
    {
        var (pipeline, _, analytics) = BuildPipeline(allowAuthz: false);

        var result = await pipeline.HandleAsync(new IssueFarmInviteCommand(Farm, Caller));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_when_both_layers_pass()
    {
        var (pipeline, _, analytics) = BuildPipeline(allowAuthz: true, seedFarm: true);

        var result = await pipeline.HandleAsync(new IssueFarmInviteCommand(Farm, Caller));

        Assert.True(result.IsSuccess);
        // The handler emits a single InvitationIssued event on the success
        // path — its presence proves the inner handler body executed.
        Assert.Single(analytics.Events);
    }

    // ---- helpers ----

    private static (
        IHandler<IssueFarmInviteCommand, IssueFarmInviteResult> Pipeline,
        StubShramSafalRepository FarmRepo,
        CapturingAnalyticsWriter Analytics) BuildPipeline(bool allowAuthz, bool seedFarm = false)
    {
        var farmRepo = new StubShramSafalRepository();
        if (seedFarm)
        {
            // Qualify the type — the FarmId-named field above shadows the
            // Farm aggregate type in this scope.
            var farm = ShramSafal.Domain.Farms.Farm.Create(
                Farm.Value, "Patil Farm", Caller.Value, DateTime.UtcNow);
            farmRepo.SeedFarm(farm);
        }
        var invRepo = new StubFarmInvitationRepository();
        var clock = new FixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new CapturingAnalyticsWriter();

        var rawHandler = new IssueFarmInviteHandler(invRepo, farmRepo, clock, analytics);

        var validator = new IssueFarmInviteValidator();
        var authorizer = new IssueFarmInviteAuthorizer(
            allowAuthz ? new AllowAllAuthorizationEnforcer() : new RejectingEnforcer());

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                NullLogger<LoggingBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>>.Instance),
            new ValidationBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                new IValidator<IssueFarmInviteCommand>[] { validator }),
            new AuthorizationBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                new IAuthorizationCheck<IssueFarmInviteCommand>[] { authorizer }));

        return (pipeline, farmRepo, analytics);
    }

    private sealed class RejectingEnforcer : IAuthorizationEnforcer
    {
        public Task EnsureIsFarmMember(UserId userId, FarmId farmId)
            => throw new UnauthorizedAccessException("not a member");
        public Task EnsureIsOwner(UserId userId, FarmId farmId)
            => throw new UnauthorizedAccessException("not an owner");
        public Task EnsureCanVerify(UserId userId, Guid logId)
            => throw new UnauthorizedAccessException();
        public Task EnsureCanEditLog(UserId userId, Guid logId)
            => throw new UnauthorizedAccessException();
    }
}
