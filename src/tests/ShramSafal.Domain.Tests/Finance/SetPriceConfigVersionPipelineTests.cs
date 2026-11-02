using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (SetPriceConfigVersion): end-to-end
/// coverage. The validator catches caller-shape issues (blank
/// ItemName, non-positive Version, empty CreatedByUserId, explicit-
/// but-empty PriceConfigId). No authorizer is registered for this
/// command (gap documented in SetPriceConfigVersionValidator XML).
/// </summary>
public sealed class SetPriceConfigVersionPipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Creator = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_ItemName_is_blank()
    {
        var v = new SetPriceConfigVersionValidator();
        var errs = v.Validate(MakeCommand(itemName: "  ")).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Version_is_not_positive()
    {
        var v = new SetPriceConfigVersionValidator();
        Assert.Single(v.Validate(MakeCommand(version: 0)).ToList());
        Assert.Single(v.Validate(MakeCommand(version: -1)).ToList());
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CreatedByUserId_is_empty()
    {
        var v = new SetPriceConfigVersionValidator();
        var errs = v.Validate(MakeCommand(createdByUserId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_explicit_PriceConfigId_is_empty()
    {
        var v = new SetPriceConfigVersionValidator();
        var errs = v.Validate(MakeCommand(priceConfigId: Guid.Empty)).ToList();
        Assert.Single(errs);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new SetPriceConfigVersionValidator();
        Assert.Empty(v.Validate(MakeCommand()).ToList());
        // null PriceConfigId is fine — handler generates one.
        Assert.Empty(v.Validate(MakeCommand(priceConfigId: null)).ToList());
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_ItemName_is_blank()
    {
        var (pipeline, repo) = BuildPipeline();
        var r = await pipeline.HandleAsync(MakeCommand(itemName: ""));

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, r.Error.Code);
        Assert.Equal(ErrorKind.Validation, r.Error.Kind);
        // Body emits AddPriceConfigAsync on success — its absence proves
        // the pipeline short-circuited before the handler ran.
        Assert.Empty(repo.AddedConfigs);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path()
    {
        var (pipeline, repo) = BuildPipeline();
        var r = await pipeline.HandleAsync(MakeCommand());

        Assert.True(r.IsSuccess);
        Assert.Single(repo.AddedConfigs);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("VersionSet", repo.AuditEvents[0].Action);
        Assert.Equal("Sugar Cane", repo.AddedConfigs[0].ItemName);
    }

    // spec: plr-d10 lane F99 fix pass 1 (review F-4; D-72) — one list for every farm: only the platform admin writes it.
    [Theory]
    [InlineData(Admin.None)]
    [InlineData(Admin.FpoOwner)]
    [InlineData(Admin.PlatformViewer)]
    public async Task Pipeline_refuses_anyone_but_the_platform_admin_and_writes_nothing(Admin who)
    {
        var (pipeline, repo) = BuildPipeline(who);
        var r = await pipeline.HandleAsync(MakeCommand());

        Assert.False(r.IsSuccess);
        Assert.Equal(ShramSafalErrors.PriceListPlatformAdminOnly.Code, r.Error.Code);
        Assert.Equal(ErrorKind.Forbidden, r.Error.Kind);
        Assert.Empty(repo.AddedConfigs);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task Pipeline_takes_a_platform_admin_who_holds_other_admin_seats_too()
    {
        var (pipeline, repo) = BuildPipeline(Admin.PlatformOwnerAmongOthers);
        var r = await pipeline.HandleAsync(MakeCommand());

        Assert.True(r.IsSuccess);
        Assert.Single(repo.AddedConfigs);
    }

    // ---- helpers ----

    public enum Admin { PlatformOwner, PlatformOwnerAmongOthers, PlatformViewer, FpoOwner, None }

    private static SetPriceConfigVersionCommand MakeCommand(
        string itemName = "Sugar Cane",
        decimal unitPrice = 10.5m,
        string currencyCode = "INR",
        DateOnly? effectiveFrom = null,
        int version = 1,
        Guid? createdByUserId = null,
        Guid? priceConfigId = null)
        => new(
            ItemName: itemName,
            UnitPrice: unitPrice,
            CurrencyCode: currencyCode,
            EffectiveFrom: effectiveFrom ?? new DateOnly(2026, 4, 1),
            Version: version,
            CreatedByUserId: createdByUserId ?? Creator,
            PriceConfigId: priceConfigId,
            ActorRole: "primary_owner",
            ClientCommandId: null);

    private static (
        IHandler<SetPriceConfigVersionCommand, PriceConfigDto> Pipeline,
        InMemoryPriceConfigRepo Repo) BuildPipeline(Admin who = Admin.PlatformOwner)
    {
        var repo = new InMemoryPriceConfigRepo();
        var clock = new FixedClock(Now);
        var ids = new SequentialIdGenerator();
        var rawHandler = new SetPriceConfigVersionHandler(repo, ids, clock, new FakeAdminResolver(who));

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<SetPriceConfigVersionCommand, PriceConfigDto>(
                NullLogger<LoggingBehavior<SetPriceConfigVersionCommand, PriceConfigDto>>.Instance),
            new ValidationBehavior<SetPriceConfigVersionCommand, PriceConfigDto>(
                new IValidator<SetPriceConfigVersionCommand>[] { new SetPriceConfigVersionValidator() }),
            // No authorizer registered — see SetPriceConfigVersionValidator XML.
            new AuthorizationBehavior<SetPriceConfigVersionCommand, PriceConfigDto>(
                Array.Empty<IAuthorizationCheck<SetPriceConfigVersionCommand>>()));

        return (pipeline, repo);
    }

    /// <summary>The admin seats the caller holds, as the real resolver answers them (one seat: resolved; several: ambiguous).</summary>
    private sealed class FakeAdminResolver(Admin who) : ShramSafal.Application.Admin.Ports.IEntitlementResolver
    {
        public Task<ShramSafal.Application.Admin.Ports.ResolveResult> ResolveAsync(
            AgriSync.SharedKernel.Contracts.Ids.UserId userId, Guid? activeOrgId, CancellationToken ct)
        {
            static ShramSafal.Application.Admin.Ports.MembershipSummary Seat(
                ShramSafal.Domain.Organizations.OrganizationType type, ShramSafal.Domain.Organizations.OrganizationRole role)
                => new(Guid.NewGuid(), type.ToString(), type, role);
            var platformOwner = Seat(ShramSafal.Domain.Organizations.OrganizationType.Platform, ShramSafal.Domain.Organizations.OrganizationRole.Owner);
            ShramSafal.Application.Admin.Ports.ResolveResult Single(ShramSafal.Application.Admin.Ports.MembershipSummary seat, bool platformAdmin) =>
                ShramSafal.Application.Admin.Ports.ResolveResult.Resolved(
                    new ShramSafal.Application.Admin.AdminScope(seat.OrganizationId, seat.OrganizationType, seat.OrganizationRole, [], platformAdmin),
                    [seat]);
            return Task.FromResult(who switch
            {
                Admin.PlatformOwner => Single(platformOwner, platformAdmin: true),
                Admin.PlatformOwnerAmongOthers => ShramSafal.Application.Admin.Ports.ResolveResult.Ambiguous(
                    [Seat(ShramSafal.Domain.Organizations.OrganizationType.FPO, ShramSafal.Domain.Organizations.OrganizationRole.Owner), platformOwner]),
                Admin.PlatformViewer => Single(
                    Seat(ShramSafal.Domain.Organizations.OrganizationType.Platform, ShramSafal.Domain.Organizations.OrganizationRole.Viewer), platformAdmin: false),
                Admin.FpoOwner => Single(
                    Seat(ShramSafal.Domain.Organizations.OrganizationType.FPO, ShramSafal.Domain.Organizations.OrganizationRole.Owner), platformAdmin: false),
                _ => ShramSafal.Application.Admin.Ports.ResolveResult.Unauthorized(),
            });
        }
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class InMemoryPriceConfigRepo : StubShramSafalRepository
    {
        public List<PriceConfig> AddedConfigs { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();

        public override Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default)
        {
            AddedConfigs.Add(config);
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
