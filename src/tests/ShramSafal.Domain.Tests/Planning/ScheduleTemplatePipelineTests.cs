using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (ScheduleTemplate.{Clone,Edit,Publish}):
/// end-to-end coverage of all three pipelines. Verifies the canonical
/// ordering <c>InvalidCommand → ScheduleTemplateNotFound → Forbidden →
/// (body)</c> and that short-circuits skip body work (no audit / no
/// added template).
/// </summary>
public sealed class ScheduleTemplatePipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid AuthorId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    // ====================================================================
    // CloneScheduleTemplate
    // ====================================================================

    [Fact]
    public void CloneValidator_yields_InvalidCommand_when_SourceTemplateId_is_empty()
    {
        var v = new CloneScheduleTemplateValidator();
        var errs = v.Validate(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.Empty,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "test",
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void CloneValidator_yields_InvalidCommand_when_Reason_is_blank()
    {
        var v = new CloneScheduleTemplateValidator();
        var errs = v.Validate(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "   ",
            ClientCommandId: null)).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void CloneValidator_yields_no_errors_on_well_formed_command()
    {
        var v = new CloneScheduleTemplateValidator();
        var errs = v.Validate(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "fork for org X",
            ClientCommandId: null)).ToList();
        Assert.Empty(errs);
    }

    [Fact]
    public async Task CloneAuthorizer_returns_ScheduleTemplateNotFound_when_source_missing()
    {
        var repo = new InMemoryScheduleTemplateRepo();
        var a = new CloneScheduleTemplateAuthorizer(repo);

        var r = await a.AuthorizeAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "x",
            ClientCommandId: null), default);

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateNotFound, r.Error);
        Assert.Equal(ErrorKind.NotFound, r.Error.Kind);
    }

    [Fact]
    public async Task CloneAuthorizer_returns_Forbidden_when_role_cannot_write_target_scope()
    {
        var template = MakeTemplate(AuthorId, TenantScope.Private);
        var repo = new InMemoryScheduleTemplateRepo();
        repo.Seed(template);
        var a = new CloneScheduleTemplateAuthorizer(repo);

        // Cloning to Licensed scope requires PrimaryOwner/SecondaryOwner/
        // Agronomist/Consultant. Worker is not allowed.
        var r = await a.AuthorizeAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: template.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.Worker,
            NewScope: TenantScope.Licensed,
            Reason: "x",
            ClientCommandId: null), default);

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, r.Error);
        Assert.Equal(ErrorKind.Forbidden, r.Error.Kind);
    }

    [Fact]
    public async Task ClonePipeline_short_circuits_at_validator_with_InvalidCommand()
    {
        var (pipeline, repo) = BuildClonePipeline();

        var r = await pipeline.HandleAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.Empty,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "x",
            ClientCommandId: null));

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, r.Error.Code);
        Assert.Empty(repo.AuditEvents);
        Assert.Empty(repo.AddedTemplates);
    }

    [Fact]
    public async Task ClonePipeline_short_circuits_at_authorizer_with_NotFound_then_Forbidden()
    {
        // 1) NotFound: no template seeded.
        var (pipeline1, repo1) = BuildClonePipeline();
        var r1 = await pipeline1.HandleAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "x",
            ClientCommandId: null));
        Assert.False(r1.IsSuccess);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateNotFound, r1.Error);
        Assert.Empty(repo1.AddedTemplates);

        // 2) Forbidden: template seeded, Worker can't write Licensed.
        var template = MakeTemplate(AuthorId, TenantScope.Private);
        var (pipeline2, repo2) = BuildClonePipeline(template);
        var r2 = await pipeline2.HandleAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: template.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.Worker,
            NewScope: TenantScope.Licensed,
            Reason: "x",
            ClientCommandId: null));
        Assert.False(r2.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, r2.Error);
        Assert.Empty(repo2.AddedTemplates);
    }

    [Fact]
    public async Task ClonePipeline_invokes_body_on_happy_path()
    {
        var template = MakeTemplate(AuthorId, TenantScope.Private);
        var (pipeline, repo) = BuildClonePipeline(template);

        var r = await pipeline.HandleAsync(new CloneScheduleTemplateCommand(
            SourceTemplateId: template.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewScope: TenantScope.Private,
            Reason: "fork-for-test",
            ClientCommandId: null));

        Assert.True(r.IsSuccess);
        Assert.Single(repo.AddedTemplates);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("schedule.cloned", repo.AuditEvents[0].Action);
    }

    // ====================================================================
    // EditScheduleTemplate
    // ====================================================================

    [Fact]
    public void EditValidator_yields_InvalidCommand_when_any_id_empty()
    {
        var v = new EditScheduleTemplateValidator();
        Assert.Single(v.Validate(new EditScheduleTemplateCommand(
            SourceTemplateId: Guid.Empty,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: "n",
            NewStage: "s",
            ClientCommandId: null)).ToList());

        Assert.Single(v.Validate(new EditScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.Empty,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: "n",
            NewStage: "s",
            ClientCommandId: null)).ToList());
    }

    [Fact]
    public async Task EditAuthorizer_NotFound_then_Private_non_author_Forbidden_then_NonPrivate_role_gate()
    {
        // NotFound
        var repo = new InMemoryScheduleTemplateRepo();
        var a = new EditScheduleTemplateAuthorizer(repo);
        var r1 = await a.AuthorizeAsync(new EditScheduleTemplateCommand(
            SourceTemplateId: Guid.NewGuid(),
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: null, NewStage: null, ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateNotFound, r1.Error);

        // Private + non-author => Forbidden
        var privateTpl = MakeTemplate(AuthorId, TenantScope.Private);
        repo.Seed(privateTpl);
        var r2 = await a.AuthorizeAsync(new EditScheduleTemplateCommand(
            SourceTemplateId: privateTpl.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: OtherId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: null, NewStage: null, ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.Forbidden, r2.Error);

        // Non-Private + role gate fails => Forbidden
        var licensedTpl = MakeTemplate(AuthorId, TenantScope.Licensed);
        repo.Seed(licensedTpl);
        var r3 = await a.AuthorizeAsync(new EditScheduleTemplateCommand(
            SourceTemplateId: licensedTpl.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: OtherId,
            CallerRole: AppRole.Worker,
            NewName: null, NewStage: null, ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.Forbidden, r3.Error);

        // Non-Private + role gate passes => Success
        var r4 = await a.AuthorizeAsync(new EditScheduleTemplateCommand(
            SourceTemplateId: licensedTpl.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: OtherId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: null, NewStage: null, ClientCommandId: null), default);
        Assert.True(r4.IsSuccess);
    }

    [Fact]
    public async Task EditPipeline_invokes_body_on_happy_path_for_Private_author()
    {
        var template = MakeTemplate(AuthorId, TenantScope.Private);
        var (pipeline, repo) = BuildEditPipeline(template);

        var r = await pipeline.HandleAsync(new EditScheduleTemplateCommand(
            SourceTemplateId: template.Id,
            NewTemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            NewName: "Updated",
            NewStage: null,
            ClientCommandId: null));

        Assert.True(r.IsSuccess);
        Assert.Single(repo.AddedTemplates);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("schedule.edited", repo.AuditEvents[0].Action);
    }

    // ====================================================================
    // PublishScheduleTemplate
    // ====================================================================

    [Fact]
    public void PublishValidator_yields_InvalidCommand_when_TemplateId_or_CallerUserId_empty()
    {
        var v = new PublishScheduleTemplateValidator();
        Assert.Single(v.Validate(new PublishScheduleTemplateCommand(
            TemplateId: Guid.Empty,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null)).ToList());

        Assert.Single(v.Validate(new PublishScheduleTemplateCommand(
            TemplateId: Guid.NewGuid(),
            CallerUserId: Guid.Empty,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null)).ToList());
    }

    [Fact]
    public async Task PublishAuthorizer_NotFound_then_NonAuthor_then_role_gate()
    {
        var repo = new InMemoryScheduleTemplateRepo();
        var a = new PublishScheduleTemplateAuthorizer(repo);

        // NotFound
        var r1 = await a.AuthorizeAsync(new PublishScheduleTemplateCommand(
            TemplateId: Guid.NewGuid(),
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateNotFound, r1.Error);

        // Non-author => Forbidden
        var template = MakeTemplate(AuthorId, TenantScope.Licensed);
        repo.Seed(template);
        var r2 = await a.AuthorizeAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: OtherId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.Forbidden, r2.Error);

        // Author with insufficient role for Licensed => Forbidden
        var r3 = await a.AuthorizeAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: AuthorId,
            CallerRole: AppRole.Worker,
            ClientCommandId: null), default);
        Assert.Equal(ShramSafalErrors.Forbidden, r3.Error);

        // Author with sufficient role => Success
        var r4 = await a.AuthorizeAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null), default);
        Assert.True(r4.IsSuccess);
    }

    [Fact]
    public async Task PublishPipeline_short_circuits_at_validator_when_TemplateId_empty()
    {
        var (pipeline, repo) = BuildPublishPipeline();

        var r = await pipeline.HandleAsync(new PublishScheduleTemplateCommand(
            TemplateId: Guid.Empty,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null));

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, r.Error.Code);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task PublishPipeline_invokes_body_on_happy_path()
    {
        var template = MakeTemplate(AuthorId, TenantScope.Licensed);
        var (pipeline, repo) = BuildPublishPipeline(template);

        var r = await pipeline.HandleAsync(new PublishScheduleTemplateCommand(
            TemplateId: template.Id,
            CallerUserId: AuthorId,
            CallerRole: AppRole.PrimaryOwner,
            ClientCommandId: null));

        Assert.True(r.IsSuccess);
        Assert.NotNull(template.PublishedAtUtc);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("schedule.published", repo.AuditEvents[0].Action);
    }

    // ====================================================================
    // helpers
    // ====================================================================

    private static ScheduleTemplate MakeTemplate(Guid authorId, TenantScope scope)
    {
        return ScheduleTemplate.Create(
            Guid.NewGuid(),
            "Grape May",
            "Flowering",
            Now.AddDays(-10),
            createdByUserId: new UserId(authorId),
            tenantScope: scope);
    }

    private static (
        IHandler<CloneScheduleTemplateCommand, CloneScheduleTemplateResult> Pipeline,
        InMemoryScheduleTemplateRepo Repo) BuildClonePipeline(ScheduleTemplate? seeded = null)
    {
        var repo = new InMemoryScheduleTemplateRepo();
        if (seeded is not null) repo.Seed(seeded);

        var clock = new FixedClock(Now);
        var mutations = new InMemorySyncMutationStore();
        var rawHandler = new CloneScheduleTemplateHandler(repo, mutations, clock);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CloneScheduleTemplateCommand, CloneScheduleTemplateResult>(
                NullLogger<LoggingBehavior<CloneScheduleTemplateCommand, CloneScheduleTemplateResult>>.Instance),
            new ValidationBehavior<CloneScheduleTemplateCommand, CloneScheduleTemplateResult>(
                new IValidator<CloneScheduleTemplateCommand>[] { new CloneScheduleTemplateValidator() }),
            new AuthorizationBehavior<CloneScheduleTemplateCommand, CloneScheduleTemplateResult>(
                new IAuthorizationCheck<CloneScheduleTemplateCommand>[] { new CloneScheduleTemplateAuthorizer(repo) }));
        return (pipeline, repo);
    }

    private static (
        IHandler<EditScheduleTemplateCommand, EditScheduleTemplateResult> Pipeline,
        InMemoryScheduleTemplateRepo Repo) BuildEditPipeline(ScheduleTemplate? seeded = null)
    {
        var repo = new InMemoryScheduleTemplateRepo();
        if (seeded is not null) repo.Seed(seeded);

        var clock = new FixedClock(Now);
        var mutations = new InMemorySyncMutationStore();
        var rawHandler = new EditScheduleTemplateHandler(repo, mutations, clock);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<EditScheduleTemplateCommand, EditScheduleTemplateResult>(
                NullLogger<LoggingBehavior<EditScheduleTemplateCommand, EditScheduleTemplateResult>>.Instance),
            new ValidationBehavior<EditScheduleTemplateCommand, EditScheduleTemplateResult>(
                new IValidator<EditScheduleTemplateCommand>[] { new EditScheduleTemplateValidator() }),
            new AuthorizationBehavior<EditScheduleTemplateCommand, EditScheduleTemplateResult>(
                new IAuthorizationCheck<EditScheduleTemplateCommand>[] { new EditScheduleTemplateAuthorizer(repo) }));
        return (pipeline, repo);
    }

    private static (
        IHandler<PublishScheduleTemplateCommand, PublishScheduleTemplateResult> Pipeline,
        InMemoryScheduleTemplateRepo Repo) BuildPublishPipeline(ScheduleTemplate? seeded = null)
    {
        var repo = new InMemoryScheduleTemplateRepo();
        if (seeded is not null) repo.Seed(seeded);

        var clock = new FixedClock(Now);
        var mutations = new InMemorySyncMutationStore();
        var rawHandler = new PublishScheduleTemplateHandler(repo, mutations, clock);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<PublishScheduleTemplateCommand, PublishScheduleTemplateResult>(
                NullLogger<LoggingBehavior<PublishScheduleTemplateCommand, PublishScheduleTemplateResult>>.Instance),
            new ValidationBehavior<PublishScheduleTemplateCommand, PublishScheduleTemplateResult>(
                new IValidator<PublishScheduleTemplateCommand>[] { new PublishScheduleTemplateValidator() }),
            new AuthorizationBehavior<PublishScheduleTemplateCommand, PublishScheduleTemplateResult>(
                new IAuthorizationCheck<PublishScheduleTemplateCommand>[] { new PublishScheduleTemplateAuthorizer(repo) }));
        return (pipeline, repo);
    }

    private sealed class FixedClock(DateTime utcNow) : AgriSync.BuildingBlocks.Abstractions.IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class InMemorySyncMutationStore : ISyncMutationStore
    {
        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
            => Task.FromResult<StoredSyncMutation?>(null);

        public Task<bool> TryStoreSuccessAsync(string deviceId, string clientRequestId, string mutationType, string responsePayloadJson, DateTime appliedAtUtc, CancellationToken ct = default)
            => Task.FromResult(true);
    }

    private sealed class InMemoryScheduleTemplateRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, ScheduleTemplate> _templates = new();
        public List<ScheduleTemplate> AddedTemplates { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();

        public void Seed(ScheduleTemplate t) => _templates[t.Id] = t;

        public override Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default)
            => Task.FromResult(_templates.TryGetValue(templateId, out var t) ? t : null);

        public override Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default)
        {
            AddedTemplates.Add(template);
            _templates[template.Id] = template;
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
