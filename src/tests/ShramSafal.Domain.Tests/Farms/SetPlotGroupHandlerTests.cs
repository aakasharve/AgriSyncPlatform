// spec: plr-d10-redesign-real-integration-2026-10-25 - lane GRP-1a (owner-named groups of plots).
// SetPlotGroupHandler: the same gate add-plot uses (edit farm setup, from THIS farm's seat - not "owner only"), the plot must be on the farm in
// the route, the updated DTO comes back, the same name twice is a success, and a real change writes ONE audit row (P3: never silent).
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Farms.SetPlotGroup;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class SetPlotGroupHandlerTests
{
    private static readonly Guid OwnerId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid DelegateId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid StrangerId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherFarmGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid PlotGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly DateTime Created = new(2026, 11, 20, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 11, 20, 9, 30, 0, DateTimeKind.Utc);

    private sealed class Clock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    /// <summary>One farm, one plot, a few seats; records what the handler wrote.</summary>
    private sealed class Repo : StubShramSafalRepository
    {
        public Farm? TheFarm { get; set; } = Farm.Create(FarmGuid, "Patil Farm", OwnerId, Created);
        public Plot? ThePlot { get; set; } = Plot.Create(PlotGuid, FarmGuid, "G7", 0.5m, Created);
        public Dictionary<Guid, AppRole> Seats { get; } = new()
        {
            [OwnerId] = AppRole.PrimaryOwner,
            [WorkerId] = AppRole.Worker,
            [DelegateId] = AppRole.Mukadam,
        };

        /// <summary>The standing of a seat that is NOT the plain label default (a stored "edit farm setup" bit, or none).</summary>
        public Dictionary<Guid, FarmAccess> Access { get; } = new();

        public List<AuditEvent> Audit { get; } = [];
        public int Saves { get; private set; }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(TheFarm is not null && TheFarm.Id.Value == farmId ? TheFarm : null);

        public override Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) =>
            Task.FromResult(ThePlot is not null && ThePlot.Id == plotId ? ThePlot : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<AppRole?>(farmId == FarmGuid && Seats.TryGetValue(userId, out var role) ? role : null);

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Access.TryGetValue(userId, out var access) ? Task.FromResult<FarmAccess?>(access) : base.GetFarmAccessForUserAsync(farmId, userId, ct);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audit.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }

    private static SetPlotGroupHandler HandlerOver(Repo repo) => new(repo, new Clock(Now));

    private static SetPlotGroupCommand Command(string? name, Guid? actor = null, Guid? farm = null, Guid? plot = null) =>
        new(farm ?? FarmGuid, plot ?? PlotGuid, name, actor ?? OwnerId, ClientAppVersion: "1.2.3", AuditDeviceId: "device-1", AuditIpHash: "sha256:abc");

    [Fact]
    public async Task The_primary_owner_names_the_group_and_gets_the_updated_dto()
    {
        var repo = new Repo();

        var result = await HandlerOver(repo).HandleAsync(Command("विहिरीजवळचे"));

        Assert.True(result.IsSuccess);
        Assert.Equal("विहिरीजवळचे", result.Value.GroupName);
        Assert.Equal(PlotGuid, result.Value.Id);
        Assert.Equal(FarmGuid, result.Value.FarmId);
        Assert.Equal("G7", result.Value.Name);
        Assert.Equal(Now, result.Value.ModifiedAtUtc);
        Assert.Equal("विहिरीजवळचे", repo.ThePlot!.GroupName);
        Assert.Equal(1, repo.Saves);
    }

    [Fact]
    public async Task The_name_is_trimmed_and_a_blank_name_clears_the_group()
    {
        var repo = new Repo();
        var handler = HandlerOver(repo);

        var named = await handler.HandleAsync(Command("  वरचा भाग  "));
        Assert.True(named.IsSuccess);
        Assert.Equal("वरचा भाग", named.Value.GroupName);

        var cleared = await handler.HandleAsync(Command("   "));
        Assert.True(cleared.IsSuccess);
        Assert.Null(cleared.Value.GroupName);
        Assert.Null(repo.ThePlot!.GroupName);

        var again = await handler.HandleAsync(Command(null));
        Assert.True(again.IsSuccess);
        Assert.Null(again.Value.GroupName);
    }

    [Fact]
    public async Task The_same_name_twice_is_a_success_that_writes_and_records_nothing_the_second_time()
    {
        var repo = new Repo();
        var handler = HandlerOver(repo);

        var first = await handler.HandleAsync(Command("विहिरीजवळचे"));
        var second = await handler.HandleAsync(Command(" विहिरीजवळचे "));

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.Equal("विहिरीजवळचे", second.Value.GroupName);
        Assert.Single(repo.Audit);
        Assert.Equal(1, repo.Saves);
    }

    [Fact]
    public async Task A_change_writes_one_audit_row_saying_who_which_plot_the_old_name_and_the_new_name()
    {
        var repo = new Repo();
        var handler = HandlerOver(repo);
        await handler.HandleAsync(Command("वरचा भाग"));

        var result = await handler.HandleAsync(Command("खालचा भाग"));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, repo.Audit.Count);
        var row = repo.Audit[1];
        Assert.Equal("Plot", row.EntityType);
        Assert.Equal(PlotGuid, row.EntityId);
        Assert.Equal("GroupChanged", row.Action);
        Assert.Equal(OwnerId, row.ActorUserId.Value);
        Assert.Equal("PrimaryOwner", row.ActorRole);
        Assert.Equal(FarmGuid, row.FarmId);
        Assert.Equal("1.2.3", row.AppVersion);
        Assert.Equal("device-1", row.DeviceId);
        using var payload = System.Text.Json.JsonDocument.Parse(row.Payload);
        Assert.Equal(PlotGuid, payload.RootElement.GetProperty("plotId").GetGuid());
        Assert.Equal(FarmGuid, payload.RootElement.GetProperty("farmId").GetGuid());
        Assert.Equal("वरचा भाग", payload.RootElement.GetProperty("oldGroupName").GetString());
        Assert.Equal("खालचा भाग", payload.RootElement.GetProperty("newGroupName").GetString());
    }

    [Fact]
    public async Task Naming_the_first_group_records_no_old_name_and_clearing_records_no_new_name()
    {
        var repo = new Repo();
        var handler = HandlerOver(repo);

        await handler.HandleAsync(Command("वरचा भाग"));
        await handler.HandleAsync(Command(null));

        using var named = System.Text.Json.JsonDocument.Parse(repo.Audit[0].Payload);
        Assert.Equal(System.Text.Json.JsonValueKind.Null, named.RootElement.GetProperty("oldGroupName").ValueKind);
        Assert.Equal("वरचा भाग", named.RootElement.GetProperty("newGroupName").GetString());
        using var cleared = System.Text.Json.JsonDocument.Parse(repo.Audit[1].Payload);
        Assert.Equal("वरचा भाग", cleared.RootElement.GetProperty("oldGroupName").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, cleared.RootElement.GetProperty("newGroupName").ValueKind);
    }

    [Fact]
    public async Task A_seat_without_the_farm_setup_authority_is_refused_and_nothing_changes()
    {
        var repo = new Repo();

        var worker = await HandlerOver(repo).HandleAsync(Command("वरचा भाग", actor: WorkerId));

        Assert.False(worker.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden.Code, worker.Error.Code);
        Assert.Null(repo.ThePlot!.GroupName);
        Assert.Equal(Created, repo.ThePlot.ModifiedAtUtc);
        Assert.Empty(repo.Audit);
        Assert.Equal(0, repo.Saves);
    }

    [Fact]
    public async Task A_label_alone_grants_nothing_a_mukadam_without_the_setup_bit_is_refused()
    {
        var repo = new Repo();
        repo.Access[DelegateId] = new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.None);

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग", actor: DelegateId));

        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
        Assert.Null(repo.ThePlot!.GroupName);
    }

    [Fact]
    public async Task It_is_not_owner_only_a_seat_the_owner_gave_edit_farm_setup_may_name_a_group()
    {
        var repo = new Repo();
        repo.Access[DelegateId] = new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.EditFarmSetup);

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग", actor: DelegateId));

        Assert.True(result.IsSuccess);
        Assert.Equal("वरचा भाग", repo.ThePlot!.GroupName);
        Assert.Equal("Mukadam", repo.Audit.Single().ActorRole);
    }

    [Fact]
    public async Task A_seat_that_is_no_longer_active_is_refused()
    {
        var repo = new Repo();
        repo.Access[DelegateId] = new FarmAccess(AppRole.Mukadam, MembershipStatus.Suspended, IsRegistrant: false, FarmPermission.EditFarmSetup);

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग", actor: DelegateId));

        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
    }

    [Fact]
    public async Task A_person_with_no_seat_on_the_farm_is_refused()
    {
        var repo = new Repo();

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग", actor: StrangerId));

        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
        Assert.Null(repo.ThePlot!.GroupName);
    }

    [Fact]
    public async Task A_plot_that_does_not_exist_is_not_found()
    {
        var repo = new Repo { ThePlot = null };

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग"));

        Assert.Equal(ShramSafalErrors.PlotNotFound.Code, result.Error.Code);
        Assert.Empty(repo.Audit);
    }

    [Fact]
    public async Task A_plot_of_another_farm_is_not_found_on_this_one_and_is_left_alone()
    {
        var repo = new Repo { ThePlot = Plot.Create(PlotGuid, OtherFarmGuid, "H1", 1m, Created) };

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग"));

        Assert.Equal(ShramSafalErrors.PlotNotFound.Code, result.Error.Code);
        Assert.Null(repo.ThePlot.GroupName);
        Assert.Equal(Created, repo.ThePlot.ModifiedAtUtc);
        Assert.Empty(repo.Audit);
    }

    [Fact]
    public async Task A_farm_that_does_not_exist_is_not_found()
    {
        var repo = new Repo { TheFarm = null };

        var result = await HandlerOver(repo).HandleAsync(Command("वरचा भाग"));

        Assert.Equal(ShramSafalErrors.FarmNotFound.Code, result.Error.Code);
        Assert.Null(repo.ThePlot!.GroupName);
    }

    [Fact]
    public async Task A_name_longer_than_thirty_characters_is_an_invalid_command_even_without_the_pipeline()
    {
        var repo = new Repo();

        var result = await HandlerOver(repo).HandleAsync(Command(new string('अ', 31)));

        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Null(repo.ThePlot!.GroupName);
        Assert.Equal(0, repo.Saves);
    }

    [Fact]
    public async Task Thirty_characters_is_accepted()
    {
        var repo = new Repo();
        var name = new string('अ', 30);

        var result = await HandlerOver(repo).HandleAsync(Command(name));

        Assert.True(result.IsSuccess);
        Assert.Equal(name, result.Value.GroupName);
    }

    [Fact]
    public async Task Empty_ids_are_an_invalid_command()
    {
        var repo = new Repo();
        var handler = HandlerOver(repo);

        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, (await handler.HandleAsync(Command("x") with { FarmId = Guid.Empty })).Error.Code);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, (await handler.HandleAsync(Command("x") with { PlotId = Guid.Empty })).Error.Code);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, (await handler.HandleAsync(Command("x") with { ActorUserId = Guid.Empty })).Error.Code);
    }

    // ── the pipeline stages the endpoint's handler is built with (the registration in DependencyInjection.cs) ──────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("वरचा भाग")]
    public void The_validator_accepts_a_clearing_or_ordinary_name(string? name)
    {
        Assert.Empty(new SetPlotGroupValidator().Validate(Command(name)));
    }

    [Fact]
    public void The_validator_refuses_thirty_one_characters_and_empty_ids_but_trims_before_it_counts()
    {
        var validator = new SetPlotGroupValidator();
        Assert.Single(validator.Validate(Command(new string('अ', 31))));
        Assert.Empty(validator.Validate(Command("  " + new string('अ', 30) + "  ")));
        Assert.Single(validator.Validate(Command("x") with { FarmId = Guid.Empty }));
        Assert.Single(validator.Validate(Command("x") with { PlotId = Guid.Empty }));
        Assert.Single(validator.Validate(Command("x") with { ActorUserId = Guid.Empty }));
    }

    [Fact]
    public async Task The_authorizer_asks_exactly_what_add_plot_asks_farm_exists_then_edit_farm_setup()
    {
        var repo = new Repo();
        var authorizer = new SetPlotGroupAuthorizer(repo, new Clock(Now));

        Assert.True((await authorizer.AuthorizeAsync(Command("x"), default)).IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden.Code, (await authorizer.AuthorizeAsync(Command("x", actor: WorkerId), default)).Error.Code);
        Assert.Equal(ShramSafalErrors.Forbidden.Code, (await authorizer.AuthorizeAsync(Command("x", actor: StrangerId), default)).Error.Code);

        repo.TheFarm = null;
        Assert.Equal(ShramSafalErrors.FarmNotFound.Code, (await authorizer.AuthorizeAsync(Command("x"), default)).Error.Code);
    }

    [Fact]
    public async Task Through_the_pipeline_the_refusals_come_in_the_canonical_order()
    {
        var repo = new Repo();
        var pipeline = HandlerPipeline.Build<SetPlotGroupCommand, PlotDto>(
            HandlerOver(repo),
            new ValidationBehavior<SetPlotGroupCommand, PlotDto>([new SetPlotGroupValidator()]),
            new AuthorizationBehavior<SetPlotGroupCommand, PlotDto>([new SetPlotGroupAuthorizer(repo, new Clock(Now))]));

        // A bad name from someone who is not allowed: the shape is refused first.
        var invalid = await pipeline.HandleAsync(Command(new string('अ', 31), actor: WorkerId));
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, invalid.Error.Code);

        var forbidden = await pipeline.HandleAsync(Command("वरचा भाग", actor: WorkerId));
        Assert.Equal(ShramSafalErrors.Forbidden.Code, forbidden.Error.Code);

        var ok = await pipeline.HandleAsync(Command("वरचा भाग"));
        Assert.True(ok.IsSuccess);
        Assert.Equal("वरचा भाग", ok.Value.GroupName);
    }
}
