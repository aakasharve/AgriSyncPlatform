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

    // ---- helpers ----

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
        InMemoryPriceConfigRepo Repo) BuildPipeline()
    {
        var repo = new InMemoryPriceConfigRepo();
        var clock = new FixedClock(Now);
        var ids = new SequentialIdGenerator();
        var rawHandler = new SetPriceConfigVersionHandler(repo, ids, clock);

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
