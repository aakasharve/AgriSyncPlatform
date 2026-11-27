// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9 farm setup on the server; repair D-177 the owner's own-bill switch)
// The six farm-setup handlers and the own-bill switch handler, over an in-memory store: who may (the existing "edit farm setup" authority, from THIS
// farm's seat), the order of refusals, the conflict rule (a stale revision is refused and nothing is overwritten; the same content again is answered as
// saved with nothing written), one audit row per real change with before and after, and the plot links that go with a removed motor or source.
// Every refusal is asserted by its CODE and its WORDS.
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Farms.FarmSetup;
using ShramSafal.Application.UseCases.Farms.SetOwnBillApproval;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class FarmSetupHandlerTests
{
    private static readonly Guid OwnerId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid DelegateId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid StrangerId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherFarmGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid PlotGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid OtherFarmPlot = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccc02");
    private static readonly Guid SourceId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddd01");
    private static readonly Guid Motor1 = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01");
    private static readonly Guid Motor2 = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02");
    private static readonly Guid MachineId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffff01");
    private static readonly DateTime Created = new(2026, 11, 20, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 11, 27, 9, 30, 0, DateTimeKind.Utc);

    private const string ConflictCode = "ShramSafal.FarmSetup.Conflict";
    private const string ConflictWords = "This was changed from another phone first. Nothing was saved.";
    private const string InvalidCode = "ShramSafal.FarmSetupInvalid";
    private const string ForbiddenWords = "User is not allowed to modify this farm.";

    private sealed class Clock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    private sealed class Entitlement(bool allowed) : IEntitlementPolicy
    {
        public List<PaidFeature> Asked { get; } = [];

        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
        {
            Asked.Add(feature);
            return Task.FromResult(new EntitlementDecision(allowed, allowed ? EntitlementReason.Allowed : EntitlementReason.SubscriptionExpired, null));
        }
    }

    /// <summary>One farm, two plots (one on another farm), a few seats; records what the handlers wrote.</summary>
    private sealed class Repo : StubShramSafalRepository
    {
        public Farm? TheFarm { get; set; } = Farm.Create(FarmGuid, "Patil Farm", OwnerId, Created);
        public List<Plot> Plots { get; } = [Plot.Create(PlotGuid, FarmGuid, "G7", 0.5m, Created), Plot.Create(OtherFarmPlot, OtherFarmGuid, "दुसऱ्याचा", 1m, Created)];
        public Dictionary<Guid, AppRole> Seats { get; } = new()
        {
            [OwnerId] = AppRole.PrimaryOwner,
            [WorkerId] = AppRole.Worker,
            [DelegateId] = AppRole.Mukadam,
        };

        public Dictionary<Guid, FarmAccess> Access { get; } = new();
        public List<AuditEvent> Audit { get; } = [];
        public int Saves { get; private set; }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(TheFarm is not null && TheFarm.Id.Value == farmId ? TheFarm : null);

        public override Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) =>
            Task.FromResult(Plots.FirstOrDefault(p => p.Id == plotId));

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

    /// <summary>The farm-setup rows in memory. <see cref="NextSaveLoses"/>: the save meets a rival's change (the database's answer to two saves at once).</summary>
    private sealed class Store : IFarmSetupStore
    {
        public Dictionary<Guid, FarmWaterSource> Sources { get; } = new();
        public Dictionary<Guid, FarmPowerTimes> PowerTimes { get; } = new();
        public Dictionary<Guid, FarmMachine> Machines { get; } = new();
        public Dictionary<Guid, PlotWaterSetup> PlotWater { get; } = new();
        public int Saves { get; private set; }
        public bool NextSaveLoses { get; set; }

        public Task<FarmWaterSource?> GetWaterSourceAsync(Guid waterSourceId, CancellationToken ct = default) =>
            Task.FromResult(Sources.GetValueOrDefault(waterSourceId));

        public Task<IReadOnlyList<FarmMotor>> GetMotorsAsync(IReadOnlyCollection<Guid> motorIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<FarmMotor>>(Sources.Values.SelectMany(s => s.Motors).Where(m => motorIds.Contains(m.Id)).ToList());

        public Task<FarmPowerTimes?> GetPowerTimesAsync(Guid farmId, CancellationToken ct = default) => Task.FromResult(PowerTimes.GetValueOrDefault(farmId));

        public Task<FarmMachine?> GetMachineAsync(Guid machineId, CancellationToken ct = default) => Task.FromResult(Machines.GetValueOrDefault(machineId));

        public Task<PlotWaterSetup?> GetPlotWaterAsync(Guid plotId, CancellationToken ct = default) => Task.FromResult(PlotWater.GetValueOrDefault(plotId));

        public Task<IReadOnlyList<PlotWaterSetup>> GetPlotWaterLinkedToSourceAsync(Guid waterSourceId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<PlotWaterSetup>>(
                PlotWater.Values.Where(p => p.Links.Any(l => l.State == FarmSetupState.Active && l.WaterSourceId == waterSourceId)).ToList());

        public void Stage(FarmWaterSource source) => Sources[source.Id] = source;

        public void Stage(FarmPowerTimes powerTimes) => PowerTimes[powerTimes.Id] = powerTimes;

        public void Stage(FarmMachine machine) => Machines[machine.Id] = machine;

        public void Stage(PlotWaterSetup plotWater) => PlotWater[plotWater.Id] = plotWater;

        public Task<FarmSetupRows> GetOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            Task.FromResult(new FarmSetupRows([.. Sources.Values], [.. PowerTimes.Values], [.. Machines.Values], [.. PlotWater.Values]));

        public Task<IReadOnlySet<Guid>> GetFarmsAllowingOwnBillApprovalAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlySet<Guid>>(new HashSet<Guid>());

        public Task<FarmSetupSave> TrySaveAsync(CancellationToken ct = default)
        {
            if (NextSaveLoses)
            {
                NextSaveLoses = false;
                return Task.FromResult(FarmSetupSave.ChangedElsewhere);
            }

            Saves++;
            return Task.FromResult(FarmSetupSave.Saved);
        }
    }

    private sealed class World
    {
        public Repo Repo { get; } = new();
        public Store Store { get; } = new();
        public Entitlement Entitlement { get; set; } = new(allowed: true);

        public SaveWaterSourceHandler SaveSource => new(Repo, Store, Entitlement, new Clock(Now));
        public RemoveWaterSourceHandler RemoveSource => new(Repo, Store, Entitlement, new Clock(Now));
        public SetPowerTimesHandler SetPower => new(Repo, Store, Entitlement, new Clock(Now));
        public SaveMachineHandler SaveMachine => new(Repo, Store, Entitlement, new Clock(Now));
        public RemoveMachineHandler RemoveMachine => new(Repo, Store, Entitlement, new Clock(Now));
        public SetPlotWaterHandler SetPlotWater => new(Repo, Store, Entitlement, new Clock(Now));
    }

    private static FarmSetupCaller Caller(Guid? user = null) => new(user ?? OwnerId, "cmd-1", "1.0.18", "device-1");

    private static FarmMotorSpec Motor(Guid id, decimal hp = 5m) => new(id, "मोटर", hp, 3, "mseb", null, null);

    private static FarmWaterSourceSpec Well(string name = "मुख्य विहीर", string type = "well", params FarmMotorSpec[] motors) => new(name, type, true, null, motors);

    private static SaveWaterSourceCommand SaveSource(FarmWaterSourceSpec spec, int baseRevision = 0, Guid? user = null, Guid? farm = null, Guid? id = null) =>
        new(farm ?? FarmGuid, id ?? SourceId, baseRevision, spec, Caller(user));

    private static FarmMachineSpec Machine(string name = "ट्रॅक्टर", string type = "tractor") => new(name, type, "owned", null, null, null, null, null, null);

    private static JsonElement Payload(AuditEvent audit) => JsonDocument.Parse(audit.Payload).RootElement;

    // ── B4: water sources ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_owner_saves_a_source_with_two_motors_and_one_audit_row_is_written()
    {
        var world = new World();

        var result = await world.SaveSource.HandleAsync(SaveSource(Well(motors: [Motor(Motor1), Motor(Motor2)])));

        Assert.True(result.IsSuccess, result.Error.ToString());
        Assert.Equal(new FarmSetupResult(SourceId, 1), result.Value);
        Assert.Equal(2, world.Store.Sources[SourceId].Motors.Count);
        Assert.Equal(1, world.Store.Saves);
        Assert.Equal([PaidFeature.CreatePlot], world.Entitlement.Asked);
        var audit = Assert.Single(world.Repo.Audit);
        Assert.Equal("FarmWaterSource", audit.EntityType);
        Assert.Equal(SourceId, audit.EntityId);
        Assert.Equal("FarmWaterSourceSaved", audit.Action);
        Assert.Equal(OwnerId, audit.ActorUserId.Value);
        Assert.Equal("PrimaryOwner", audit.ActorRole);
        Assert.Equal(FarmGuid, audit.FarmId);
        var payload = Payload(audit);
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("before").ValueKind);
        Assert.Equal("मुख्य विहीर", payload.GetProperty("after").GetProperty("name").GetString());
        Assert.Equal(2, payload.GetProperty("after").GetProperty("motors").GetArrayLength());
        Assert.Equal(1, payload.GetProperty("revision").GetInt32());
    }

    [Fact]
    public async Task A_stale_revision_is_refused_and_nothing_is_overwritten()
    {
        var world = new World();
        await world.SaveSource.HandleAsync(SaveSource(Well(motors: Motor(Motor1))));                               // both phones read revision 1
        var first = await world.SaveSource.HandleAsync(SaveSource(Well("पहिला बदल", motors: Motor(Motor1)), 1));  // the first edit makes 2
        Assert.Equal(2, first.Value!.Revision);
        var savesBefore = world.Store.Saves;

        var second = await world.SaveSource.HandleAsync(SaveSource(Well("दुसरा बदल", motors: Motor(Motor1)), 1)); // the second edit still says 1

        Assert.False(second.IsSuccess);
        Assert.Equal(ConflictCode, second.Error.Code);
        Assert.Equal(ConflictWords, second.Error.Description);
        Assert.Equal("पहिला बदल", world.Store.Sources[SourceId].Name);
        Assert.Equal(2, world.Store.Sources[SourceId].Revision);
        Assert.Equal(savesBefore, world.Store.Saves);
        Assert.Equal(2, world.Repo.Audit.Count);
    }

    [Fact]
    public async Task The_same_bytes_sent_twice_are_answered_as_saved_and_written_once()
    {
        var world = new World();
        var command = SaveSource(Well(motors: Motor(Motor1)));

        var first = await world.SaveSource.HandleAsync(command);
        var again = await world.SaveSource.HandleAsync(command);

        Assert.True(again.IsSuccess);
        Assert.Equal(first.Value, again.Value);
        Assert.Equal(1, world.Store.Saves);
        Assert.Single(world.Repo.Audit);

        // And an edit already applied, sent again with its old base revision, is answered as saved too.
        var edit = SaveSource(Well("नवं नाव", motors: Motor(Motor1)), 1);
        await world.SaveSource.HandleAsync(edit);
        var editAgain = await world.SaveSource.HandleAsync(edit);
        Assert.True(editAgain.IsSuccess);
        Assert.Equal(2, editAgain.Value!.Revision);
        Assert.Equal(2, world.Store.Saves);
        Assert.Equal(2, world.Repo.Audit.Count);
    }

    [Fact]
    public async Task A_new_id_that_already_holds_other_content_is_refused()
    {
        var world = new World();
        await world.SaveSource.HandleAsync(SaveSource(Well("पहिली")));

        var result = await world.SaveSource.HandleAsync(SaveSource(Well("वेगळी")));

        Assert.Equal(ConflictCode, result.Error.Code);
        Assert.Equal("पहिली", world.Store.Sources[SourceId].Name);
    }

    [Fact]
    public async Task Two_saves_in_the_same_instant_the_one_the_database_refuses_answers_the_same_conflict()
    {
        var world = new World();
        world.Store.NextSaveLoses = true;

        var result = await world.SaveSource.HandleAsync(SaveSource(Well()));

        Assert.Equal(ConflictCode, result.Error.Code);
        Assert.Equal(ConflictWords, result.Error.Description);
    }

    [Fact]
    public async Task A_member_without_edit_farm_setup_is_refused_and_a_chosen_plots_seat_with_it_is_refused_too()
    {
        var world = new World();

        var worker = await world.SaveSource.HandleAsync(SaveSource(Well(), user: WorkerId));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
        Assert.Equal(ForbiddenWords, worker.Error.Description);

        var stranger = await world.SaveSource.HandleAsync(SaveSource(Well(), user: StrangerId));
        Assert.Equal("ShramSafal.Forbidden", stranger.Error.Code);

        // A label grants nothing: a mukadam with no stored setup bit.
        world.Repo.Access[DelegateId] = new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.None);
        Assert.Equal("ShramSafal.Forbidden", (await world.SaveSource.HandleAsync(SaveSource(Well(), user: DelegateId))).Error.Code);

        // The authority on a seat that covers only chosen plots: the farm's setup is not his to change.
        world.Repo.Access[DelegateId] = new FarmAccess(
            AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.EditFarmSetup,
            PlotScope: MembershipPlotScope.ChosenPlots, ScopePlotIds: [PlotGuid]);
        var chosen = await world.SaveSource.HandleAsync(SaveSource(Well(), user: DelegateId));
        Assert.Equal("ShramSafal.Forbidden", chosen.Error.Code);
        Assert.Equal(ForbiddenWords, chosen.Error.Description);

        Assert.Empty(world.Store.Sources);
        Assert.Empty(world.Repo.Audit);
        Assert.Equal(0, world.Store.Saves);

        // It is not owner-only: a seat the owner gave the authority, covering every plot, may.
        world.Repo.Access[DelegateId] = new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.EditFarmSetup);
        var given = await world.SaveSource.HandleAsync(SaveSource(Well(), user: DelegateId));
        Assert.True(given.IsSuccess);
        Assert.Equal("Mukadam", world.Repo.Audit.Single().ActorRole);
    }

    [Fact]
    public async Task The_order_of_refusals_is_invalid_then_farm_then_forbidden_then_stale_then_content()
    {
        var world = new World();

        // invalid command beats everything (even for a stranger on a farm that does not exist).
        var invalid = await world.SaveSource.HandleAsync(SaveSource(Well(type: "river"), baseRevision: -1, user: StrangerId, farm: OtherFarmGuid));
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, invalid.Error.Code);

        // farm not found beats forbidden.
        var noFarm = await world.SaveSource.HandleAsync(SaveSource(Well(type: "river"), user: StrangerId, farm: OtherFarmGuid));
        Assert.Equal(ShramSafalErrors.FarmNotFound.Code, noFarm.Error.Code);

        // forbidden beats stale and content.
        await world.SaveSource.HandleAsync(SaveSource(Well()));
        var forbidden = await world.SaveSource.HandleAsync(SaveSource(Well(type: "river"), baseRevision: 7, user: WorkerId));
        Assert.Equal("ShramSafal.Forbidden", forbidden.Error.Code);

        // stale beats content.
        var stale = await world.SaveSource.HandleAsync(SaveSource(Well(type: "river"), baseRevision: 7));
        Assert.Equal(ConflictCode, stale.Error.Code);

        // content last, by its rule's name and words.
        var content = await world.SaveSource.HandleAsync(SaveSource(Well(type: "river"), baseRevision: 1));
        Assert.Equal(InvalidCode, content.Error.Code);
        Assert.Equal("FarmWaterSourceType: A water source is a well, a borewell, a canal, a farm pond or a tanker. Nothing was saved.", content.Error.Description);
        Assert.Equal("well", world.Store.Sources[SourceId].SourceType);
        Assert.Single(world.Repo.Audit);
    }

    [Fact]
    public async Task The_entitlement_gate_of_add_plot_is_asked_after_the_authority()
    {
        var world = new World { Entitlement = new Entitlement(allowed: false) };

        var refused = await world.SaveSource.HandleAsync(SaveSource(Well()));
        Assert.False(refused.IsSuccess);
        Assert.StartsWith("entitlement.", refused.Error.Code);
        Assert.Empty(world.Store.Sources);

        var worker = await world.SaveSource.HandleAsync(SaveSource(Well(), user: WorkerId));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
    }

    [Fact]
    public async Task A_source_of_another_farm_is_never_changed_and_a_motor_of_another_source_is_refused()
    {
        var world = new World();
        var foreign = FarmWaterSource.Create(SourceId, new FarmId(OtherFarmGuid), Well("दुसऱ्याची", motors: Motor(Motor1)), new UserId(StrangerId), Created);
        world.Store.Stage(foreign);

        var save = await world.SaveSource.HandleAsync(SaveSource(Well("माझी"), baseRevision: 1));
        Assert.Equal(ConflictCode, save.Error.Code);
        var remove = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 1, Caller()));
        Assert.Equal(ConflictCode, remove.Error.Code);
        Assert.Equal("दुसऱ्याची", foreign.Name);
        Assert.Equal(FarmSetupState.Active, foreign.State);

        // A new source of this farm that names a motor another source already holds.
        var mine = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddd02");
        var stolen = await world.SaveSource.HandleAsync(SaveSource(Well("माझी", motors: Motor(Motor1)), id: mine));
        Assert.Equal(InvalidCode, stolen.Error.Code);
        Assert.Equal("FarmMotorPlace: A motor belongs to one water source of one farm. Nothing was saved.", stolen.Error.Description);
        Assert.False(world.Store.Sources.ContainsKey(mine));
        Assert.Empty(world.Repo.Audit);
    }

    [Fact]
    public async Task Removing_a_source_is_a_state_needs_the_current_revision_and_twice_is_once()
    {
        var world = new World();
        await world.SaveSource.HandleAsync(SaveSource(Well(motors: Motor(Motor1))));

        var stale = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 5, Caller()));
        Assert.Equal(ConflictCode, stale.Error.Code);
        Assert.Equal(FarmSetupState.Active, world.Store.Sources[SourceId].State);

        var removed = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 1, Caller()));
        Assert.True(removed.IsSuccess);
        Assert.Equal(2, removed.Value!.Revision);
        Assert.Equal(FarmSetupState.Removed, world.Store.Sources[SourceId].State);
        Assert.All(world.Store.Sources[SourceId].Motors, m => Assert.Equal(FarmSetupState.Removed, m.State));
        Assert.Equal("FarmWaterSourceRemoved", world.Repo.Audit.Last().Action);
        Assert.Equal("active", Payload(world.Repo.Audit.Last()).GetProperty("before").GetProperty("state").GetString());
        Assert.Equal("removed", Payload(world.Repo.Audit.Last()).GetProperty("after").GetProperty("state").GetString());

        var again = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 1, Caller()));
        Assert.True(again.IsSuccess);
        Assert.Equal(2, again.Value!.Revision);
        Assert.Equal(2, world.Repo.Audit.Count);

        var unknown = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, Guid.NewGuid(), 1, Caller()));
        Assert.Equal(ConflictCode, unknown.Error.Code);
        var worker = await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 2, Caller(WorkerId)));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
    }

    // ── B5: power times ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_bad_time_is_refused_by_name()
    {
        var world = new World();
        var bad = FarmSetupSamples.Timetable.Replace("\"06:00\"", "\"25:00\"");

        var result = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 0, bad, Caller()));

        Assert.False(result.IsSuccess);
        Assert.Equal(InvalidCode, result.Error.Code);
        Assert.Equal("PowerTimesTime: An off-window's start and end are times of day written HH:mm (00:00 to 23:59). Nothing was saved.", result.Error.Description);
        Assert.Empty(world.Store.PowerTimes);
        Assert.Empty(world.Repo.Audit);
        Assert.Equal(0, world.Store.Saves);
    }

    [Fact]
    public async Task The_timetable_is_written_whole_once_and_a_stale_or_unauthorised_write_is_refused()
    {
        var world = new World();

        var first = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 0, FarmSetupSamples.Timetable, Caller()));
        Assert.Equal(new FarmSetupResult(FarmGuid, 1), first.Value);
        var again = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 0, FarmSetupSamples.Timetable, Caller()));
        Assert.True(again.IsSuccess);
        Assert.Equal(1, world.Store.Saves);
        Assert.Single(world.Repo.Audit);

        var changed = FarmSetupSamples.Timetable.Replace("\"06:00\"", "\"07:15\"");
        var stale = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 0, changed, Caller()));
        Assert.Equal(ConflictCode, stale.Error.Code);
        Assert.Equal(ConflictWords, stale.Error.Description);
        var missing = await new World().SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 3, changed, Caller()));
        Assert.Equal(ConflictCode, missing.Error.Code);

        var edit = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 1, changed, Caller()));
        Assert.Equal(2, edit.Value!.Revision);
        var audit = world.Repo.Audit.Last();
        Assert.Equal("FarmPowerTimesSet", audit.Action);
        Assert.Equal("06:00", Payload(audit).GetProperty("before").GetProperty("singlePhase").GetProperty("weekAOffWindows")[0].GetProperty("startTime").GetString());
        Assert.Equal("07:15", Payload(audit).GetProperty("after").GetProperty("singlePhase").GetProperty("weekAOffWindows")[0].GetProperty("startTime").GetString());

        var worker = await world.SetPower.HandleAsync(new SetPowerTimesCommand(FarmGuid, 2, FarmSetupSamples.Timetable, Caller(WorkerId)));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
        Assert.Equal(2, world.Store.PowerTimes[FarmGuid].Revision);
    }

    // ── B6: machines ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_machine_saves_with_the_name_alone()
    {
        var world = new World();

        var result = await world.SaveMachine.HandleAsync(new SaveMachineCommand(FarmGuid, MachineId, 0, Machine("  महिंद्रा 575 "), Caller()));

        Assert.True(result.IsSuccess, result.Error.ToString());
        Assert.Equal(new FarmSetupResult(MachineId, 1), result.Value);
        var machine = world.Store.Machines[MachineId];
        Assert.Equal("महिंद्रा 575", machine.Name);
        Assert.Null(machine.Company);
        Assert.Null(machine.Hp);
        Assert.Null(machine.TankLitres);
        Assert.Equal("FarmMachineSaved", Assert.Single(world.Repo.Audit).Action);
        Assert.Equal(JsonValueKind.Null, Payload(world.Repo.Audit[0]).GetProperty("after").GetProperty("hp").ValueKind);
    }

    [Fact]
    public async Task A_machine_edit_keeps_its_id_an_unknown_type_is_refused_and_a_removal_is_a_state()
    {
        var world = new World();
        await world.SaveMachine.HandleAsync(new SaveMachineCommand(FarmGuid, MachineId, 0, Machine(), Caller()));

        var unknown = await world.SaveMachine.HandleAsync(new SaveMachineCommand(FarmGuid, MachineId, 1, Machine(type: "drone"), Caller()));
        Assert.Equal(InvalidCode, unknown.Error.Code);
        Assert.Equal("FarmMachineType: A machine is a tractor, a blower, a sprayer, a rotavator, a harvester or other. Nothing was saved.", unknown.Error.Description);
        Assert.Equal("tractor", world.Store.Machines[MachineId].MachineType);

        var edit = await world.SaveMachine.HandleAsync(new SaveMachineCommand(FarmGuid, MachineId, 1, Machine("नवं नाव", "blower"), Caller()));
        Assert.Equal(new FarmSetupResult(MachineId, 2), edit.Value);
        Assert.Equal("ट्रॅक्टर", Payload(world.Repo.Audit.Last()).GetProperty("before").GetProperty("name").GetString());
        Assert.Equal("नवं नाव", Payload(world.Repo.Audit.Last()).GetProperty("after").GetProperty("name").GetString());

        var stale = await world.SaveMachine.HandleAsync(new SaveMachineCommand(FarmGuid, MachineId, 1, Machine("उशिराचा"), Caller()));
        Assert.Equal(ConflictCode, stale.Error.Code);
        Assert.Equal("नवं नाव", world.Store.Machines[MachineId].Name);

        var staleRemove = await world.RemoveMachine.HandleAsync(new RemoveMachineCommand(FarmGuid, MachineId, 1, Caller()));
        Assert.Equal(ConflictCode, staleRemove.Error.Code);
        var removed = await world.RemoveMachine.HandleAsync(new RemoveMachineCommand(FarmGuid, MachineId, 2, Caller()));
        Assert.Equal(new FarmSetupResult(MachineId, 3), removed.Value);
        Assert.Equal(FarmSetupState.Removed, world.Store.Machines[MachineId].State);
        var again = await world.RemoveMachine.HandleAsync(new RemoveMachineCommand(FarmGuid, MachineId, 2, Caller()));
        Assert.True(again.IsSuccess);
        Assert.Equal(3, world.Repo.Audit.Count);

        var worker = await world.RemoveMachine.HandleAsync(new RemoveMachineCommand(FarmGuid, MachineId, 3, Caller(WorkerId)));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
    }

    // ── B7: plot water ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Removing_a_motor_removes_its_plot_links()
    {
        var world = new World();
        await world.SaveSource.HandleAsync(SaveSource(Well(motors: [Motor(Motor1), Motor(Motor2)])));
        var set = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(
            FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", [new PlotWaterLinkSpec(SourceId, Motor1), new PlotWaterLinkSpec(SourceId, Motor2)]), Caller()));
        Assert.Equal(new FarmSetupResult(PlotGuid, 1), set.Value);

        // The source is saved again WITHOUT motor 1: the motor is removed, and so is the plot's link to it, in the same save.
        var save = await world.SaveSource.HandleAsync(SaveSource(Well(motors: Motor(Motor2)), 1));

        Assert.True(save.IsSuccess);
        var plot = world.Store.PlotWater[PlotGuid];
        Assert.Equal("drip", plot.Method);
        Assert.Equal(2, plot.Revision);
        Assert.Equal(Motor2, Assert.Single(plot.Links, l => l.State == FarmSetupState.Active).MotorId);
        Assert.Equal(PlotGuid, Payload(world.Repo.Audit.Last()).GetProperty("unlinkedPlotIds")[0].GetGuid());

        // Removing the whole source drops the last link; the plot's answer (its row and method) stays.
        await world.RemoveSource.HandleAsync(new RemoveWaterSourceCommand(FarmGuid, SourceId, 2, Caller()));
        Assert.Equal(3, plot.Revision);
        Assert.Equal("drip", plot.Method);
        Assert.DoesNotContain(plot.Links, l => l.State == FarmSetupState.Active);
    }

    [Fact]
    public async Task A_plot_is_saved_with_a_method_and_no_link_and_none_is_its_own_answer()
    {
        var world = new World();

        var drip = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", []), Caller()));
        Assert.Equal(new FarmSetupResult(PlotGuid, 1), drip.Value);
        Assert.Equal("PlotWaterSet", Assert.Single(world.Repo.Audit).Action);

        var none = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 1, new PlotWaterSpec("none", []), Caller()));
        Assert.Equal(2, none.Value!.Revision);
        Assert.Equal("drip", Payload(world.Repo.Audit.Last()).GetProperty("before").GetProperty("method").GetString());
        Assert.Equal("none", Payload(world.Repo.Audit.Last()).GetProperty("after").GetProperty("method").GetString());

        var same = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 1, new PlotWaterSpec("none", []), Caller()));
        Assert.True(same.IsSuccess);
        Assert.Equal(2, world.Repo.Audit.Count);
    }

    [Fact]
    public async Task A_plot_of_another_farm_a_source_not_in_the_setup_and_a_stale_or_broken_arrangement_are_refused()
    {
        var world = new World();
        await world.SaveSource.HandleAsync(SaveSource(Well(motors: Motor(Motor1))));

        var otherPlot = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, OtherFarmPlot, 0, new PlotWaterSpec("drip", []), Caller()));
        Assert.Equal(ShramSafalErrors.PlotNotFound.Code, otherPlot.Error.Code);
        Assert.Equal("Plot was not found.", otherPlot.Error.Description);

        var unknownSource = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(
            FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", [new PlotWaterLinkSpec(Guid.NewGuid(), null)]), Caller()));
        Assert.Equal(ConflictCode, unknownSource.Error.Code);
        var unknownMotor = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(
            FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", [new PlotWaterLinkSpec(SourceId, Motor2)]), Caller()));
        Assert.Equal(ConflictCode, unknownMotor.Error.Code);

        var noneWithLink = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(
            FarmGuid, PlotGuid, 0, new PlotWaterSpec("none", [new PlotWaterLinkSpec(SourceId, Motor1)]), Caller()));
        Assert.Equal(InvalidCode, noneWithLink.Error.Code);
        Assert.Equal("PlotWaterNoneWithLinks: A plot that has no water facility cannot also name a water source. Nothing was saved.", noneWithLink.Error.Description);

        var worker = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", []), Caller(WorkerId)));
        Assert.Equal("ShramSafal.Forbidden", worker.Error.Code);
        Assert.Empty(world.Store.PlotWater);

        await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 0, new PlotWaterSpec("flood", [new PlotWaterLinkSpec(SourceId, null)]), Caller()));
        var stale = await world.SetPlotWater.HandleAsync(new SetPlotWaterCommand(FarmGuid, PlotGuid, 0, new PlotWaterSpec("drip", []), Caller()));
        Assert.Equal(ConflictCode, stale.Error.Code);
        Assert.Equal("flood", world.Store.PlotWater[PlotGuid].Method);
    }

    // ── D-177: the owner's own-bill switch ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Only_the_primary_owner_turns_the_own_bill_switch_and_the_same_value_again_writes_nothing()
    {
        var repo = new Repo();
        var handler = new SetOwnBillApprovalHandler(repo, new Clock(Now));
        Assert.False(repo.TheFarm!.ReviewerMayApproveOwnBill);

        // Not even a seat holding review money or edit farm setup: the switch is the primary owner's alone.
        repo.Access[DelegateId] = new FarmAccess(
            AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false, FarmPermission.EditFarmSetup | FarmPermission.ReviewMoney | FarmPermission.SeeMoney);
        var notOwner = await handler.HandleAsync(new SetOwnBillApprovalCommand(FarmGuid, true, Caller(DelegateId)));
        Assert.Equal("ShramSafal.Forbidden", notOwner.Error.Code);
        Assert.Equal(ForbiddenWords, notOwner.Error.Description);
        Assert.False(repo.TheFarm.ReviewerMayApproveOwnBill);
        Assert.Equal(0, repo.Saves);

        var off = await handler.HandleAsync(new SetOwnBillApprovalCommand(FarmGuid, false, Caller()));
        Assert.True(off.IsSuccess);
        Assert.Equal(0, repo.Saves);
        Assert.Empty(repo.Audit);

        var on = await handler.HandleAsync(new SetOwnBillApprovalCommand(FarmGuid, true, Caller()));
        Assert.Equal(new OwnBillApprovalResult(FarmGuid, true), on.Value);
        Assert.True(repo.TheFarm.ReviewerMayApproveOwnBill);
        Assert.Equal(1, repo.Saves);
        var audit = Assert.Single(repo.Audit);
        Assert.Equal("Farm", audit.EntityType);
        Assert.Equal("OwnBillApprovalSwitchSet", audit.Action);
        Assert.False(Payload(audit).GetProperty("old").GetBoolean());
        Assert.True(Payload(audit).GetProperty("new").GetBoolean());

        var noFarm = await handler.HandleAsync(new SetOwnBillApprovalCommand(OtherFarmGuid, true, Caller()));
        Assert.Equal(ShramSafalErrors.FarmNotFound.Code, noFarm.Error.Code);
    }
}
