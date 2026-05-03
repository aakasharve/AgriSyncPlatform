using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Attachments;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (Attachments.{Create,Upload}): end-to-end
/// coverage for the two-phase attachment commit. Verifies canonical
/// pipeline ordering on both phases:
/// <list type="bullet">
/// <item>Create: <c>InvalidCommand → Forbidden → (body link-target)</c>.</item>
/// <item>Upload: <c>InvalidCommand → AttachmentNotFound → Forbidden →
/// (body state &amp; mime checks)</c>.</item>
/// </list>
/// Note: the validator on Upload checks <c>FileStream is null</c> for
/// presence only — it does NOT read the stream.
/// </summary>
public sealed class AttachmentPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherFarmGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    private static readonly Guid Member = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid Stranger = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    // ====================================================================
    // CreateAttachmentValidator
    // ====================================================================

    [Fact]
    public void CreateValidator_yields_InvalidCommand_when_FarmId_is_empty()
    {
        var v = new CreateAttachmentValidator();
        Assert.Single(v.Validate(MakeCreate(farmId: Guid.Empty)).ToList());
    }

    [Fact]
    public void CreateValidator_yields_InvalidCommand_when_FileName_or_MimeType_is_blank()
    {
        var v = new CreateAttachmentValidator();
        Assert.Single(v.Validate(MakeCreate(fileName: "")).ToList());
        Assert.Single(v.Validate(MakeCreate(mimeType: " ")).ToList());
    }

    [Fact]
    public void CreateValidator_yields_InvalidCommand_for_unknown_linkedEntityType()
    {
        var v = new CreateAttachmentValidator();
        Assert.Single(v.Validate(MakeCreate(linkedEntityType: "WeatherEvent")).ToList());
        Assert.Single(v.Validate(MakeCreate(linkedEntityType: null)).ToList());
    }

    [Fact]
    public void CreateValidator_passes_for_known_linkedEntityType_case_insensitive()
    {
        var v = new CreateAttachmentValidator();
        Assert.Empty(v.Validate(MakeCreate(linkedEntityType: "Farm")).ToList());
        Assert.Empty(v.Validate(MakeCreate(linkedEntityType: "DAILYLOG")).ToList());
        Assert.Empty(v.Validate(MakeCreate(linkedEntityType: "costentry")).ToList());
    }

    // ====================================================================
    // CreateAttachmentAuthorizer
    // ====================================================================

    [Fact]
    public async Task CreateAuthorizer_returns_Forbidden_when_caller_not_a_member()
    {
        var repo = new InMemoryAttachmentRepo();
        var a = new CreateAttachmentAuthorizer(repo);
        var r = await a.AuthorizeAsync(MakeCreate(createdByUserId: Stranger), default);
        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, r.Error);
    }

    [Fact]
    public async Task CreateAuthorizer_returns_Success_when_caller_is_member()
    {
        var repo = new InMemoryAttachmentRepo();
        repo.SetMembership(FarmGuid, Member);
        var a = new CreateAttachmentAuthorizer(repo);
        var r = await a.AuthorizeAsync(MakeCreate(), default);
        Assert.True(r.IsSuccess);
    }

    // ====================================================================
    // CreateAttachment pipeline
    // ====================================================================

    [Fact]
    public async Task CreatePipeline_short_circuits_at_validator_then_at_authorizer()
    {
        // 1) Validator fires
        var (pipeline1, repo1) = BuildCreatePipeline();
        var r1 = await pipeline1.HandleAsync(MakeCreate(farmId: Guid.Empty));
        Assert.False(r1.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, r1.Error.Code);
        Assert.Empty(repo1.AddedAttachments);

        // 2) Validator passes, authorizer fires (no membership set)
        var (pipeline2, repo2) = BuildCreatePipeline();
        var r2 = await pipeline2.HandleAsync(MakeCreate());
        Assert.False(r2.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, r2.Error);
        Assert.Empty(repo2.AddedAttachments);
    }

    [Fact]
    public async Task CreatePipeline_invokes_body_on_happy_path_with_Farm_link()
    {
        var (pipeline, repo) = BuildCreatePipeline();
        repo.SetMembership(FarmGuid, Member);
        // Seed a farm so the body's link-target check passes (farm linked
        // to itself is the simplest happy path).
        repo.SeedFarm(FarmGuid);

        var r = await pipeline.HandleAsync(MakeCreate(linkedEntityId: FarmGuid, linkedEntityType: "Farm"));

        Assert.True(r.IsSuccess);
        Assert.Single(repo.AddedAttachments);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("Created", repo.AuditEvents[0].Action);
    }

    // ====================================================================
    // UploadAttachmentValidator
    // ====================================================================

    [Fact]
    public void UploadValidator_yields_InvalidCommand_when_AttachmentId_is_empty()
    {
        var v = new UploadAttachmentValidator();
        Assert.Single(v.Validate(MakeUpload(attachmentId: Guid.Empty)).ToList());
    }

    [Fact]
    public void UploadValidator_yields_InvalidCommand_when_FileStream_is_null()
    {
        var v = new UploadAttachmentValidator();
        // Bypass the MakeUpload helper to feed a real null stream.
        var cmd = new UploadAttachmentCommand(
            AttachmentId: Guid.NewGuid(),
            FileStream: null!,
            UploadedByUserId: Member);
        Assert.Single(v.Validate(cmd).ToList());
    }

    [Fact]
    public void UploadValidator_does_NOT_read_stream_to_validate()
    {
        // Stream throws on any read; validator must not read it.
        var v = new UploadAttachmentValidator();
        var throwingStream = new ThrowingStream();
        var errs = v.Validate(MakeUpload(stream: throwingStream)).ToList();
        Assert.Empty(errs);
        Assert.False(throwingStream.WasRead);
    }

    // ====================================================================
    // UploadAttachmentAuthorizer
    // ====================================================================

    [Fact]
    public async Task UploadAuthorizer_returns_AttachmentNotFound_when_id_resolves_to_nothing()
    {
        var repo = new InMemoryAttachmentRepo();
        var a = new UploadAttachmentAuthorizer(repo);
        var r = await a.AuthorizeAsync(MakeUpload(), default);
        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.AttachmentNotFound, r.Error);
        Assert.Equal(ErrorKind.NotFound, r.Error.Kind);
    }

    [Fact]
    public async Task UploadAuthorizer_returns_Forbidden_when_caller_not_a_member()
    {
        var repo = new InMemoryAttachmentRepo();
        var att = MakeAttachment();
        repo.SeedAttachment(att);
        var a = new UploadAttachmentAuthorizer(repo);

        var r = await a.AuthorizeAsync(MakeUpload(attachmentId: att.Id, uploadedByUserId: Stranger), default);

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, r.Error);
    }

    [Fact]
    public async Task UploadAuthorizer_returns_Success_when_attachment_found_and_caller_is_member()
    {
        var repo = new InMemoryAttachmentRepo();
        var att = MakeAttachment();
        repo.SeedAttachment(att);
        repo.SetMembership(FarmGuid, Member);
        var a = new UploadAttachmentAuthorizer(repo);

        var r = await a.AuthorizeAsync(MakeUpload(attachmentId: att.Id), default);
        Assert.True(r.IsSuccess);
    }

    // ====================================================================
    // helpers
    // ====================================================================

    private static CreateAttachmentCommand MakeCreate(
        Guid? farmId = null,
        Guid? linkedEntityId = null,
        string? linkedEntityType = "DailyLog",
        string fileName = "receipt.jpg",
        string mimeType = "image/jpeg",
        Guid? createdByUserId = null)
        => new(
            FarmId: farmId ?? FarmGuid,
            LinkedEntityId: linkedEntityId ?? Guid.NewGuid(),
            LinkedEntityType: linkedEntityType ?? string.Empty,
            FileName: fileName,
            MimeType: mimeType,
            CreatedByUserId: createdByUserId ?? Member);

    private static UploadAttachmentCommand MakeUpload(
        Guid? attachmentId = null,
        Guid? uploadedByUserId = null,
        Stream? stream = null)
        => new(
            AttachmentId: attachmentId ?? Guid.NewGuid(),
            FileStream: stream ?? new MemoryStream(new byte[] { 0x01 }),
            UploadedByUserId: uploadedByUserId ?? Member);

    private static Attachment MakeAttachment()
    {
        return Attachment.Create(
            Guid.NewGuid(),
            new FarmId(FarmGuid),
            linkedEntityId: Guid.NewGuid(),
            linkedEntityType: "DailyLog",
            fileName: "receipt.jpg",
            mimeType: "image/jpeg",
            createdByUserId: new UserId(Member),
            createdAtUtc: Now);
    }

    private static (
        IHandler<CreateAttachmentCommand, AttachmentDto> Pipeline,
        InMemoryAttachmentRepo Repo) BuildCreatePipeline()
    {
        var repo = new InMemoryAttachmentRepo();
        var clock = new FixedClock(Now);
        var ids = new SequentialIdGenerator();
        var rawHandler = new CreateAttachmentHandler(repo, ids, clock);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<CreateAttachmentCommand, AttachmentDto>(
                NullLogger<LoggingBehavior<CreateAttachmentCommand, AttachmentDto>>.Instance),
            new ValidationBehavior<CreateAttachmentCommand, AttachmentDto>(
                new IValidator<CreateAttachmentCommand>[] { new CreateAttachmentValidator() }),
            new AuthorizationBehavior<CreateAttachmentCommand, AttachmentDto>(
                new IAuthorizationCheck<CreateAttachmentCommand>[] { new CreateAttachmentAuthorizer(repo) }));

        return (pipeline, repo);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class ThrowingStream : Stream
    {
        public bool WasRead { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => 0;
        public override long Position { get => 0; set { } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            WasRead = true;
            throw new InvalidOperationException("Validator must not read the stream.");
        }
        public override long Seek(long offset, SeekOrigin origin) => 0;
        public override void SetLength(long value) { }
        public override void Write(byte[] buffer, int offset, int count) { }
    }

    private sealed class InMemoryAttachmentRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, Attachment> _attachments = new();
        private readonly Dictionary<Guid, Farm> _farms = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _memberships = new();

        public List<Attachment> AddedAttachments { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();

        public void SeedAttachment(Attachment a) => _attachments[a.Id] = a;
        public void SeedFarm(Guid farmId) => _farms[farmId] = Farm.Create(new FarmId(farmId), "Test Farm", new UserId(Member), Now);
        public void SetMembership(Guid farmId, Guid userId) => _memberships.Add((farmId, userId));

        public override Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default)
            => Task.FromResult(_attachments.TryGetValue(attachmentId, out var a) ? a : null);

        public override Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default)
        {
            AddedAttachments.Add(attachment);
            _attachments[attachment.Id] = attachment;
            return Task.CompletedTask;
        }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_farms.TryGetValue(farmId, out var f) ? f : null);

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
