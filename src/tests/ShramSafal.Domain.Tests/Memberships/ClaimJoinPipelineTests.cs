using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (ClaimJoin): end-to-end coverage of the
/// claim-join pipeline. Unlike <c>IssueFarmInvite</c>/<c>RotateFarmInvite</c>
/// this is a validation-only pipeline — the token itself is the
/// authorization artifact, so there is no <c>IAuthorizationCheck</c>
/// wired and the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// is a no-op pass-through.
///
/// <para>
/// Verifies that:
/// <list type="number">
/// <item>The validator surfaces each of the three caller-shape failures
/// (unauthenticated / phone-not-verified / invalid-payload) with the
/// matching <see cref="ErrorKind"/> and verbatim <c>join.*</c> code.</item>
/// <item>The pipeline short-circuits at the validator and never invokes
/// the inner handler body — proven by zero analytics events.</item>
/// <item>The happy path still invokes the inner body and emits an
/// <c>InvitationClaimed</c> analytics event.</item>
/// </list>
/// </para>
/// </summary>
public sealed class ClaimJoinPipelineTests
{
    private static readonly UserId Caller = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly Guid OwnerUserId = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private const string FarmCode = "PATIL1";
    private const string RawToken = "test-raw-token-value";

    // ---- Validator ----

    [Fact]
    public void Validator_yields_JoinUnauthenticated_when_CallerUserId_is_empty()
    {
        var validator = new ClaimJoinValidator();
        var errors = validator.Validate(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: new UserId(Guid.Empty),
            PhoneVerified: true)).ToList();
        Assert.Single(errors);
        Assert.Equal(ShramSafalErrors.JoinUnauthenticated, errors[0]);
        Assert.Equal(ErrorKind.Unauthenticated, errors[0].Kind);
    }

    [Fact]
    public void Validator_yields_JoinPhoneNotVerified_when_phone_unverified()
    {
        var validator = new ClaimJoinValidator();
        var errors = validator.Validate(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: Caller,
            PhoneVerified: false)).ToList();
        Assert.Single(errors);
        Assert.Equal(ShramSafalErrors.JoinPhoneNotVerified, errors[0]);
        Assert.Equal(ErrorKind.Forbidden, errors[0].Kind);
    }

    [Theory]
    [InlineData("", FarmCode)]
    [InlineData("   ", FarmCode)]
    [InlineData(RawToken, "")]
    [InlineData(RawToken, "   ")]
    public void Validator_yields_JoinInvalidPayload_when_token_or_farmcode_is_missing(string token, string farmCode)
    {
        var validator = new ClaimJoinValidator();
        var errors = validator.Validate(new ClaimJoinCommand(
            Token: token,
            FarmCode: farmCode,
            CallerUserId: Caller,
            PhoneVerified: true)).ToList();
        Assert.Single(errors);
        Assert.Equal(ShramSafalErrors.JoinInvalidPayload, errors[0]);
        Assert.Equal(ErrorKind.Validation, errors[0].Kind);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_caller_shape_invariants_pass()
    {
        var validator = new ClaimJoinValidator();
        var errors = validator.Validate(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: Caller,
            PhoneVerified: true)).ToList();
        Assert.Empty(errors);
    }

    [Fact]
    public void Validator_yields_only_first_failure_per_call()
    {
        // Both gates fail (empty caller AND empty payload) — only the
        // most-significant (Unauthenticated) fires; this preserves the
        // endpoint's code-string switch from picking the wrong status.
        var validator = new ClaimJoinValidator();
        var errors = validator.Validate(new ClaimJoinCommand(
            Token: "",
            FarmCode: "",
            CallerUserId: new UserId(Guid.Empty),
            PhoneVerified: false)).ToList();
        Assert.Single(errors);
        Assert.Equal(ShramSafalErrors.JoinUnauthenticated, errors[0]);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_caller_unauthenticated()
    {
        var (pipeline, analytics) = BuildPipeline();

        var result = await pipeline.HandleAsync(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: new UserId(Guid.Empty),
            PhoneVerified: true));

        Assert.False(result.IsSuccess);
        // ValidationBehavior aggregates errors — Code + Kind survive
        // verbatim; we assert on the stable identity, not the joined
        // description (which gets a "code: " prefix).
        Assert.Equal(ShramSafalErrors.JoinUnauthenticated.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Unauthenticated, result.Error.Kind);
        // Inner handler emits an analytics event on the success path —
        // its absence proves the pipeline short-circuited before the
        // handler body ran.
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_phone_not_verified()
    {
        var (pipeline, analytics) = BuildPipeline();

        var result = await pipeline.HandleAsync(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: Caller,
            PhoneVerified: false));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JoinPhoneNotVerified.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_payload_is_blank()
    {
        var (pipeline, analytics) = BuildPipeline();

        var result = await pipeline.HandleAsync(new ClaimJoinCommand(
            Token: "",
            FarmCode: "",
            CallerUserId: Caller,
            PhoneVerified: true));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JoinInvalidPayload.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_and_emits_analytics_on_happy_path()
    {
        var (pipeline, analytics) = BuildPipeline(seedFarmAndToken: true);

        var result = await pipeline.HandleAsync(new ClaimJoinCommand(
            Token: RawToken,
            FarmCode: FarmCode,
            CallerUserId: Caller,
            PhoneVerified: true));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.WasAlreadyMember);
        // The inner handler emits a single InvitationClaimed event on
        // success — its presence proves the pipeline forwarded the call
        // to the handler body.
        Assert.Single(analytics.Events);
        Assert.Equal(
            AgriSync.BuildingBlocks.Analytics.AnalyticsEventType.InvitationClaimed,
            analytics.Events[0].EventType);
    }

    // ---- helpers ----

    private static (
        IHandler<ClaimJoinCommand, ClaimJoinResult> Pipeline,
        CapturingAnalyticsWriter Analytics) BuildPipeline(bool seedFarmAndToken = false)
    {
        var farmRepo = new StubShramSafalRepository();
        var invRepo = new StubFarmInvitationRepository();
        var now = new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc);

        if (seedFarmAndToken)
        {
            var farm = Farm.Create(FarmGuid, "Patil Farm", OwnerUserId, now);
            farm.AssignFarmCode(FarmCode, now);
            farmRepo.SeedFarm(farm);

            var invitation = FarmInvitation.Issue(
                FarmInvitationId.New(),
                new FarmId(FarmGuid),
                new UserId(OwnerUserId),
                now);
            var token = FarmJoinToken.Issue(
                FarmJoinTokenId.New(),
                invitation.Id,
                new FarmId(FarmGuid),
                RawToken,
                ComputeTokenHash(RawToken),
                now);
            invRepo.SeedToken(token, invitation);
        }

        var analytics = new CapturingAnalyticsWriter();
        var rawHandler = new ClaimJoinHandler(
            invRepo,
            farmRepo,
            new SequentialIdGenerator(Guid.Parse("44444444-4444-4444-4444-444444444444")),
            new FixedClock(now),
            NullLogger<ClaimJoinHandler>.Instance,
            analytics);

        var validator = new ClaimJoinValidator();

        // No IAuthorizationCheck<ClaimJoinCommand> registrations — the
        // token is the authorization artifact. AuthorizationBehavior is
        // still in the chain as a no-op decorator (zero checks ⇒ pass-
        // through) so the pipeline shape matches the other rolled-out
        // handlers and any future ClaimJoinAuthorizer plugs straight in.
        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<ClaimJoinCommand, ClaimJoinResult>(
                NullLogger<LoggingBehavior<ClaimJoinCommand, ClaimJoinResult>>.Instance),
            new ValidationBehavior<ClaimJoinCommand, ClaimJoinResult>(
                new IValidator<ClaimJoinCommand>[] { validator }),
            new AuthorizationBehavior<ClaimJoinCommand, ClaimJoinResult>(
                Array.Empty<IAuthorizationCheck<ClaimJoinCommand>>()));

        return (pipeline, analytics);
    }

    private static string ComputeTokenHash(string rawToken)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(rawToken), hash);
        var sb = new StringBuilder(64);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
