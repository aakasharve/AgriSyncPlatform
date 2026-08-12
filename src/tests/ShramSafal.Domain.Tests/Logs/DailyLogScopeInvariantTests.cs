// spec: 2026-07-13-labour-attendance-approval-design
using System.Reflection;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR PHASE 2 — the domain half of "the farmer's spatial assertion is a
/// record, not an absence".
///
/// <para><b>Source of truth for every expectation below</b> is the approved
/// plan <c>docs/superpowers/plans/2026-08-12-labour-phase2-server-truth-farm-context.md</c>
/// §C1-AMENDED (as PATCHED 2026-08-12) and the execution handoff §1 intent
/// table:</para>
///
/// <code>
/// farmer did          scope       plot_ids   plot_id   crop_cycle_id
/// chose one plot      Plot        {A}        A         set
/// chose several       MultiPlot   {A,B,C}    NULL      NULL
/// chose संपूर्ण शेत      Farm        {}         NULL      NULL
/// </code>
///
/// <para><b>Why a domain suite exists at all when a CHECK constraint already
/// guards the row.</b> Two of these rules have no SQL counterpart and never
/// will:</para>
/// <list type="number">
/// <item><b>Duplicate plots.</b> <c>{A,A}</c> satisfies
/// <c>cardinality(plot_ids) &gt;= 2</c>, so the database accepts it. The
/// factory is the ONLY thing that rejects it, and it runs on construction
/// only — EF materialises through the parameterless constructor, so a bad row
/// loaded from the database is never re-checked. Delete the test below and
/// <c>{A,A}</c> becomes storable through any raw-SQL path with nothing
/// anywhere noticing.</item>
/// <item><b>Unexpressibility.</b> The plan's rule is not merely "an invalid
/// pairing is rejected" but "an invalid pairing cannot be <i>written</i>" —
/// <c>CreateForFarm</c> takes no plot or cycle parameter, <c>CreateForMultiPlot</c>
/// takes no single-plot parameter, and no factory takes a scope. That is a
/// statement about the SIGNATURES, so it is asserted against the signatures.
/// A future "simplification" to one general <c>Create(scope, …)</c> would pass
/// every value-based test in this file and still destroy the guarantee.</item>
/// </list>
///
/// <para><b>Independence note.</b> Written from the plan, the handoff §1 table
/// and the P2.1 report's §11.7 checklist of behaviours-needing-a-guard. The
/// factory bodies were not read. Where the plan is silent — specifically the
/// exception TYPE for a rejected set — §11.7 names <see cref="ArgumentException"/>
/// and that is what is asserted; the load-bearing part of each assertion is
/// that construction FAILS and yields no <see cref="DailyLog"/>.</para>
/// </summary>
public sealed class DailyLogScopeInvariantTests
{
    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId AnyOperatorUserId = new(Guid.Parse("44444444-4444-4444-4444-444444444444"));
    private static readonly DateOnly AnyLogDate = new(2026, 8, 12);
    private static readonly DateTime AnyCreatedAtUtc = new(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc);

