// spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6, §11.7; orchestrator calls 2026-11-02) — which plots one
// person's place on a farm covers, proved on a real Postgres as agrisync_app (E3 first) through the real host, the real
// routes and the real push path, with every cursor sent the way a phone sends it (whole seconds, fed from each answer):
//   A. a since=0 pull hands each person only what his plots allow — content, not just ids: a मुकादम on {P2, P4} gets his
//      plots, their seasons, records, money (his share of a split bill, never the bill), photos, tasks, tests, planned
//      work, attention and warnings, and none of P1 / P3 / the whole farm's (an id, a word, an amount, a plot name);
//      an own-work seat gets the plot and crop NAMES and his own work only; हजेरी stays the farm-day's;
//   B. a narrowing is delivered ONCE and widening re-sends ONCE (no loop, no skip), whole-second cursors;
//   C. a write naming a plot outside his plots is refused with a visible code and nothing is written; an own-work seat
//      logs on any plot;
//   D. the REST reads follow the plots; his totals are his plots' only, and say so;
//   E. tenancy both ways (E4): a plot of another farm and a scope set by anyone but the holder are refused.
// Written against the 1ac567a0 surface only (routes, raw mutation names, raw JSON), so the same file runs red there.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class PlotScopeRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    // P1 is the base farm's PlotA (and CycleA); P2–P4 are added here.
    private static readonly Guid P2 = Guid.Parse("3d040000-0000-4000-8000-0000000000c2");
    private static readonly Guid P3 = Guid.Parse("3d040000-0000-4000-8000-0000000000c3");
    private static readonly Guid P4 = Guid.Parse("3d040000-0000-4000-8000-0000000000c4");
    private static readonly Guid CycleP2 = Guid.Parse("3d040000-0000-4000-8000-0000000000d2");
    private static readonly Guid OwnWorker = Guid.Parse("3d040000-0000-4000-8000-000000000018");

    private static readonly Guid P2Log = Guid.Parse("3d040000-0000-4000-8000-000000000201");
    private static readonly Guid P12Log = Guid.Parse("3d040000-0000-4000-8000-000000000202");
    private static readonly Guid FarmLogOwner = Guid.Parse("3d040000-0000-4000-8000-000000000203");
    private static readonly Guid FarmLogMukadam = Guid.Parse("3d040000-0000-4000-8000-000000000204");
    private static readonly Guid P2Private = Guid.Parse("3d040000-0000-4000-8000-000000000205");
    private static readonly Guid P2LogPhoto = Guid.Parse("3d040000-0000-4000-8000-000000000206");
    private static readonly Guid CostP2 = Guid.Parse("3d040000-0000-4000-8000-000000000207");
    private static readonly Guid BillP2 = Guid.Parse("3d040000-0000-4000-8000-000000000208");
    private static readonly Guid BillShared = Guid.Parse("3d040000-0000-4000-8000-000000000209");
    private static readonly Guid SplitBill = Guid.Parse("3d040000-0000-4000-8000-00000000020a");
    private static readonly Guid SplitLedger = Guid.Parse("3d040000-0000-4000-8000-00000000020b");
    private static readonly Guid SplitShareP1 = Guid.Parse("3d040000-0000-4000-8000-00000000020c");
    private static readonly Guid SplitShareP2 = Guid.Parse("3d040000-0000-4000-8000-00000000020d");
    private static readonly Guid Unallocated = Guid.Parse("3d040000-0000-4000-8000-00000000020e");
    private static readonly Guid JobCardP2 = Guid.Parse("3d040000-0000-4000-8000-00000000020f");
    private static readonly Guid TestP2 = Guid.Parse("3d040000-0000-4000-8000-000000000210");
    private static readonly Guid PlannedP2 = Guid.Parse("3d040000-0000-4000-8000-000000000211");
    private static readonly Guid SignalP1 = Guid.Parse("3d040000-0000-4000-8000-000000000212");
    private static readonly Guid SignalP2 = Guid.Parse("3d040000-0000-4000-8000-000000000213");
    private static readonly Guid LaterP1Log = Guid.Parse("3d040000-0000-4000-8000-000000000214");

    private const string P2Name = "प्लॉट-दोन";
    private const string P3Name = "प्लॉट-तीन";
    private const string P4Name = "प्लॉट-चार";
    private const string P1Name = "प्लॉट A";
    private const string OwnWorkerName = "स्वतःचे-काम-दत्ता";

    private const decimal P2InputCost = 2525.25m;
    private const decimal P12InputCost = 1717.17m;
    private const decimal FarmOwnerInputCost = 1919.19m;
    private const decimal P2PrivateInputCost = 2929.29m;
    private const decimal CostP2Amount = 2222.41m;
    private const decimal SplitAmount = 6000.84m;
    private const decimal SplitP1Share = 3500.51m;
    private const decimal SplitP2Share = 2500.33m;
    private const decimal UnallocatedAmount = 1313.17m;
    private const decimal JobRateP2 = 2741.19m;

    private const string FarmOwnerProduct = "संपूर्ण-शेत-खत";
    private const string P2PrivateProduct = "गुप्त-प्लॉट-दोन";
    private const string MukadamFarmProduct = "मुकादम-शेत-काम";

    private const string Forbidden = "ShramSafal.PlotScope.Forbidden";

    /// <summary>
    /// Everything outside the मुकादम's {P2, P4} that must appear NOWHERE in his body (ids). The split bill's own id is the
    /// one exception, and only as the reference its P2 share line carries (sourceCostEntryId: the line belongs to that bill,
    /// and a later withdrawal of the bill removes the line on his phone); the bill row itself, its amount, its words and its
    /// P1 share never reach him (asserted below).
    /// </summary>
    private static readonly Guid[] OutsideMukadamIds =
    [
        PlotA, P3, CycleA, OwnerLog, MukadamLog, WorkerLog, Worker2Log, FarmLogOwner, P2Private, Cost, Unallocated,
        JobCard, TestRecord, Planned, SignalP1, OwnerLogPhoto, Receipt, FarmPhoto, BillShared, WorkerLogPhoto, Ledger,
        SplitShareP1,
    ];

    /// <summary>…and the words, amounts and names that belong only to what lies outside them.</summary>
    private static readonly string[] OutsideMukadamText =
    [
        P1Name, P3Name, FarmOwnerProduct, P2PrivateProduct,
        "9876.54", "777.73", "432.17", "3457.36", "6129.37", // P1: the cost, the owner's record's input, wage and crew total, the task's rate
        "1717.17", // the P1+P2 record's own amount (the whole record's, across a plot not his)
        "1919.19", "2929.29", "6000.84", "3500.51", "1313.17",
    ];

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_since_zero_pull_hands_each_person_only_what_his_plots_allow()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmAsync();
        await SetScopesAsync();

        // The owner (primary account holder): every plot and everything on it.
        var (ownerBody, owner) = await PullAsync(Owner);
        Keep("owner", ownerBody);
        IdsOf(owner, "plots").Should().Contain([PlotA, P2, P3, P4]);
        IdsOf(owner, "dailyLogs").Should().Contain([OwnerLog, P2Log, P12Log, FarmLogOwner, FarmLogMukadam, P2Private]);
        IdsOf(owner, "costEntries").Should().Contain([Cost, CostP2, SplitBill, Unallocated]);
        CardPlots(owner).Should().Contain([PlotA, P2]);

        // The सहमालक on every plot, with money: every plot, every record, the whole bill.
        var (coBody, co) = await PullAsync(CoOwner);
        IdsOf(co, "plots").Should().Contain([PlotA, P2, P3, P4]);
        IdsOf(co, "dailyLogs").Should().Contain([OwnerLog, P2Log, P12Log, FarmLogOwner, P2Private]);
        IdsOf(co, "costEntries").Should().Contain([Cost, CostP2, SplitBill, Unallocated]);
        coBody.Should().Contain("6000.84").And.Contain("3500.51");
        ScopeOf(co).GetProperty("plotScope").GetString().Should().Be("AllPlots");

        // The मुकादम on {P2, P4}, with see money and take हजेरी.
        var (mBody, m) = await PullAsync(Mukadam);
        Keep("mukadam", mBody);
        IdsOf(m, "plots").Where(id => id != PlotB).Should().BeEquivalentTo([P2, P4], "only his plots");
        mBody.Should().Contain(P2Name).And.Contain(P4Name);
        IdsOf(m, "cropCycles").Should().BeEquivalentTo([CycleP2], "only the seasons on his plots");
        IdsOf(m, "dailyLogs").Should().BeEquivalentTo(
            [P2Log, P12Log, FarmLogMukadam],
            "a record on one of his plots, narrowed; a whole-farm record only when he made it");
        var spanning = ArrayOf(m, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == P12Log);
        spanning.GetProperty("plotIds").EnumerateArray().Select(p => p.GetGuid()).Should().Equal([P2], "narrowed to his plots");
        IdsOf(m, "costEntries").Should().Contain(CostP2).And.NotContain(SplitBill).And.NotContain(Unallocated);
        mBody.Should().Contain("2222.41").And.Contain("2525.25", "his plots' money");
        var share = ArrayOf(m, "dayLedgers").Single(l => l.GetProperty("id").GetGuid() == SplitLedger);
        share.GetProperty("allocations").EnumerateArray().Select(a => a.GetProperty("plotId").GetGuid())
            .Should().Equal([P2], "a split bill reaches him as his share line only (D-39)");
        mBody.Should().Contain("2500.33");
        share.GetProperty("sourceCostEntryId").GetGuid().Should().Be(SplitBill);
        mBody.Split(SplitBill.ToString()).Length.Should().Be(2, "the bill's id appears once: as his share line's reference");
        mBody.Should().NotContain("खर्च-6000.84", "the bill's own words never reach him");
        IdsOf(m, "attachments").Should().Contain([P2LogPhoto, BillP2]);
        IdsOf(m, "jobCards").Should().BeEquivalentTo([JobCardP2], "the tasks on his plots (their rates follow see wages, MU-3)");
        IdsOf(m, "testInstances", "testInstanceId").Should().BeEquivalentTo([TestP2]);
        IdsOf(m, "plannedActivities").Should().BeEquivalentTo([PlannedP2]);
        IdsOf(m, "complianceSignals").Should().BeEquivalentTo([SignalP2]);
        CardPlots(m).Should().OnlyContain(p => p == P2 || p == P4).And.Contain(P2, "attention about his plots");
        IdsOf(m, "attendanceMarks").Should().Contain(Mark, "हजेरी stays the farm-day's: he takes it whatever his plots");
        var mScope = ScopeOf(m);
        mScope.GetProperty("plotScope").GetString().Should().Be("ChosenPlots");
        mScope.GetProperty("plotIds").EnumerateArray().Select(p => p.GetGuid()).Should().BeEquivalentTo([P2, P4]);
        foreach (var id in OutsideMukadamIds)
        {
            mBody.Should().NotContain(id.ToString(), $"{id} lies outside his plots, and must appear nowhere in his body");
        }

        foreach (var text in OutsideMukadamText)
        {
            mBody.Should().NotContain(text, $"'{text}' belongs to what lies outside his plots");
        }

        // The own-work seat (a मुकादम label, स्वतःचं काम scope): the farm's crop and plot NAMES, his own work, nothing else.
        var (oBody, o) = await PullAsync(OwnWorker);
        Keep("own-work", oBody);
        IdsOf(o, "plots").Where(id => id != PlotB).Should().BeEquivalentTo([PlotA, P2, P3, P4], "every plot's name, to log on any");
        IdsOf(o, "cropCycles").Should().Contain([CycleA, CycleP2]);
        IdsOf(o, "dailyLogs").Should().BeEmpty("nothing of other people's records");
        IdsOf(o, "costEntries").Should().BeEmpty("nothing of other people's money");
        IdsOf(o, "jobCards").Should().BeEmpty("no task is assigned to him");
        ScopeOf(o).GetProperty("ownRecordsOnly").GetBoolean().Should().BeTrue("one own-records rule with the कामगार label");
        ScopeOf(o).GetProperty("plotScope").GetString().Should().Be("OwnWork");
        foreach (var text in new[] { "9876.54", "2222.41", "6000.84", "2525.25", FarmOwnerProduct, MukadamFarmProduct })
        {
            oBody.Should().NotContain(text);
        }

        // The कामगार label: his own records only, exactly as MU-3 built it.
        var (_, w) = await PullAsync(Worker);
        IdsOf(w, "dailyLogs").Should().Equal([WorkerLog]);
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The मुकादम's phone pulls again and again, each time sending back the previous answer's cursor rounded DOWN to the
    /// whole second. The owner narrows him to {P2, P4}: the next answer says so (his phone purges by it) and carries only
    /// his plots; the one after re-sends nothing. A P1 record made while he is narrowed never reaches him. The owner widens
    /// him again: P1 comes back (with the record made meanwhile — never a skip) in exactly ONE answer (never a loop).
    /// </summary>
    [Fact]
    public async Task B_a_narrowing_and_a_widening_each_move_once_with_whole_second_cursors()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmAsync();

        var (_, first) = await PullAsync(Mukadam);
        IdsOf(first, "dailyLogs").Should().Contain(OwnerLog, "every plot, before any choice");
        var cursor = Cursor(first);

        await NextWholeSecondAsync();
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        await PastTheChangeSecondAsync();
        await PushAppliedAsync(Owner, "create_daily_log", "mu4-later-p1", Log(LaterP1Log, Owner, PlotA, CycleA, "नंतर-पहिला", null));

        var (narrowBody, narrow) = await PullAsync(Mukadam, cursor);
        ScopeOf(narrow).GetProperty("plotScope").GetString().Should().Be("ChosenPlots", "the answer names his plots: the phone purges by it");
        IdsOf(narrow, "plots").Where(id => id != PlotB).Should().BeEquivalentTo([P2, P4]);
        IdsOf(narrow, "dailyLogs").Should().Contain(P2Log).And.NotContain(OwnerLog).And.NotContain(LaterP1Log);
        narrowBody.Should().NotContain(LaterP1Log.ToString()).And.NotContain("9876.54");
        cursor = Cursor(narrow);

        var (_, quiet) = await PullAsync(Mukadam, cursor);
        IdsOf(quiet, "dailyLogs").Should().BeEmpty("the narrowing was delivered once: nothing is re-sent");
        IdsOf(quiet, "plots").Should().BeEmpty();
        cursor = Cursor(quiet);

        await NextWholeSecondAsync();
        await SetPlotScopeAsync(Mukadam, "AllPlots");
        await PastTheChangeSecondAsync();

        var (_, widen) = await PullAsync(Mukadam, cursor);
        IdsOf(widen, "dailyLogs").Should().Contain([OwnerLog, LaterP1Log], "a widening re-sends what he may now read, never a skip");
        IdsOf(widen, "plots").Should().Contain(PlotA);
        cursor = Cursor(widen);

        var (_, after) = await PullAsync(Mukadam, cursor);
        IdsOf(after, "dailyLogs").Should().BeEmpty("re-sent once, never a loop");
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task C_a_write_naming_a_plot_outside_his_plots_is_refused_visibly_and_own_work_logs_anywhere()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmAsync();
        await SetScopesAsync();

        var onP1 = Guid.NewGuid();
        var refused = await PushAsync(Mukadam, "create_daily_log", "mu4-mukadam-p1", Log(onP1, Mukadam, PlotA, CycleA, "बाहेरचं-काम", null));
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be(Forbidden, "a code every phone parks visibly (its last segment is FORBIDDEN)");

        var spanning = Guid.NewGuid();
        var refusedSpan = await PushAsync(Mukadam, "create_daily_log", "mu4-mukadam-p1p2", MultiPlotLog(spanning, Mukadam, [P2, PlotA], null));
        refusedSpan.ErrorCode.Should().Be(Forbidden, "a record that names one plot outside his plots");

        var costOnP1 = Guid.NewGuid();
        var refusedCost = await PushAsync(Mukadam, "add_cost_entry", "mu4-mukadam-cost-p1", Money(costOnP1, PlotA, CycleA, 4411.22m, []));
        refusedCost.ErrorCode.Should().Be(Forbidden);

        var confirm = await PushAsync(Mukadam, "verify_log_v2", "mu4-mukadam-confirm-p1", new Dictionary<string, object?>
        {
            ["logId"] = OwnerLog,
            ["verifierUserId"] = Mukadam,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        });
        confirm.ErrorCode.Should().Be(Forbidden, "a change to a record on a plot not his");

        var onP2 = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "create_daily_log", "mu4-mukadam-p2", Log(onP2, Mukadam, P2, CycleP2, "माझ्या-प्लॉटचे-काम", null));

        var ownWorkLog = Guid.NewGuid();
        await PushAppliedAsync(OwnWorker, "create_daily_log", "mu4-ownwork-p1", Log(ownWorkLog, OwnWorker, PlotA, CycleA, "कोणत्याही-प्लॉटवर", null));

        var (ownerBody, owner) = await PullAsync(Owner);
        IdsOf(owner, "dailyLogs").Should().Contain([onP2, ownWorkLog]).And.NotContain(onP1).And.NotContain(spanning);
        IdsOf(owner, "costEntries").Should().NotContain(costOnP1);
        ownerBody.Should().NotContain("4411.22", "nothing of a refused write is written");

        var (_, own) = await PullAsync(OwnWorker);
        IdsOf(own, "dailyLogs").Should().Equal([ownWorkLog], "his own work, on any plot");
    }

    // ── D ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task D_the_rest_reads_follow_his_plots_and_his_totals_are_his_plots_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmAsync();
        await SetScopesAsync();

        var (_, pull) = await PullAsync(Mukadam);
        var hisMoney = ArrayOf(pull, "costEntries").Sum(c => c.GetProperty("amount").GetDecimal());
        // lane MU-4 fix pass 1 (L3) — and his share lines of a split bill, as /finance/plot-summary counts them.
        var hisShares = ArrayOf(pull, "dayLedgers")
            .SelectMany(l => l.GetProperty("allocations").EnumerateArray())
            .Sum(a => a.GetProperty("allocatedAmount").GetDecimal());

        var (summaryStatus, summary) = await GetAsync(Mukadam, "/shramsafal/finance/summary?groupBy=plot");
        summaryStatus.Should().Be(HttpStatusCode.OK, summary);
        var summaryRoot = JsonDocument.Parse(summary).RootElement;
        summaryRoot.GetProperty("grandTotal").GetDecimal().Should().Be(hisMoney + hisShares, "his plots' money only, his split share counted (L3)");
        summaryRoot.GetProperty("scopedToPlots").GetBoolean().Should().BeTrue("the phone labels it तुमच्या प्लॉटचे");
        summaryRoot.GetProperty("recordsNotCounted").GetInt32().Should().Be(0, "another plot's money is not 'left out by rule'");
        summary.Should().NotContain(PlotA.ToString()).And.NotContain("9876.54");

        (await GetAsync(Mukadam, $"/shramsafal/finance/plot-summary?plotId={PlotA}")).Status.Should().Be(HttpStatusCode.Forbidden);
        var (plotStatus, plotSummary) = await GetAsync(Mukadam, $"/shramsafal/finance/plot-summary?plotId={P2}");
        plotStatus.Should().Be(HttpStatusCode.OK, plotSummary);
        JsonDocument.Parse(plotSummary).RootElement.GetProperty("allocatedCosts").GetDecimal()
            .Should().Be(SplitP2Share, "his share of the split bill, never the whole bill");

        // The one-record gate every single-record door asks (original voice, transitions, /ai/jobs, a change), asked exactly
        // as those routes ask it, with his farm claim (the transitions route itself opens no claim in a test host).
        foreach (var (log, his) in new[] { (OwnerLog, false), (P12Log, true), (P2Log, true), (FarmLogOwner, false) })
        {
            var seen = await AsFarmMemberAsync(FarmA, Mukadam, async sp =>
            {
                var repository = sp.GetRequiredService<IShramSafalRepository>();
                var record = await repository.GetDailyLogByIdAsync(log);
                return await RecordAudienceGate.MaySeeLogAsync(repository, record!, Mukadam, DateTime.UtcNow);
            });
            seen.Should().Be(his, $"record {log}");
        }

        (await GetAsync(Mukadam, $"/shramsafal/attachments/{OwnerLogPhoto}")).Status.Should().NotBe(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/attachments/{BillShared}")).Status.Should().NotBe(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/attachments/{P2LogPhoto}")).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/test-instances?cropCycleId={CycleA}")).Status.Should().NotBe(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/test-instances?cropCycleId={CycleP2}")).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/plan/today?cropCycleId={CycleA}")).Status.Should().NotBe(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/compare?cropCycleId={CycleA}")).Status.Should().NotBe(HttpStatusCode.OK);

        var (cardsStatus, cards) = await GetAsync(Mukadam, $"/shramsafal/farms/{FarmA}/job-cards");
        cardsStatus.Should().Be(HttpStatusCode.OK, cards);
        IdsIn(cards).Should().BeEquivalentTo([JobCardP2]);

        var (signalsStatus, signals) = await GetAsync(Mukadam, $"/shramsafal/farms/{FarmA}/compliance");
        signalsStatus.Should().Be(HttpStatusCode.OK, signals);
        IdsIn(signals).Should().BeEquivalentTo([SignalP2]);

        var (attentionStatus, attention) = await GetAsync(Mukadam, "/shramsafal/attention");
        attentionStatus.Should().Be(HttpStatusCode.OK, attention);
        attention.Should().Contain(P2.ToString()).And.NotContain(PlotA.ToString()).And.NotContain(P1Name);

        var (labourStatus, labour) = await GetAsync(Mukadam, $"/shramsafal/farms/{FarmA}/labour");
        labourStatus.Should().Be(HttpStatusCode.OK, labour);
        foreach (var outside in new[] { OwnerLog.ToString(), WorkerLog.ToString(), "432.17", "3457.36", FarmOwnerProduct })
        {
            labour.Should().NotContain(outside, "the labour page reads his plots' records only");
        }
    }

    // ── E ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task E_tenancy_both_ways_and_only_the_holder_sets_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmAsync();

        // Another farm's plot in the scope: refused (never an oracle for it: the same answer as a plot that does not exist).
        using (var foreign = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { P2, PlotB } }))
        {
            foreign.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await foreign.Content.ReadAsStringAsync()).Should().Contain("ShramSafal.MembershipPlot.InvalidCommand");
        }

        using (var unknown = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { Guid.NewGuid() } }))
        {
            unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await unknown.Content.ReadAsStringAsync()).Should().Contain("ShramSafal.MembershipPlot.InvalidCommand");
        }

        using (var none = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = Array.Empty<Guid>() }))
        {
            none.StatusCode.Should().Be(HttpStatusCode.BadRequest, "chosen plots need at least one plot");
        }

        // Not the holder: a सहमालक, the person himself, another farm's owner — refused (D-26: people and permissions).
        foreach (var caller in new[] { CoOwner, Mukadam, OwnerB })
        {
            using var refused = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", caller,
                new { plotScope = "ChosenPlots", plotIds = new[] { P2 } });
            refused.IsSuccessStatusCode.Should().BeFalse($"{caller} does not manage people on this farm");
        }

        var (_, still) = await PullAsync(Mukadam);
        IdsOf(still, "dailyLogs").Should().Contain(OwnerLog, "nothing was narrowed by a refused choice");

        // The holder: accepted, audited (who, when, from and to), and the roster says so.
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P4, P2);
        var (rosterStatus, roster) = await GetAsync(Owner, $"/shramsafal/farms/{FarmA}/labour-permissions");
        rosterStatus.Should().Be(HttpStatusCode.OK, roster);
        var row = JsonDocument.Parse(roster).RootElement.EnumerateArray().Single(r => r.GetProperty("userId").GetGuid() == Mukadam);
        row.GetProperty("plotScope").GetString().Should().Be("ChosenPlots");
        row.GetProperty("plotIds").EnumerateArray().Select(p => p.GetGuid()).Should().BeEquivalentTo([P2, P4]);
        await using var db = NewSuperuserContext();
        var audit = db.AuditEvents.Where(a => a.Action == "MemberPlotScopeChanged").ToList();
        audit.Should().ContainSingle("one row per real change");
        audit[0].ActorUserId.Value.Should().Be(Owner);
        audit[0].Payload.Should().Contain("\"plotScopeBefore\":\"AllPlots\"").And.Contain("\"plotScope\":\"ChosenPlots\"")
            .And.Contain(P2.ToString()).And.Contain(P4.ToString());

        // A re-sent choice is not a decision: no second row.
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        db.AuditEvents.Count(a => a.Action == "MemberPlotScopeChanged").Should().Be(1);

        // An approval chooses the plots in the same tap (the कामगार preset → स्वतःचं काम).
        var joiner = Guid.Parse("3d040000-0000-4000-8000-000000000019");
        await ExecOnSuperuserAsync("""
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@id, '9300000099', 'विनंती-जोडणारा', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (gen_random_uuid(), @farm, @id, 'Worker', NOW(), NOW(), @account, 2, 4);
            """, ("id", joiner), ("farm", FarmA), ("account", AccountA));
        using (var approve = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/memberships/{joiner}/approve", Owner,
                   new { role = "Worker", plotScope = "OwnWork" }))
        {
            var text = await approve.Content.ReadAsStringAsync();
            approve.StatusCode.Should().Be(HttpStatusCode.OK, text);
            JsonDocument.Parse(text).RootElement.GetProperty("plotScope").GetString().Should().Be("OwnWork");
        }
    }

    // ── Seed ─────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The base farm (P1 = PlotA, its records, money, task, test and planned step) plus P2–P4, a season on P2, an own-work
    /// person, and on P2 / P1+P2 / the whole farm: records, money (a split bill P1/P2, an unallocated cost), a task, a test,
    /// a planned step and warnings; and a PRV record on P2 that leaves the मुकादम out.
    /// </summary>
    private async Task SeedFarmAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, @p2Name, 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p3, @farm, @p3Name, 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, @p4Name, 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleP2, @farm, @p2, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@own, '9300000088', @ownName, 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @own, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            """,
            ("p2", P2), ("p3", P3), ("p4", P4), ("farm", FarmA), ("p2Name", P2Name), ("p3Name", P3Name), ("p4Name", P4Name),
            ("cycleP2", CycleP2), ("own", OwnWorker), ("ownName", OwnWorkerName), ("account", AccountA));

        // The मुकादम: take हजेरी and see money; the सहमालक: money, wages and confirm (every plot).
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ConfirmRecords);

        await PushAppliedAsync(Owner, "create_daily_log", "mu4-p2-log", Log(P2Log, Owner, P2, CycleP2, "प्लॉट-दोन-औषध", P2InputCost));
        await PushAppliedAsync(Owner, "create_daily_log", "mu4-p12-log", MultiPlotLog(P12Log, Owner, [PlotA, P2], P12InputCost));
        await PushAppliedAsync(Owner, "create_daily_log", "mu4-farm-owner", FarmLog(FarmLogOwner, Owner, FarmOwnerProduct, FarmOwnerInputCost));
        await PushAppliedAsync(Mukadam, "create_daily_log", "mu4-farm-mukadam", FarmLog(FarmLogMukadam, Mukadam, MukadamFarmProduct, null));
        await PushAppliedAsync(Owner, "create_daily_log", "mu4-p2-private", Log(P2Private, Owner, P2, CycleP2, P2PrivateProduct, P2PrivateInputCost));
        await PushAppliedAsync(Owner, "set_record_audience", "mu4-p2-private-audience", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = P2Private,
            ["audience"] = "Selected",
            ["selectedUserIds"] = new[] { CoOwner },
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        await PushAppliedAsync(Owner, "create_attachment", "mu4-p2-photo", Photo(P2LogPhoto, P2Log, "DailyLog"));
        await PushAppliedAsync(Owner, "create_attachment", "mu4-bill-p2", Photo(BillP2, FarmA, "Bill"));
        await PushAppliedAsync(Owner, "create_attachment", "mu4-bill-shared", Photo(BillShared, FarmA, "Bill"));
        await PushAppliedAsync(Owner, "add_cost_entry", "mu4-cost-p2", Money(CostP2, P2, CycleP2, CostP2Amount, [BillP2]));
        await PushAppliedAsync(Owner, "add_cost_entry", "mu4-split", Money(SplitBill, null, null, SplitAmount, []));
        await PushAppliedAsync(Owner, "add_cost_entry", "mu4-unallocated", Money(Unallocated, null, null, UnallocatedAmount, []));

        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id, created_at_utc, modified_at_utc)
            VALUES (@ledger, @farm, @split, DATE '2026-10-30', 'equal', @owner, NOW(), NOW());
            INSERT INTO ssf.day_ledger_allocations (id, day_ledger_id, plot_id, allocated_amount, currency_code, allocated_at_utc)
            VALUES (@shareP1, @ledger, @p1, 3500.51, 'INR', NOW()),
                   (@shareP2, @ledger, @p2, 2500.33, 'INR', NOW());
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status, created_at_utc, modified_at_utc, line_items)
            VALUES (@jc, @farm, @p2, @cycleP2, @owner, DATE '2026-10-30', 'Draft', NOW(), NOW(),
                    '[{"activityType":"spray","expectedHours":4,"rateAmount":2741.19,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
            INSERT INTO ssf.test_instances (id, test_protocol_id, protocol_kind, crop_cycle_id, farm_id, plot_id, stage_name, planned_due_date, created_at_utc, modified_at_utc, status)
            VALUES (@test, @protocol, 0, @cycleP2, @farm, @p2, 'Vegetative', DATE '2026-10-01', NOW(), NOW(), 0);
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (@planned, @cycleP2, 'छाटणी', 'Vegetative', DATE '2026-10-01', NOW(), NOW());
            INSERT INTO ssf.compliance_signals ("Id", farm_id, plot_id, crop_cycle_id, rule_code, severity, suggested_action, title_en, title_mr,
                                                description_en, description_mr, payload_json, first_seen_at_utc, last_seen_at_utc)
            VALUES (@signalP1, @farm, @p1, @cycleA, 'mu4.rule.p1', 'NeedsAttention', 'OpenPlot', 'P1 warning', 'पहिला इशारा', 'd', 'd', '{}', NOW(), NOW()),
                   (@signalP2, @farm, @p2, @cycleP2, 'mu4.rule.p2', 'NeedsAttention', 'OpenPlot', 'P2 warning', 'दुसरा इशारा', 'd', 'd', '{}', NOW(), NOW());
            """,
            ("ledger", SplitLedger), ("farm", FarmA), ("split", SplitBill), ("owner", Owner), ("shareP1", SplitShareP1),
            ("shareP2", SplitShareP2), ("p1", PlotA), ("p2", P2), ("jc", JobCardP2), ("cycleP2", CycleP2), ("test", TestP2),
            ("protocol", Protocol), ("planned", PlannedP2), ("signalP1", SignalP1), ("signalP2", SignalP2), ("cycleA", CycleA));
    }

    /// <summary>The owner chooses: the मुकादम covers {P2, P4}; the own-work person his own work.</summary>
    private async Task SetScopesAsync()
    {
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        await SetPlotScopeAsync(OwnWorker, "OwnWork");
    }

    private async Task SetPlotScopeAsync(Guid person, string scope, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = scope, plotIds = plots.Length == 0 ? null : plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    // ── Payloads ─────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> Log(Guid id, Guid maker, Guid plot, Guid cycle, string product, decimal? cost) =>
        WithContent(new Dictionary<string, object?>
        {
            ["dailyLogId"] = id,
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["operatorUserId"] = maker,
            ["logDate"] = WorkDay,
        }, product, cost);

    private static Dictionary<string, object?> MultiPlotLog(Guid id, Guid maker, Guid[] plots, decimal? cost) =>
        WithContent(new Dictionary<string, object?>
        {
            ["dailyLogId"] = id,
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = plots,
            ["operatorUserId"] = maker,
            ["logDate"] = WorkDay,
        }, "दोन-प्लॉट-औषध", cost);

    private static Dictionary<string, object?> FarmLog(Guid id, Guid maker, string product, decimal? cost) =>
        WithContent(new Dictionary<string, object?>
        {
            ["dailyLogId"] = id,
            ["farmId"] = FarmA,
            ["scope"] = "Farm",
            ["operatorUserId"] = maker,
            ["logDate"] = WorkDay,
        }, product, cost);

    private static Dictionary<string, object?> WithContent(Dictionary<string, object?> payload, string product, decimal? cost)
    {
        var input = new Dictionary<string, object?> { ["id"] = "in-1", ["productName"] = product, ["quantity"] = 1, ["unit"] = "l" };
        if (cost is { } amount)
        {
            input["cost"] = amount;
            input["numbers"] = new { cost = new { certainty = "reported", spokenText = "खर्च सांगितला" } };
        }

        payload["content"] = new { schema = 1, inputs = new object[] { input } };
        return payload;
    }

    private static Dictionary<string, object?> Money(Guid id, Guid? plot, Guid? cycle, decimal amount, Guid[] bills)
    {
        var payload = new Dictionary<string, object?>
        {
            ["costEntryId"] = id,
            ["farmId"] = FarmA,
            ["categoryId"] = "fertilizer",
            ["description"] = "खर्च-" + amount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["amount"] = amount,
            ["currencyCode"] = "INR",
            ["entryDate"] = WorkDay,
            ["direction"] = "Expense",
            ["attachments"] = bills,
        };
        if (plot is { } p) payload["plotId"] = p;
        if (cycle is { } c) payload["cropCycleId"] = c;
        return payload;
    }

    private static Dictionary<string, object?> Photo(Guid id, Guid parent, string parentType) => new()
    {
        ["attachmentId"] = id,
        ["farmId"] = FarmA,
        ["linkedEntityId"] = parent,
        ["linkedEntityType"] = parentType,
        ["fileName"] = $"mu4-{parentType}.jpg",
        ["mimeType"] = "image/jpeg",
    };

    // ── Reads ────────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private static JsonElement ScopeOf(JsonElement root) =>
        ArrayOf(root, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == FarmA);

    private static IReadOnlyList<Guid> CardPlots(JsonElement root) =>
        root.TryGetProperty("attentionBoard", out var board) && board.ValueKind == JsonValueKind.Object
            ? board.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("plotId").GetGuid()).ToList()
            : [];

    private static IReadOnlyList<Guid> IdsIn(string jsonArray) =>
        JsonDocument.Parse(jsonArray).RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();

    private static DateTime Cursor(JsonElement root) => root.GetProperty("nextCursorUtc").GetDateTime();

    private static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 20));
    }

    /// <summary>An access change is re-sent only once its whole second is over (PullReadWindow).</summary>
    private static Task PastTheChangeSecondAsync() => Task.Delay(TimeSpan.FromMilliseconds(1150));

    /// <summary>
    /// The P11 run's input: when <c>MU4_P11_BODIES</c> names a folder, the real bodies this server sent are kept there, so
    /// the 1.0.17 phone's own code (release b3d28967) can be fed exactly them.
    /// </summary>
    private void Keep(string who, string body)
    {
        var dir = Environment.GetEnvironmentVariable("MU4_P11_BODIES");
        if (string.IsNullOrWhiteSpace(dir))
        {
            return;
        }

        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, $"{who}.json"), body);
        Output.WriteLine($"[P11] kept {who}.json");
    }
}
