// spec: 2026-07-13-labour-attendance-approval-design
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR PHASE 2 — the <b>HTTP entry path's</b> half of the scope gate.
///
/// <para><b>Why this suite exists separately from the sync tests.</b> The two
/// entry paths do not share a gate. <c>POST /logs</c> resolves
/// <c>IHandler&lt;CreateDailyLogCommand, DailyLogDto&gt;</c> — the pipeline,
/// whose first behaviour is <see cref="CreateDailyLogValidator"/>. <c>/sync/push</c>
/// deliberately resolves the RAW handler and skips the pipeline entirely, so a
/// test that exercises one path proves nothing whatsoever about the other. A
/// scope accepted over sync and rejected by the validator (or the reverse) is a
/// perfectly plausible half-landing, and only a test on each side catches it.</para>
///
/// <para><b>What is asserted.</b> The three honest shapes from the handoff §1
/// intent table are accepted, and the self-contradictory ones are rejected —
/// stated as "the validator produced at least one error" rather than as a
/// message, because the wording is not the contract. Also pinned: the
/// pre-Phase-2 <c>Guid.Empty</c> gate on a plot-scoped command, which is the
/// regression that matters most — ordinary single-plot logging must be exactly
/// as strict as it was at <c>labour-v1-green</c>.</para>
///
/// <para><b>Independence note.</b> Derived from the approved plan §C1-AMENDED,
/// handoff §1, and the P2.2 report's owed-coverage list (§10 item 4). The
/// validator body was not read.</para>
/// </summary>
public sealed class CreateDailyLogValidatorScopeTests
{
    private static readonly Guid Farm = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid PlotA = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");
    private static readonly Guid PlotB = Guid.Parse("aaaa1115-1111-1111-1111-111111111111");
    private static readonly Guid CycleA = Guid.Parse("aaaa1116-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");

    // ── ACCEPTED — the three shapes the farmer can actually assert ────────

    [Fact]
    public void A_plot_scoped_command_in_the_Labour_V1_shape_is_still_accepted()
        => Validate(MakeCommand(scope: DailyLogScope.Plot, plotId: PlotA, cropCycleId: CycleA))
            .Should().BeEmpty("single-plot logging must behave exactly as it did before Phase 2");

    [Fact]
    public void A_farm_scoped_command_is_accepted_over_the_HTTP_entry_path()
        => Validate(MakeCommand(scope: DailyLogScope.Farm, plotId: null, cropCycleId: null))
            .Should().BeEmpty("संपूर्ण शेत is a first-class assertion — the validator was the gate that used to reject it");

    [Fact]
    public void A_multi_plot_command_carrying_two_plots_is_accepted()
        => Validate(MakeCommand(
                scope: DailyLogScope.MultiPlot, plotId: null, cropCycleId: null,
                plotIds: new[] { PlotA, PlotB }))
            .Should().BeEmpty("one shared engagement across several plots is ONE command");

    // ── REJECTED — a command that contradicts itself ──────────────────────

    [Fact]
    public void A_farm_scoped_command_carrying_a_plot_is_rejected_rather_than_silently_trimmed()
        => Validate(MakeCommand(scope: DailyLogScope.Farm, plotId: PlotA, cropCycleId: null))
            .Should().NotBeEmpty(
                "quietly dropping the plot would discard part of what the farmer said; a client bug must fail loudly");

    [Fact]
    public void A_multi_plot_command_naming_only_one_plot_is_rejected()
        => Validate(MakeCommand(scope: DailyLogScope.MultiPlot, plotId: null, cropCycleId: null, plotIds: new[] { PlotA }))
            .Should().NotBeEmpty("cardinality >= 2 is what MultiPlot MEANS — one plot is a Plot log mislabelled");

    // ── THE V1 REGRESSION GATE — unchanged strictness on the plot path ────

    [Fact]
    public void A_plot_scoped_command_with_an_empty_plot_id_is_still_rejected()
        => Validate(MakeCommand(scope: DailyLogScope.Plot, plotId: Guid.Empty, cropCycleId: CycleA))
            .Should().NotBeEmpty("Guid.Empty is the fabricated plot doctrine P4 forbids, not a missing one");

    [Fact]
    public void A_plot_scoped_command_with_an_empty_crop_cycle_id_is_still_rejected()
        => Validate(MakeCommand(scope: DailyLogScope.Plot, plotId: PlotA, cropCycleId: Guid.Empty))
            .Should().NotBeEmpty("the Plot branch of ck_daily_logs_scope demands crop_cycle_id IS NOT NULL");

    [Fact]
    public void A_plot_scoped_command_with_no_plot_at_all_is_rejected()
        => Validate(MakeCommand(scope: DailyLogScope.Plot, plotId: null, cropCycleId: CycleA))
            .Should().NotBeEmpty(
                "nullability was widened so MultiPlot and Farm could exist — it must not have loosened the Plot path");

    [Fact]
    public void A_command_with_no_farm_is_rejected_whatever_its_scope()
    {
        Validate(MakeCommand(scope: DailyLogScope.Farm, plotId: null, cropCycleId: null, farmId: Guid.Empty))
            .Should().NotBeEmpty("a farm-wide log without a farm asserts nothing at all");
        Validate(MakeCommand(scope: DailyLogScope.Plot, plotId: PlotA, cropCycleId: CycleA, farmId: Guid.Empty))
            .Should().NotBeEmpty();
    }

    // ─────────────────────────────────────────────────────────────────────

    private static IReadOnlyList<AgriSync.BuildingBlocks.Results.Error> Validate(CreateDailyLogCommand command)
        => new CreateDailyLogValidator().Validate(command).ToList();

    private static CreateDailyLogCommand MakeCommand(
        DailyLogScope scope,
        Guid? plotId,
        Guid? cropCycleId,
        IReadOnlyList<Guid>? plotIds = null,
        Guid? farmId = null)
        => new(
            FarmId: farmId ?? Farm,
            PlotId: plotId,
            CropCycleId: cropCycleId,
            RequestedByUserId: Actor,
            OperatorUserId: Actor,
            LogDate: new DateOnly(2026, 8, 12),
            Location: null,
            DeviceId: "device-scope-validator",
            ClientRequestId: "req-scope-validator",
            Scope: scope,
            PlotIds: plotIds);
}
