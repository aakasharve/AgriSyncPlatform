using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class ScheduleTestDueDatesHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmIdValue = new(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    private static readonly Guid PlotIdValue = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CropCycleIdValue = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static ScheduleTestDueDatesHandler CreateHandler(
        out FakeTestProtocolRepository protoRepo,
        out FakeTestInstanceRepository instanceRepo,
        out FakeAuditOnlyRepository auditRepo)
    {
        protoRepo = new FakeTestProtocolRepository();
        instanceRepo = new FakeTestInstanceRepository();
        auditRepo = new FakeAuditOnlyRepository();
        return new ScheduleTestDueDatesHandler(
            protoRepo, instanceRepo, auditRepo,
            new FakeIdGenerator(), new FakeClock(Now));
    }

    private static ScheduleTestDueDatesCommand MakeCommand(IReadOnlyList<CropCycleStageInfo> stages) =>
        new(
            CropCycleId: CropCycleIdValue,
            FarmId: FarmIdValue,
            PlotId: PlotIdValue,
            CropType: "Grapes",
            Stages: stages,
            ActorUserId: UserId.New());

    [Fact]
    public async Task ScheduleTestDueDates_OneTime_CreatesSingleInstance()
    {
        var handler = CreateHandler(out var protoRepo, out var instanceRepo, out var auditRepo);

        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Pre-flower soil", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            UserId.New(), Now);
        proto.AttachToStage("PreFlowering");
        protoRepo.Seed(proto);

        var stages = new[]
        {
            new CropCycleStageInfo("PreFlowering", new DateOnly(2026, 5, 1), new DateOnly(2026, 5, 15)),
            new CropCycleStageInfo("Flowering",    new DateOnly(2026, 5, 16), new DateOnly(2026, 5, 31))
        };

        var count = await handler.HandleAsync(MakeCommand(stages));

        count.Should().Be(1);
        instanceRepo.Added.Should().HaveCount(1);
        var inst = instanceRepo.Added[0];
        inst.TestProtocolId.Should().Be(proto.Id);
        inst.ProtocolKind.Should().Be(TestProtocolKind.Soil);
        inst.CropCycleId.Should().Be(CropCycleIdValue);
        inst.FarmId.Should().Be(FarmIdValue);
        inst.PlotId.Should().Be(PlotIdValue);
        inst.StageName.Should().Be("PreFlowering");
        inst.PlannedDueDate.Should().Be(new DateOnly(2026, 5, 1));
        inst.Status.Should().Be(TestInstanceStatus.Due);

        auditRepo.AuditEvents.Should().HaveCount(1);
        auditRepo.AuditEvents[0].Action.Should().Be("test.instances.scheduled");
    }

    [Fact]
    public async Task ScheduleTestDueDates_PerStage_CreatesOnePerAttachedStage()
    {
        var handler = CreateHandler(out var protoRepo, out var instanceRepo, out _);

        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Per-stage petiole", "Grapes",
            TestProtocolKind.Petiole, TestProtocolPeriodicity.PerStage,
            UserId.New(), Now);
        proto.AttachToStage("Flowering");
        proto.AttachToStage("Veraison");
        // "Harvest" is attached but not present in the cycle — should be skipped
        proto.AttachToStage("Harvest");
        protoRepo.Seed(proto);

        var stages = new[]
        {
            new CropCycleStageInfo("PreFlowering", new DateOnly(2026, 5, 1),  new DateOnly(2026, 5, 15)),
            new CropCycleStageInfo("Flowering",    new DateOnly(2026, 5, 16), new DateOnly(2026, 5, 31)),
            new CropCycleStageInfo("Veraison",     new DateOnly(2026, 6, 1),  new DateOnly(2026, 6, 20))
        };

        var count = await handler.HandleAsync(MakeCommand(stages));

        count.Should().Be(2);
        instanceRepo.Added.Should().HaveCount(2);
        instanceRepo.Added.Select(i => i.StageName).Should().BeEquivalentTo(new[] { "Flowering", "Veraison" });
        instanceRepo.Added.Single(i => i.StageName == "Flowering").PlannedDueDate.Should().Be(new DateOnly(2026, 5, 16));
        instanceRepo.Added.Single(i => i.StageName == "Veraison").PlannedDueDate.Should().Be(new DateOnly(2026, 6, 1));
        instanceRepo.Added.Should().OnlyContain(i => i.ProtocolKind == TestProtocolKind.Petiole);
    }

    [Fact]
    public async Task ScheduleTestDueDates_EveryNDays_CreatesRepeatingInstances()
    {
        var handler = CreateHandler(out var protoRepo, out var instanceRepo, out _);

        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Weekly residue", "Grapes",
            TestProtocolKind.Residue, TestProtocolPeriodicity.EveryNDays,
            UserId.New(), Now, everyNDays: 7);
        protoRepo.Seed(proto);

        // 15-day window → should produce due dates on day 0, 7, 14 = 3 instances.
        var stages = new[]
        {
            new CropCycleStageInfo("Harvest", new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 15))
        };

        var count = await handler.HandleAsync(MakeCommand(stages));

        count.Should().Be(3);
        instanceRepo.Added.Should().HaveCount(3);
        instanceRepo.Added.Select(i => i.PlannedDueDate).Should().BeEquivalentTo(new[]
        {
            new DateOnly(2026, 7, 1),
            new DateOnly(2026, 7, 8),
            new DateOnly(2026, 7, 15)
        });
        instanceRepo.Added.Should().OnlyContain(i => i.ProtocolKind == TestProtocolKind.Residue);
        instanceRepo.Added.Should().OnlyContain(i => i.StageName == "Harvest");
    }

    [Fact]
    public async Task ScheduleTestDueDates_NoProtocolsForCrop_ReturnsZero()
    {
        var handler = CreateHandler(out _, out var instanceRepo, out var auditRepo);

        var stages = new[]
        {
            new CropCycleStageInfo("Flowering", new DateOnly(2026, 5, 1), new DateOnly(2026, 5, 15))
        };

        var count = await handler.HandleAsync(MakeCommand(stages));

        count.Should().Be(0);
        instanceRepo.Added.Should().BeEmpty();
        auditRepo.AuditEvents.Should().BeEmpty();
    }
}
