// spec: 2026-08-25-prod-cutover-waves
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// The <b>HTTP entry path's</b> half of the worker-name bound ("बरोबर doesn't save the
/// name"). <c>POST /logs</c> threads the same generated <see cref="LabourItem"/> as
/// <c>/sync/push</c>, but only <c>/sync/push</c> runs
/// <c>PushSyncBatchHandler.ValidateLabourWorkerNames</c>, and <c>/sync/push</c> skips this
/// pipeline — so each path needs its own gate, and each gate its own test.
///
/// <para>Same posture as the push boundary: shape and size only. Blank and null entries
/// are "no name" (P9), and names out-numbering the stated headcount are accepted (P7).</para>
/// </summary>
public sealed class CreateDailyLogValidatorWorkerNamesTests
{
    private static readonly Guid Farm = Guid.Parse("bbbb1111-1111-1111-1111-111111111111");
    private static readonly Guid Plot = Guid.Parse("bbbb1114-1111-1111-1111-111111111111");
    private static readonly Guid Cycle = Guid.Parse("bbbb1116-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("bbbb1113-1111-1111-1111-111111111111");

    [Fact]
    public void A_command_with_no_labour_or_no_names_is_accepted_exactly_as_before()
    {
        Validate(null).Should().BeEmpty();
        Validate(Item(names: null)).Should().BeEmpty();
        Validate(Item(names: [])).Should().BeEmpty();
    }

    [Fact]
    public void Names_at_the_bounds_are_accepted()
    {
        var full = Enumerable.Range(0, LabourAssignmentFactory.MaxWorkerNamesPerEngagement)
            .Select(i => $"n{i}").ToList();
        var longest = new string('अ', LabourAssignmentFactory.MaxWorkerNameLength);

        Validate(Item(full)).Should().BeEmpty();
        Validate(Item([longest])).Should().BeEmpty();
    }

    [Fact]
    public void Blank_null_and_padded_names_are_not_malformed()
    {
        var padded = $"   {new string('अ', LabourAssignmentFactory.MaxWorkerNameLength)}   ";

        Validate(Item(["", "   ", null!, padded])).Should().BeEmpty(
            "blank is 'no name' and the length is measured after trimming — an optional field never rejects a day (P9)");
    }

    [Fact]
    public void More_names_than_the_stated_headcount_is_not_a_reason_to_refuse()
        => Validate(Item(["रमेश", "सीता", "गणेश"], workerCount: 1)).Should().BeEmpty(
            "the count is the farmer's statement and names are an overlay on it (P7)");

    [Fact]
    public void One_name_too_many_is_refused()
    {
        var tooMany = Enumerable.Range(0, LabourAssignmentFactory.MaxWorkerNamesPerEngagement + 1)
            .Select(i => $"n{i}").ToList();

        Validate(Item(tooMany)).Should().NotBeEmpty();
    }

    [Fact]
    public void One_character_too_long_is_refused_even_on_a_later_engagement()
    {
        var command = MakeCommand([
            new LabourItem(Guid.NewGuid(), "hired_daily", WorkerCount: 2, WorkerNames: ["रमेश"]),
            new LabourItem(Guid.NewGuid(), "hired_daily", WorkerCount: 2,
                WorkerNames: [new string('अ', LabourAssignmentFactory.MaxWorkerNameLength + 1)]),
        ]);

        new CreateDailyLogValidator().Validate(command).Should().NotBeEmpty();
    }

    // ─────────────────────────────────────────────────────────────────────

    private static IReadOnlyList<LabourItem> Item(IReadOnlyList<string>? names, int? workerCount = 8)
        => [new LabourItem(Guid.NewGuid(), "hired_daily", WorkerCount: workerCount, WorkerNames: names)];

    private static IReadOnlyList<AgriSync.BuildingBlocks.Results.Error> Validate(IReadOnlyList<LabourItem>? labour)
        => new CreateDailyLogValidator().Validate(MakeCommand(labour)).ToList();

    private static CreateDailyLogCommand MakeCommand(IReadOnlyList<LabourItem>? labour)
        => new(
            FarmId: Farm,
            PlotId: Plot,
            CropCycleId: Cycle,
            RequestedByUserId: Actor,
            OperatorUserId: Actor,
            LogDate: new DateOnly(2026, 10, 17),
            Location: null,
            DeviceId: "device-names-validator",
            ClientRequestId: "req-names-validator",
            Labour: labour,
            Scope: DailyLogScope.Plot);
}
