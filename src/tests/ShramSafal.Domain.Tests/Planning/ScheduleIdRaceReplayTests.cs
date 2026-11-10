// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN fix round 1 (M011; session A's design call, F219).
// A phone-minted schedule id can lose a race: the id-exists check passes, a rival saves the same id, and the save answers "taken". The answer is then
// decided by RE-READING the row by id, not by a constraint name: the stored row is the same request (same maker, same content) -> an idempotent replay
// answers success exactly as a replay of a stored answer would; any other row -> ShramSafal.ScheduleIdTaken (409). Never a 500. Pure: no I/O.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Common;
using Xunit;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleIdRaceReplayTests
{
    private static readonly DateTime Now = new(2026, 11, 9, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmA = Guid.Parse("a0a00000-0000-4000-8000-0000000000a1");
    private static readonly Guid Owner = Guid.Parse("a0a00000-0000-4000-8000-000000000011");
    private static readonly Guid Rival = Guid.Parse("a0a00000-0000-4000-8000-000000000012");

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private sealed class Store : ISyncMutationStore
    {
        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default) =>
            Task.FromResult<StoredSyncMutation?>(null);

        public Task<bool> TryStoreSuccessAsync(
            string deviceId, string clientRequestId, string mutationType, string responsePayloadJson, DateTime processedAtUtc, CancellationToken ct = default) =>
            Task.FromResult(true);
    }

    /// <summary>The id is free when the handler checks and TAKEN when it saves: the save answers IdTaken and the row the rival wrote is then readable.</summary>
    private sealed class RaceRepo(ScheduleTemplate? source, ScheduleTemplate? rivalRow) : FakeShramSafalRepository, IShramSafalRepository
    {
        private bool _saveTried;

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult<Farm?>(farmId == FarmA ? Farm.Create(new FarmId(FarmA), "शेत", new UserId(Owner), Now) : null);

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult<List<Guid>>([FarmA]);

        public override Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
            Task.FromResult(source is not null && source.Id == templateId ? source
                : _saveTried && rivalRow is not null && rivalRow.Id == templateId ? rivalRow
                : null);

        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default) =>
            Task.FromResult<List<CropCycle>>(
                [CropCycle.Create(Guid.NewGuid(), new FarmId(FarmA), Guid.NewGuid(), "Grapes", "Vegetative", DateOnly.FromDateTime(Now), null, Now)]);

        public override Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => Task.CompletedTask;

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => Task.CompletedTask;

        public Task<ScheduleCopySave> TrySaveNewScheduleAsync(CancellationToken ct = default)
        {
            _saveTried = true;
            return Task.FromResult(ScheduleCopySave.IdTaken);
        }
    }

    private static readonly StageDefinition[] Stages = [new("Pruning", 0, 20)];

    private static ScheduleActivityDraft Work(string name) => new(name, "work", null, 0, 5, FrequencyMode.OneTime, 1);

    // ---- create ---------------------------------------------------------------------------------------------

    private static CreateOwnScheduleCommand CreateCmd(Guid id, Guid caller = default, string name = "माझं") =>
        new(id, FarmA, "Grapes", name, caller == default ? Owner : caller, AppRole.PrimaryOwner, null);

    [Fact]
    public async Task Create_whose_id_a_rival_saved_as_the_same_request_is_a_replay_that_succeeds()
    {
        var id = Guid.NewGuid();
        var handler = new CreateOwnScheduleHandler(
            new RaceRepo(null, ScheduleTemplate.CreateOwn(id, "माझं", "Grapes", FarmA, new UserId(Owner), Now)), new Store(), new Clock());

        var result = await handler.HandleAsync(CreateCmd(id));

        Assert.True(result.IsSuccess, result.Error?.ToString());
        Assert.Equal(new CreateOwnScheduleResult(id, 1), result.Value);
    }

    [Fact]
    public async Task Create_whose_id_a_rival_saved_with_other_content_or_another_maker_is_ScheduleIdTaken()
    {
        var id = Guid.NewGuid();
        var otherName = new CreateOwnScheduleHandler(
            new RaceRepo(null, ScheduleTemplate.CreateOwn(id, "दुसरं नाव", "Grapes", FarmA, new UserId(Owner), Now)), new Store(), new Clock());
        var otherMaker = new CreateOwnScheduleHandler(
            new RaceRepo(null, ScheduleTemplate.CreateOwn(id, "माझं", "Grapes", FarmA, new UserId(Rival), Now)), new Store(), new Clock());

        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await otherName.HandleAsync(CreateCmd(id))).Error);
        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await otherMaker.HandleAsync(CreateCmd(id))).Error);
    }

    // ---- edit -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Edit_whose_id_a_rival_saved_as_the_same_request_is_a_replay_and_another_content_is_ScheduleIdTaken()
    {
        var source = ScheduleTemplate.CreateOwn(Guid.NewGuid(), "माझं", "Grapes", FarmA, new UserId(Owner), Now);
        var id = Guid.NewGuid();
        var command = new EditScheduleTemplateCommand(
            source.Id, id, Owner, AppRole.PrimaryOwner, null, null, null, FarmId: FarmA,
            Stages: [new("Pruning", 0, 20)],
            Activities: [new("पहिलं", "work", null, 0, 5, "one_time", 1)]);

        var same = source.EditCopyOnWrite(id, null, null, Stages, [Work("पहिलं")], new UserId(Owner), Now, out _)!;
        var other = source.EditCopyOnWrite(id, null, null, Stages, [Work("वेगळं")], new UserId(Owner), Now, out _)!;
        var byRival = source.EditCopyOnWrite(id, null, null, Stages, [Work("पहिलं")], new UserId(Rival), Now, out _)!;

        var replay = await new EditScheduleTemplateHandler(new RaceRepo(source, same), new Store(), new Clock()).HandleAsync(command);
        Assert.True(replay.IsSuccess, replay.Error?.ToString());
        Assert.Equal(new EditScheduleTemplateResult(id, 2), replay.Value);

        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await new EditScheduleTemplateHandler(new RaceRepo(source, other), new Store(), new Clock()).HandleAsync(command)).Error);
        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await new EditScheduleTemplateHandler(new RaceRepo(source, byRival), new Store(), new Clock()).HandleAsync(command)).Error);
    }

    // ---- clone ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Clone_whose_id_a_rival_saved_as_the_same_request_is_a_replay_and_another_row_is_ScheduleIdTaken()
    {
        var source = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes", "Pruning", Now, new UserId(Rival), TenantScope.Public);
        var id = Guid.NewGuid();
        var command = new CloneScheduleTemplateCommand(source.Id, id, Owner, AppRole.PrimaryOwner, TenantScope.Private, "माझी प्रत", null);

        var same = source.Clone(id, new UserId(Owner), TenantScope.Private, "माझी प्रत", Now);
        var byRival = source.Clone(id, new UserId(Rival), TenantScope.Private, "माझी प्रत", Now);
        var otherScope = source.Clone(id, new UserId(Owner), TenantScope.Team, "माझी प्रत", Now);

        var replay = await new CloneScheduleTemplateHandler(new RaceRepo(source, same), new Store(), new Clock()).HandleAsync(command);
        Assert.True(replay.IsSuccess, replay.Error?.ToString());
        Assert.Equal(id, replay.Value.NewTemplateId);
        Assert.Equal(source.Id, replay.Value.DerivedFromTemplateId);

        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await new CloneScheduleTemplateHandler(new RaceRepo(source, byRival), new Store(), new Clock()).HandleAsync(command)).Error);
        Assert.Equal(ShramSafalErrors.ScheduleIdTaken, (await new CloneScheduleTemplateHandler(new RaceRepo(source, otherScope), new Store(), new Clock()).HandleAsync(command)).Error);
    }
}
