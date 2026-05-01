using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): end-to-end coverage of the
/// verify-log pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs / empty explicit
/// VerificationEventId as <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer propagates the typed Forbidden / NotFound /
/// Validation failure returned by
/// <see cref="IAuthorizationEnforcer.EnsureCanVerify"/>.</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer, leaving the inner handler body un-invoked (no analytics
/// event, no audit row).</item>
/// <item>The happy path exercises the full body: the analytics writer
/// captures one <c>LogVerified</c> event AND the audit log records one
/// <c>VerificationChanged</c> entry. Together those prove the body
/// reached past the auto-verify-job-card hook without throwing —
/// <c>analytics.EmitAsync</c> is the line immediately after the hook,
/// so its observation rules out an exception inside the hook. We do
/// not directly assert on a JobCard side-effect because no JobCard is
/// linked in this test; the dedicated <c>OnLogVerifiedAutoVerifyJobCard</c>
/// tests cover the linked-card paths.</item>
/// </list>
/// </summary>
public sealed class VerifyLogPipelineTests
{
    private static readonly Guid VerifierUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OperatorUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid FarmGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid LogGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_DailyLogId_is_empty()
    {
        var v = new VerifyLogValidator();
        var errs = v.Validate(new VerifyLogCommand(
            DailyLogId: Guid.Empty,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_VerifiedByUserId_is_empty()
    {
        var v = new VerifyLogValidator();
        var errs = v.Validate(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_explicit_VerificationEventId_is_empty()
    {
        var v = new VerifyLogValidator();
        var errs = v.Validate(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId,
            VerificationEventId: Guid.Empty)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_accepts_null_VerificationEventId_handler_will_generate_one()
    {
        var v = new VerifyLogValidator();
        var errs = v.Validate(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId,
            VerificationEventId: null)).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_ids_are_present()
    {
        var v = new VerifyLogValidator();
        var errs = v.Validate(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId,
            VerificationEventId: Guid.Parse("99999999-9999-9999-9999-999999999999"))).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_Success_when_enforcer_allows()
    {
        var a = new VerifyLogAuthorizer(new AllowAllVerifyEnforcer());
        var result = await a.AuthorizeAsync(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId), default);
        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_enforcer_rejects()
    {
        var a = new VerifyLogAuthorizer(new RejectingVerifyEnforcer());
        var result = await a.AuthorizeAsync(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId), default);
        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_DailyLogId_is_empty()
    {
        var (pipeline, repo, analytics) = BuildPipeline(allowAuthz: true);

        var result = await pipeline.HandleAsync(new VerifyLogCommand(
            DailyLogId: Guid.Empty,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Inner handler emits an analytics event AND adds an audit row
        // on the success path — their absence proves the pipeline short-
        // circuited before the body executed.
        Assert.Empty(analytics.Events);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_when_caller_is_not_owner()
    {
        var (pipeline, repo, analytics) = BuildPipeline(allowAuthz: false);

        var result = await pipeline.HandleAsync(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(analytics.Events);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_and_runs_auto_verify_plus_analytics_on_happy_path()
    {
        var (pipeline, repo, analytics) = BuildPipeline(allowAuthz: true, seedLogAndMembership: true);

        var result = await pipeline.HandleAsync(new VerifyLogCommand(
            DailyLogId: LogGuid,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: VerifierUserId,
            VerificationEventId: null,
            ActorRole: null,
            ClientCommandId: "cmd-pipeline-1"));

        Assert.True(result.IsSuccess);
        // The inner body emits exactly one LogVerified analytics event
        // on the success path — its presence proves the pipeline
        // forwarded the call to the handler body. Because
        // analytics.EmitAsync is the line immediately AFTER
        // autoVerifyJobCard.HandleAsync, observing the event also rules
        // out an exception thrown inside the auto-verify hook (which
        // would have propagated and failed the test). We do not assert
        // on a JobCard side-effect here — no JobCard is linked in this
        // test setup, and the linked-card paths have dedicated coverage
        // in OnLogVerifiedAutoVerifyJobCardTests.
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.LogVerified, analytics.Events[0].EventType);
        // Audit row is added by the body before SaveChangesAsync.
        Assert.Single(repo.AuditEvents);
        Assert.Equal("VerificationChanged", repo.AuditEvents[0].Action);
    }

    // ---- helpers ----

    private static (
        IHandler<VerifyLogCommand, DailyLogDto> Pipeline,
        InMemoryShramSafalRepository Repo,
        CapturingAnalyticsWriter Analytics) BuildPipeline(
            bool allowAuthz, bool seedLogAndMembership = false)
    {
        var repo = new InMemoryShramSafalRepository();

        if (seedLogAndMembership)
        {
            // Seed a log in Confirmed state so a PrimaryOwner can flip
            // it to Verified through the state machine.
            var farmId = new FarmId(FarmGuid);
            var log = DailyLog.Create(
                id: LogGuid,
                farmId: farmId,
                plotId: Guid.NewGuid(),
                cropCycleId: Guid.NewGuid(),
                operatorUserId: new UserId(OperatorUserId),
                logDate: new DateOnly(2026, 4, 28),
                idempotencyKey: null,
                location: null,
                createdAtUtc: new DateTime(2026, 4, 28, 10, 0, 0, DateTimeKind.Utc));

            log.Verify(
                verificationEventId: Guid.NewGuid(),
                status: VerificationStatus.Confirmed,
                reason: null,
                callerRole: AppRole.Worker,
                verifiedByUserId: new UserId(OperatorUserId),
                occurredAtUtc: new DateTime(2026, 4, 28, 11, 0, 0, DateTimeKind.Utc));

            repo.AddLog(log);
            repo.SetMembership(FarmGuid, VerifierUserId, AppRole.PrimaryOwner);
        }

        var fixedClock = new VerifyLogFixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var analytics = new CapturingAnalyticsWriter();

        var autoVerify = new OnLogVerifiedAutoVerifyJobCard(
            repo,
            new VerifyJobCardForPayoutHandler(repo, fixedClock),
            fixedClock,
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

        var rawHandler = new VerifyLogHandler(
            repo,
            new VerifyLogFixedIdGenerator(Guid.Parse("88888888-8888-8888-8888-888888888888")),
            fixedClock,
            new AllowAllEntitlementPolicy(),
            analytics,
            autoVerify);

        var validator = new VerifyLogValidator();
        var authorizer = new VerifyLogAuthorizer(
            allowAuthz ? new AllowAllVerifyEnforcer() : new RejectingVerifyEnforcer());

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<VerifyLogCommand, DailyLogDto>(
                NullLogger<LoggingBehavior<VerifyLogCommand, DailyLogDto>>.Instance),
            new ValidationBehavior<VerifyLogCommand, DailyLogDto>(
                new IValidator<VerifyLogCommand>[] { validator }),
            new AuthorizationBehavior<VerifyLogCommand, DailyLogDto>(
                new IAuthorizationCheck<VerifyLogCommand>[] { authorizer }));

        return (pipeline, repo, analytics);
    }

    // T-IGH-03-AUTHZ-RESULT: enforcer returns Result.

    private sealed class AllowAllVerifyEnforcer : IAuthorizationEnforcer
    {
        public Task<Result> EnsureIsFarmMember(UserId userId, FarmId farmId)
            => Task.FromResult(Result.Success());
        public Task<Result> EnsureIsOwner(UserId userId, FarmId farmId)
            => Task.FromResult(Result.Success());
        public Task<Result> EnsureCanVerify(UserId userId, Guid logId)
            => Task.FromResult(Result.Success());
        public Task<Result> EnsureCanEditLog(UserId userId, Guid logId)
            => Task.FromResult(Result.Success());
    }

    private sealed class RejectingVerifyEnforcer : IAuthorizationEnforcer
    {
        public Task<Result> EnsureIsFarmMember(UserId userId, FarmId farmId)
            => Task.FromResult(Result.Failure(ShramSafalErrors.Forbidden));
        public Task<Result> EnsureIsOwner(UserId userId, FarmId farmId)
            => Task.FromResult(Result.Failure(ShramSafalErrors.Forbidden));
        public Task<Result> EnsureCanVerify(UserId userId, Guid logId)
            => Task.FromResult(Result.Failure(ShramSafalErrors.Forbidden));
        public Task<Result> EnsureCanEditLog(UserId userId, Guid logId)
            => Task.FromResult(Result.Failure(ShramSafalErrors.Forbidden));
    }

    private sealed class VerifyLogFixedClock : IClock
    {
        public VerifyLogFixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class VerifyLogFixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public VerifyLogFixedIdGenerator(Guid id) { _id = id; }
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