    private static readonly Guid PlotA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid PlotB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid PlotC = Guid.Parse("cccccccc-0000-0000-0000-00000000000c");
    private static readonly Guid CycleA = Guid.Parse("dddddddd-0000-0000-0000-00000000000d");

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 #14 — Create emits Plot, and satisfies the TIGHTENED Plot branch
    // of ck_daily_logs_scope by construction:
    //   cardinality(plot_ids) = 1 AND plot_id IS NOT NULL
    //   AND crop_cycle_id IS NOT NULL AND plot_ids[1] = plot_id
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void Create_yields_a_Plot_scoped_log_whose_set_and_projection_agree()
    {
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotId: PlotA,
            cropCycleId: CycleA,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

        log.Scope.Should().Be(DailyLogScope.Plot,
            "the V1 factory records one plot, and that is the only scope it can emit");
        log.PlotIds.Should().ContainSingle(
            "the Plot branch of ck_daily_logs_scope demands cardinality(plot_ids) = 1");
        log.PlotIds.Single().Should().Be(PlotA);
        log.PlotId.Should().Be(PlotA,
            "plot_id is the compatibility PROJECTION of the single-plot case, so plot_ids[1] = plot_id — " +
            "two readers, one using plot_id and one using plot_ids, must never return different plots for one log");
        log.CropCycleId.Should().Be(CycleA,
            "a Plot log carries its crop cycle — the tightened CHECK restates a guarantee the column had for its whole life");
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 #13 — CreateForFarm: the empty set is the assertion.
    // Plan Global Constraint 1: never a fabricated plot, never an invented
    // crop cycle, never a sentinel, never "pick the first plot".
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CreateForFarm_asserts_the_whole_farm_and_invents_nothing()
    {
        var log = DailyLog.CreateForFarm(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

        log.Scope.Should().Be(DailyLogScope.Farm);
        log.PlotIds.Should().BeEmpty(
            "संपूर्ण शेत is cardinality ZERO — an empty set, never a sentinel member");
        log.PlotId.Should().BeNull("a plot-less log has no plot and we do not invent one");
        log.CropCycleId.Should().BeNull("nor an invented crop cycle");
        log.PlotIds.Should().NotContain(Guid.Empty,
            "Guid.Empty is the fabricated plot the plan names explicitly — 00000000-… is not 'no plot', it is a lie");
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 (handoff §1) — MultiPlot: ONE engagement, ONE row, the whole
    // selection. Founder decision O-2.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CreateForMultiPlot_keeps_one_engagement_as_one_row_carrying_the_whole_selection()
    {
        var log = DailyLog.CreateForMultiPlot(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotIds: new[] { PlotA, PlotB, PlotC },
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

        log.Scope.Should().Be(DailyLogScope.MultiPlot);
        log.PlotIds.Should().BeEquivalentTo(new[] { PlotA, PlotB, PlotC },
            "the context is the farmer's whole selection — never plot[0], never N separate logs");
        log.PlotId.Should().BeNull(
            "a MultiPlot log has no single plot; picking one would make plot_id disagree with plot_ids");
        log.CropCycleId.Should().BeNull(
            "cross-cycle attribution is DEFERRED (plan §N) — recording a cycle wrongly is worse than recording it as absent");
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 #11 — "several plots" means SEVERAL. Fewer than two is not a
    // MultiPlot engagement; it is a Plot engagement wearing the wrong label,
    // and the database's MultiPlot branch (cardinality >= 2) would reject it.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CreateForMultiPlot_refuses_a_set_that_is_not_several_plots()
    {
        var noPlots = () => MakeMultiPlot(Array.Empty<Guid>());
        var onePlot = () => MakeMultiPlot(new[] { PlotA });

        noPlots.Should().Throw<ArgumentException>(
            "an empty set is the Farm assertion, and it must be made through CreateForFarm where it MEANS that");
        onePlot.Should().Throw<ArgumentException>(
            "one plot is the Plot assertion — a MultiPlot row with cardinality 1 is exactly what ck_daily_logs_scope rejects");
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 #12 — THE INVARIANT WITH NO SQL COUNTERPART.
    // {A,A} passes cardinality(plot_ids) >= 2. If this test is deleted the
    // repeated plot becomes storable and nothing anywhere notices.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CreateForMultiPlot_refuses_a_repeated_plot_which_the_database_cannot_catch()
    {
        var repeatedPair = () => MakeMultiPlot(new[] { PlotA, PlotA });
        var repeatedInsideARealSelection = () => MakeMultiPlot(new[] { PlotA, PlotB, PlotA });

        repeatedPair.Should().Throw<ArgumentException>(
            "a repeated plot is not a second plot — and cardinality(plot_ids) >= 2 is SATISFIED by {A,A}, " +
            "so this factory is the only guard that exists for it anywhere in the system");
        repeatedInsideARealSelection.Should().Throw<ArgumentException>(
            "the same holds when the duplicate hides behind a genuine second plot");
    }

    // ─────────────────────────────────────────────────────────────────────
    // UNEXPRESSIBILITY — asserted against the SIGNATURES, because that is
    // what the rule is about. Handoff §1: "invalid states cannot be
    // expressed"; plan §H / Global Constraint 5: no general Create.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CreateForFarm_offers_no_parameter_through_which_a_plot_or_a_cycle_could_be_supplied()
    {
        var parameters = FactoryParameterNames(nameof(DailyLog.CreateForFarm));

        parameters.Should().NotContain(
            p => p.Contains("plot", StringComparison.OrdinalIgnoreCase),
            "a farm-wide log must not be able to carry a plot at all — refusing one at runtime is weaker than not accepting it");
        parameters.Should().NotContain(
            p => p.Contains("cropcycle", StringComparison.OrdinalIgnoreCase),
            "nor a crop cycle");
    }

    [Fact]
    public void CreateForMultiPlot_offers_no_single_plot_or_crop_cycle_parameter()
    {
        var parameters = FactoryParameterNames(nameof(DailyLog.CreateForMultiPlot));

        parameters.Should().NotContain("plotId",
            "a MultiPlot log's spatial assertion is the SET; a single-plot parameter would let plot_id disagree with plot_ids");
        parameters.Should().NotContain("cropCycleId",
            "a MultiPlot log carries no crop cycle (plan §C1-AMENDED) — cross-cycle attribution is deferred");
        parameters.Should().Contain("plotIds");
    }

    [Fact]
    public void Create_cannot_express_a_plot_scoped_log_that_omits_its_plot_or_its_crop_cycle()
    {
        var create = typeof(DailyLog).GetMethod(nameof(DailyLog.Create), BindingFlags.Public | BindingFlags.Static);
        create.Should().NotBeNull();

        var plotId = create!.GetParameters().Single(p => p.Name == "plotId");
        var cropCycleId = create.GetParameters().Single(p => p.Name == "cropCycleId");

        plotId.ParameterType.Should().Be<Guid>(
            "a NULLABLE plotId here would make 'scope=Plot with no plot' expressible in the domain — " +
            "the Plot branch of the CHECK demands plot_id IS NOT NULL");
        cropCycleId.ParameterType.Should().Be<Guid>(
            "and a nullable cropCycleId would make 'scope=Plot, crop_cycle_id=NULL' expressible — the row " +
            "AddLogTaskHandler then rejects as CropCycleNotFound forever, with nothing saying the row is malformed");
    }

    [Fact]
    public void No_public_factory_accepts_a_scope_so_no_caller_can_pair_a_scope_with_the_wrong_context()
    {
        var scopeTakingFactories = typeof(DailyLog)
            .GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Where(m => m.ReturnType == typeof(DailyLog))
            .Where(m => m.GetParameters().Any(p => p.ParameterType == typeof(DailyLogScope)))
            .Select(m => m.Name)
            .ToArray();

        scopeTakingFactories.Should().BeEmpty(
            "the three named factories are what make an invalid pairing unexpressible. One general " +
            "Create(scope, plotIds, plotId, cropCycleId, …) would re-open every combination the CHECK exists to refuse");
    }

    // ─────────────────────────────────────────────────────────────────────

    private static DailyLog MakeMultiPlot(IReadOnlyCollection<Guid> plotIds)
        => DailyLog.CreateForMultiPlot(
            id: Guid.NewGuid(),
            farmId: AnyFarmId,
            plotIds: plotIds,
            operatorUserId: AnyOperatorUserId,
            logDate: AnyLogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: AnyCreatedAtUtc);

    private static string[] FactoryParameterNames(string factoryName)
    {
        var method = typeof(DailyLog).GetMethod(factoryName, BindingFlags.Public | BindingFlags.Static);
        method.Should().NotBeNull($"{factoryName} is the factory the plan names for this scope");
        return method!.GetParameters().Select(p => p.Name ?? string.Empty).ToArray();
    }
}
