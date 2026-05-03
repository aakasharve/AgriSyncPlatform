using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (GeneratePlanFromTemplate): per-stage
/// validator + authorizer coverage and end-to-end pipeline assertions.
/// Canonical short-circuit ordering: <c>InvalidCommand →
/// CropCycleNotFound → Forbidden → (body)</c>.
/// </summary>
public sealed class GeneratePlanFromTemplatePipelineTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly Guid PlotId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly Guid CropCycleId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid ActorId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid StrangerId = Guid.Parse("99999999-9999-9999-9999-999999999999");

    private static GeneratePlanFromTemplateCommand WellFormedCommand() =>
        new(
            ActorUserId: ActorId,
            CropCycleId: CropCycleId,
            TemplateName: "Grapes flowering plan",
            Stage: "flowering",
            PlanStartDate: new DateOnly(2026, 4, 22),
            Activities: new List<TemplateActivityInput>
            {
                new("Spray", 0),
                new("Irrigate", 2),
            });

    private static CropCycle MakeCropCycle() =>
        CropCycle.Create(
            CropCycleId, FarmId, PlotId,
            cropName: "Grapes", stage: "flowering",
            startDate: new DateOnly(2026, 3, 1), endDate: null,
            createdAtUtc: Now.AddDays(-30));

    // ---- Validator ----

    [Fact]
    public void Validator_yields_InvalidCommand_when_ActorUserId_is_empty()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand() with { ActorUserId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_CropCycleId_is_empty()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand() with { CropCycleId = Guid.Empty }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_TemplateName_is_blank()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand() with { TemplateName = "  " }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Stage_is_blank()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand() with { Stage = "" }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_Activities_is_empty()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand() with { Activities = new List<TemplateActivityInput>() }).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_InvalidCommand_when_an_activity_has_blank_name()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var bad = WellFormedCommand() with
        {
            Activities = new List<TemplateActivityInput>
            {
                new("Spray", 0),
                new("", 2),
            }
        };
        var errs = v.Validate(bad).ToList();
        Assert.Single(errs);
        Assert.Equal(ShramSafalErrors.InvalidCommand, errs[0]);
    }

    [Fact]
    public void Validator_yields_no_errors_when_command_is_well_formed()
    {
        var v = new GeneratePlanFromTemplateValidator();
        var errs = v.Validate(WellFormedCommand()).ToList();
        Assert.Empty(errs);
    }

    // ---- Authorizer ----

    [Fact]
    public async Task Authorizer_returns_CropCycleNotFound_when_id_resolves_to_nothing()
    {
        var repo = new FakeGenRepo(cropCycle: null);
        var a = new GeneratePlanFromTemplateAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormedCommand(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.CropCycleNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Forbidden_when_caller_is_not_a_member()
    {
        var repo = new FakeGenRepo(MakeCropCycle());
        // No membership set.
        var a = new GeneratePlanFromTemplateAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormedCommand() with { ActorUserId = StrangerId }, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
    }

    [Fact]
    public async Task Authorizer_returns_Success_when_caller_is_a_member_of_the_crop_cycle_farm()
    {
        var repo = new FakeGenRepo(MakeCropCycle());
        repo.SetMembership(FarmId.Value, ActorId);
        var a = new GeneratePlanFromTemplateAuthorizer(repo);

        var result = await a.AuthorizeAsync(WellFormedCommand(), default);

        Assert.True(result.IsSuccess);
    }

    // ---- Pipeline integration ----

    [Fact]
    public async Task Pipeline_short_circuits_at_validator_when_Activities_is_empty()
    {
        var (pipeline, repo) = BuildPipeline(MakeCropCycle(), memberOfFarm: true);

        var result = await pipeline.HandleAsync(
            WellFormedCommand() with { Activities = new List<TemplateActivityInput>() });

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Empty(repo.AddedTemplates);
        Assert.Empty(repo.AddedActivities);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_CropCycleNotFound()
    {
        var (pipeline, repo) = BuildPipeline(cropCycle: null, memberOfFarm: false);

        var result = await pipeline.HandleAsync(WellFormedCommand());

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.CropCycleNotFound, result.Error);
        Assert.Empty(repo.AddedTemplates);
    }

    [Fact]
    public async Task Pipeline_short_circuits_at_authorizer_with_Forbidden()
    {
        var (pipeline, repo) = BuildPipeline(MakeCropCycle(), memberOfFarm: false);

        var result = await pipeline.HandleAsync(WellFormedCommand() with { ActorUserId = StrangerId });

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.AddedTemplates);
    }

    [Fact]
    public async Task Pipeline_invokes_inner_handler_on_happy_path_and_persists_template_plus_activities()
    {
        var (pipeline, repo) = BuildPipeline(MakeCropCycle(), memberOfFarm: true);

        var result = await pipeline.HandleAsync(WellFormedCommand());

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        Assert.Equal(2, result.Value!.ActivitiesGenerated);
        Assert.Single(repo.AddedTemplates);
        Assert.Equal(2, repo.AddedActivities.Count);
        // Body's CreateFromTemplate factory must stamp SourceTemplateActivityId.
        Assert.All(repo.AddedActivities, a => Assert.NotNull(a.SourceTemplateActivityId));
        Assert.Equal(1, repo.SaveCalls);
    }

    // ---- Helpers ----

    private static (
        IHandler<GeneratePlanFromTemplateCommand, PlanGenerationResultDto> Pipeline,
        FakeGenRepo Repo) BuildPipeline(CropCycle? cropCycle, bool memberOfFarm)
    {
        var repo = new FakeGenRepo(cropCycle);
        if (memberOfFarm && cropCycle is not null)
        {
            repo.SetMembership(cropCycle.FarmId.Value, ActorId);
        }

        var rawHandler = new GeneratePlanFromTemplateHandler(
            repo,
            new SequentialIdGenerator(),
            new FakeClock(Now));

        var validator = new GeneratePlanFromTemplateValidator();
        var authorizer = new GeneratePlanFromTemplateAuthorizer(repo);

        var pipeline = HandlerPipeline.Build(
            rawHandler,
            new LoggingBehavior<GeneratePlanFromTemplateCommand, PlanGenerationResultDto>(
                NullLogger<LoggingBehavior<GeneratePlanFromTemplateCommand, PlanGenerationResultDto>>.Instance),
            new ValidationBehavior<GeneratePlanFromTemplateCommand, PlanGenerationResultDto>(
                new IValidator<GeneratePlanFromTemplateCommand>[] { validator }),
            new AuthorizationBehavior<GeneratePlanFromTemplateCommand, PlanGenerationResultDto>(
                new IAuthorizationCheck<GeneratePlanFromTemplateCommand>[] { authorizer }));

        return (pipeline, repo);
    }

    private sealed class FakeGenRepo : Work.Handlers.StubShramSafalRepository
    {
        private readonly CropCycle? _cropCycle;
        private readonly HashSet<(Guid farmId, Guid userId)> _memberships = new();

        public FakeGenRepo(CropCycle? cropCycle) => _cropCycle = cropCycle;

        public List<ScheduleTemplate> AddedTemplates { get; } = new();
        public List<PlannedActivity> AddedActivities { get; } = new();
        public int SaveCalls { get; private set; }

        public void SetMembership(Guid farmId, Guid userId) => _memberships.Add((farmId, userId));

        public override Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(_cropCycle?.Id == cropCycleId ? _cropCycle : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(_memberships.Contains((farmId, userId)));

        public override Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default)
        {
            AddedTemplates.Add(template);
            return Task.CompletedTask;
        }

        public override Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default)
        {
            AddedActivities.AddRange(plannedActivities);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeClock : IClock
    {
        private readonly DateTime _now;
        public FakeClock(DateTime now) => _now = now;
        public DateTime UtcNow => _now;
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        private int _counter;
        public Guid New()
        {
            _counter++;
            // Format: ........-....-....-....-...........NNN — reads as a
            // valid Guid and stays unique over the small per-test ranges.
            return new Guid($"00000000-0000-0000-0000-{_counter:D12}");
        }
    }
}
