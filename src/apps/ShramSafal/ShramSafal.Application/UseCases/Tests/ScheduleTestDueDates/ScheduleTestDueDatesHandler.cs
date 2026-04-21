using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;

/// <summary>
/// Handler for <see cref="ScheduleTestDueDatesCommand"/>. Walks every
/// <see cref="TestProtocol"/> for the given crop type and materialises
/// <see cref="TestInstance"/> rows per periodicity rule (CEI §4.5):
/// <list type="bullet">
///   <item><see cref="TestProtocolPeriodicity.OneTime"/> → 1 instance on the
///   first matching stage's start date, or the earliest stage start if no
///   stage list is set on the protocol.</item>
///   <item><see cref="TestProtocolPeriodicity.PerStage"/> → 1 instance per
///   attached stage that is also present in <see cref="ScheduleTestDueDatesCommand.Stages"/>.</item>
///   <item><see cref="TestProtocolPeriodicity.EveryNDays"/> → instances
///   repeating every <see cref="TestProtocol.EveryNDays"/> days from the
///   earliest stage start until the latest stage end.</item>
/// </list>
/// Returns the number of <see cref="TestInstance"/>s created.
/// </summary>
public sealed class ScheduleTestDueDatesHandler(
    ITestProtocolRepository testProtocolRepository,
    ITestInstanceRepository testInstanceRepository,
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<int> HandleAsync(
        ScheduleTestDueDatesCommand command,
        CancellationToken ct = default)
    {
        if (command is null ||
            command.CropCycleId == Guid.Empty ||
            command.FarmId.IsEmpty ||
            command.PlotId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.CropType) ||
            command.ActorUserId.IsEmpty ||
            command.Stages is null || command.Stages.Count == 0)
        {
            return 0;
        }

        var protocols = await testProtocolRepository.GetByCropTypeAsync(command.CropType, ct);
        if (protocols is null || protocols.Count == 0)
        {
            return 0;
        }

        var now = clock.UtcNow;
        var stagesByName = command.Stages.ToDictionary(
            s => s.StageName.Trim(),
            s => s,
            StringComparer.OrdinalIgnoreCase);

        var cycleStart = command.Stages.Min(s => s.StartDate);
        var cycleEnd = command.Stages.Max(s => s.EndDate);

        var created = new List<TestInstance>();

        foreach (var protocol in protocols)
        {
            switch (protocol.Periodicity)
            {
                case TestProtocolPeriodicity.OneTime:
                    created.Add(CreateOneTime(protocol, command, stagesByName, cycleStart, now));
                    break;

                case TestProtocolPeriodicity.PerStage:
                    created.AddRange(CreatePerStage(protocol, command, stagesByName, now));
                    break;

                case TestProtocolPeriodicity.EveryNDays:
                    created.AddRange(CreateEveryNDays(protocol, command, cycleStart, cycleEnd, now));
                    break;
            }
        }

        if (created.Count == 0)
        {
            return 0;
        }

        await testInstanceRepository.AddRangeAsync(created, ct);

        var audit = AuditEvent.Create(
            farmId: command.FarmId.Value,
            entityType: "TestInstance",
            entityId: command.CropCycleId,
            action: "test.instances.scheduled",
            actorUserId: command.ActorUserId.Value,
            actorRole: "system",
            payload: new
            {
                cropCycleId = command.CropCycleId,
                farmId = command.FarmId.Value,
                plotId = command.PlotId,
                cropType = command.CropType,
                protocolCount = protocols.Count,
                instanceCount = created.Count,
                instanceIds = created.Select(i => i.Id).ToArray()
            },
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        return created.Count;
    }

    private TestInstance CreateOneTime(
        TestProtocol protocol,
        ScheduleTestDueDatesCommand command,
        Dictionary<string, CropCycleStageInfo> stagesByName,
        DateOnly cycleStart,
        DateTime now)
    {
        string stageName;
        DateOnly dueDate;

        // Prefer the first attached stage that exists in the cycle;
        // otherwise fall back to the cycle start date.
        var matchedStage = protocol.StageNames
            .Select(s => stagesByName.TryGetValue(s, out var info) ? info : null)
            .FirstOrDefault(info => info is not null);

        if (matchedStage is not null)
        {
            stageName = matchedStage.StageName;
            dueDate = matchedStage.StartDate;
        }
        else
        {
            stageName = command.Stages[0].StageName;
            dueDate = cycleStart;
        }

        return TestInstance.Schedule(
            id: idGenerator.New(),
            testProtocolId: protocol.Id,
            protocolKind: protocol.Kind,
            cropCycleId: command.CropCycleId,
            farmId: command.FarmId,
            plotId: command.PlotId,
            stageName: stageName,
            plannedDueDate: dueDate,
            createdAtUtc: now);
    }

    private IEnumerable<TestInstance> CreatePerStage(
        TestProtocol protocol,
        ScheduleTestDueDatesCommand command,
        Dictionary<string, CropCycleStageInfo> stagesByName,
        DateTime now)
    {
        foreach (var stageName in protocol.StageNames)
        {
            if (!stagesByName.TryGetValue(stageName, out var stageInfo))
            {
                continue;
            }

            yield return TestInstance.Schedule(
                id: idGenerator.New(),
                testProtocolId: protocol.Id,
                protocolKind: protocol.Kind,
                cropCycleId: command.CropCycleId,
                farmId: command.FarmId,
                plotId: command.PlotId,
                stageName: stageInfo.StageName,
                plannedDueDate: stageInfo.StartDate,
                createdAtUtc: now);
        }
    }

    private IEnumerable<TestInstance> CreateEveryNDays(
        TestProtocol protocol,
        ScheduleTestDueDatesCommand command,
        DateOnly cycleStart,
        DateOnly cycleEnd,
        DateTime now)
    {
        if (protocol.EveryNDays is not int interval || interval <= 0)
        {
            yield break;
        }

        var dueDate = cycleStart;
        while (dueDate <= cycleEnd)
        {
            // Tag the instance with the stage that contains this due date
            // (fall back to the first stage if none match).
            var stage = command.Stages
                .FirstOrDefault(s => dueDate >= s.StartDate && dueDate <= s.EndDate)
                ?? command.Stages[0];

            yield return TestInstance.Schedule(
                id: idGenerator.New(),
                testProtocolId: protocol.Id,
                protocolKind: protocol.Kind,
                cropCycleId: command.CropCycleId,
                farmId: command.FarmId,
                plotId: command.PlotId,
                stageName: stage.StageName,
                plannedDueDate: dueDate,
                createdAtUtc: now);

            dueDate = dueDate.AddDays(interval);
        }
    }
}
