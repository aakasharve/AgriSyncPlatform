using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Work.CompleteJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): end-to-end coverage of
/// the complete-job-card pipeline. Verifies that:
/// <list type="number">
/// <item>The validator surfaces empty IDs as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.</item>
/// <item>The authorizer surfaces
/// <see cref="ShramSafalErrors.JobCardNotFound"/> when the job-card id
/// resolves to nothing, and <see cref="ShramSafalErrors.Forbidden"/>
/// when the caller is not a member of the job card's farm.</item>
/// <item>The pipeline short-circuits at the validator and at the
/// authorizer, leaving the inner handler body un-invoked (no audit row
/// written, job-card status unchanged).</item>
/// <item>The happy path runs the body: status flips to Completed, the
/// link to the daily log is recorded, and an audit row is emitted.</item>
/// </list>
/// </summary>
public sealed class CompleteJobCardPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId Worker = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId Mukadam = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId Stranger = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_JobCardId_is_empty()
    {
        var v = new CompleteJobCardValidator();
        var errs = v.Validate(new CompleteJobCardCommand(
            JobCardId: Guid.Empty,
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_DailyLogId_is_empty()
    {
        var v = new CompleteJobCardValidator();
        var errs = v.Validate(new CompleteJobCardCommand(
            JobCardId: Guid.NewGuid(),
            DailyLogId: Guid.Empty,
            CallerUserId: Worker,
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CallerUserId_is_empty()
    {
        var v = new CompleteJobCardValidator();
        var errs = v.Validate(new CompleteJobCardCommand(
            JobCardId: Guid.NewGuid(),
            DailyLogId: Guid.NewGuid(),
            CallerUserId: new UserId(Guid.Empty),
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_all_ids_are_present()
    {
        var v = new CompleteJobCardValidator();
        var errs = v.Validate(new CompleteJobCardCommand(
            JobCardId: Guid.NewGuid(),
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: "cmd-1")).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_JobCardNotFound_when_jobcard_id_resolves_to_nothing()
    {
        var repo = new InMemoryJobCardRepo();
        // No job card seeded.
        var a = new CompleteJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CompleteJobCardCommand(
            JobCardId: Guid.NewGuid(),
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member_of_the_jobcards_farm()
    {
        var job = BuildInProgressJobCard();
        var repo = new InMemoryJobCardRepo();
        repo.SeedJobCard(job);
        // Stranger is not a member.
        var a = new CompleteJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Stranger,
            ClientCommandId: null), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_a_member_of_the_jobcards_farm()
    {
        var job = BuildInProgressJobCard();
        var repo = new InMemoryJobCardRepo();
        repo.SeedJobCard(job);
        repo.SetMembership(Farm.Value, Worker.Value);
        var a = new CompleteJobCardAuthorizer(repo);

        var result = await a.AuthorizeAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_JobCardId_is_empty()
    {
        var (pipeline, repo, _) = BuildPipeline();

        var result = await pipeline.HandleAsync(new CompleteJobCardCommand(
            JobCardId: Guid.Empty,
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        // Body emits an audit row on success — its absence proves the
        // pipeline short-circuited before the handler ran.
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_JobCardNotFound_when_jobcard_is_missing()
    {
        var (pipeline, repo, _) = BuildPipeline();
        // No job card seeded.

        var result = await pipeline.HandleAsync(new CompleteJobCardCommand(
            JobCardId: Guid.NewGuid(),
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.JobCardNotFound, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden_when_caller_is_not_a_member()
    {
        var job = BuildInProgressJobCard();
        var (pipeline, repo, _) = BuildPipeline(job);
        // No membership set.

        var result = await pipeline.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: Guid.NewGuid(),
            CallerUserId: Stranger,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var job = BuildInProgressJobCard();
        var validLog = BuildDailyLog(Farm, PlotGuid, "spray");
        var (pipeline, repo, _) = BuildPipeline(job, validLog);
        repo.SetMembership(Farm.Value, Worker.Value);

        var result = await pipeline.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: validLog.Id,
            CallerUserId: Worker,
            ClientCommandId: "complete-pipeline-1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(JobCardStatus.Completed, job.Status);
        Assert.Equal(validLog.Id, job.LinkedDailyLogId);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("jobcard.completed", repo.AuditEvents[0].Action);
    }

    [Fact]
    public async Task Pipeline_propagates_JobCardDailyLogMismatch_from_body()
    {
        // Validator passes, authorizer passes (caller is a member), but
        // the body's farm/plot match check fires.
        var job = BuildInProgressJobCard();
        var otherFarm = new FarmId(Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"));
        var mismatchLog = BuildDailyLog(otherFarm, PlotGuid, "spray");
        var (pipeline, repo, _) = BuildPipeline(job, mismatchLog);
        repo.SetMembership(Farm.Value, Worker.Value);

        var result = await pipeline.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: mismatchLog.Id,
            CallerUserId: Worker,
            ClientCommandId: null));

        Assert.False(result.IsSuccess);
        Assert.Contains("JobCardDailyLogMismatch", result.Error.Code);
        // Body returned BEFORE writing the audit row.
        Assert.Empty(repo.AuditEvents);
    }

    // ---- helpers ----

    private static JobCard BuildInProgressJobCard()
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
        return job;
    }

    private static DailyLog BuildDailyLog(FarmId farmId, Guid plotId, string activityType)
    {
        var log = DailyLog.Create(
            Guid.NewGuid(),
            farmId,
            plotId,
            Guid.NewGuid(),
            Worker,
            new DateOnly(2026, 4, 21),
            null, null,
            Now);
        log.AddTask(Guid.NewGuid(), activityType, null, Now);
        return log;
    }

    private static (
        IHandler<CompleteJobCardCommand, CompleteJobCardResult> Pipeline,
        InMemoryJobCardRepo Repo,
        FixedClock Clock) BuildPipeline(JobCard? jobCard = null, DailyLog? dailyLog = null)
    {
        var repo = new InMemoryJobCardRepo();
        if (jobCard is not null) repo.SeedJobCard(jobCard);
        if (dailyLog is not null) repo.SeedLog(dailyLog);

        var clock = new FixedClock(Now.AddHours(4));
        var rawHandler = new CompleteJobCardHandler(repo, clock);

        var validator = new CompleteJobCardValidator();
        var authorizer = new CompleteJobCardAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CompleteJobCardCommand, CompleteJobCardResult>(
                NullLogger<LoggingBehavior<CompleteJobCardCommand, CompleteJobCardResult>>.Instance),
            new ValidationBehavior<CompleteJobCardCommand, CompleteJobCardResult>(
                new IValidator<CompleteJobCardCommand>[] { validator }),
            new AuthorizationBehavior<CompleteJobCardCommand, CompleteJobCardResult>(
                new IAuthorizationCheck<CompleteJobCardCommand>[] { authorizer }));

        return (pipeline, repo, clock);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Minimal in-memory repository covering only the methods that
    /// <see cref="CompleteJobCardHandler"/> + <see cref="CompleteJobCardAuthorizer"/>
    /// touch on the happy path. Inherits the broad
    /// <see cref="StubShramSafalRepository"/> default-throw stubs so any
    /// codepath we add downstream surfaces loudly.
    /// </summary>
    private sealed class InMemoryJobCardRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, JobCard> _jobCards = new();
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _memberships = new();

        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedJobCard(JobCard jc) => _jobCards[jc.Id] = jc;
        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SetMembership(Guid farmId, Guid userId) => _memberships.Add((farmId, userId));

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(_jobCards.TryGetValue(jobCardId, out var jc) ? jc : null);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var l) ? l : null);

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
