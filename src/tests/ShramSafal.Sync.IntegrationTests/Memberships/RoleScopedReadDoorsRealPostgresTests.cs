// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — the REST doors that carry
// money apply the SAME read scope the download does: the finance summaries, the exports, the farm's audit
// trail, the job-card reads, the wage book (labour read-out) and the attachment reads. On a real Postgres as
// agrisync_app (E3 first), each person, through the real host.
//
// FOUND (pre-existing on dbea472a, not changed by this lane): /finance/plot-summary, /export/*,
// /audit?farmId= and /farms/{id}/job-cards answer 500 to EVERY caller at the route — they open no tenant
// scope, so the first database read fails closed in TenantConnectionInterceptor, and the plot-summary
// handler is not even registered. Those four are therefore proved here on the exact rule / handler the
// route asks, run user-scoped (only agrisync.user_id set); the working routes are proved through the host.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;
using ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RoleScopedReadDoorsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid[] NoMoneySeats = [CoOwner, Mukadam, Worker];

    [Fact]
    public async Task The_finance_summary_route_opens_only_for_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (ownerStatus, ownerBody) = await GetAsync("/shramsafal/finance/summary?groupBy=day", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain("9876.54", "the owner's summary counts his money");
        ownerBody.Should().NotContain("5555.67", "and never another farm's");

        foreach (var seat in NoMoneySeats.Append(Paused))
        {
            var (status, body) = await GetAsync("/shramsafal/finance/summary?groupBy=day", seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat} does not see money: no summary, never a ₹0");
            body.Should().NotContain("9876.54");
        }
    }

    [Fact]
    public async Task The_plot_summary_opens_only_for_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PlotSummaryAsync(Owner)).Should().BeTrue("the owner reads his plot's money");
        foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
        {
            (await PlotSummaryAsync(seat)).Should().BeFalse($"{seat} does not see this farm's money");
        }
    }

    [Fact]
    public async Task Exports_carry_amounts_and_open_only_for_a_seat_that_sees_the_farms_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var rule = Rule(typeof(ShramSafal.Api.Endpoints.ExportEndpoints), "MayExportAsync");
        (await AsUserAsync(Owner, sp => Ask(rule, sp, Owner))).Should().BeTrue("the owner exports his farm's reports");
        foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
        {
            (await AsUserAsync(seat, sp => Ask(rule, sp, seat))).Should().BeFalse($"{seat} may not export amounts");
        }
    }

    [Fact]
    public async Task The_farms_audit_trail_opens_only_for_a_seat_that_sees_money_and_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var rule = Rule(typeof(ShramSafal.Api.Endpoints.AuditEndpoints), "MayReadFarmAuditAsync");
        (await AsUserAsync(Owner, sp => Ask(rule, sp, Owner, withClock: false))).Should().BeTrue();
        foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
        {
            (await AsUserAsync(seat, sp => Ask(rule, sp, seat, withClock: false))).Should()
                .BeFalse($"{seat}: the trail carries amounts and wages");
        }
    }

    [Fact]
    public async Task Job_cards_carry_rates_and_open_only_for_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var owner = await JobCardsAsync(Owner);
        owner.IsSuccess.Should().BeTrue();
        owner.Value!.Select(j => j.Id).Should().Equal([JobCard]);

        foreach (var seat in NoMoneySeats.Append(Paused))
        {
            var result = await JobCardsAsync(seat);
            result.IsSuccess.Should().BeFalse($"{seat}: a job card's rate is money");
            result.Error.Code.Should().Contain("Forbidden");
        }
    }

    [Fact]
    public async Task The_wage_book_follows_see_wages_and_never_the_co_owner_label()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (ownerStatus, ownerBody) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        JsonDocument.Parse(ownerBody).RootElement.GetProperty("view").GetString().Should().Be("owner");

        var (coStatus, coBody) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", CoOwner);
        coStatus.Should().Be(HttpStatusCode.OK, coBody);
        var co = JsonDocument.Parse(coBody).RootElement;
        co.GetProperty("view").GetString().Should().Be("crew", "a सहमालक without see wages reads the crew register, no money");
        co.GetProperty("dashboard").GetProperty("money").ValueKind.Should().Be(JsonValueKind.Null, "withheld, never ₹0");
        foreach (var amount in new[] { "432.17", "3457.36", "211.19", "1689.52", "166.61" })
        {
            coBody.Should().NotContain(amount, "no wage reaches a seat without see wages");
        }
    }

    [Fact]
    public async Task An_attachment_is_read_where_its_parent_is_read()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A receipt is money.
        (await ListAsync(Cost, "CostEntry", Owner)).Should().Equal([Receipt]);
        (await ListAsync(Cost, "CostEntry", CoOwner)).Should().BeEmpty("a receipt is money");
        (await GetAsync($"/shramsafal/attachments/{Receipt}", CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/attachments/{Receipt}", Owner)).Status.Should().Be(HttpStatusCode.OK);

        // A record's photo goes where the record goes.
        (await ListAsync(OwnerLog, "DailyLog", CoOwner)).Should().Equal([OwnerLogPhoto]);
        (await ListAsync(OwnerLog, "DailyLog", Worker)).Should().BeEmpty("a कामगार reads his own records only");
        (await GetAsync($"/shramsafal/attachments/{OwnerLogPhoto}", Worker)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await ListAsync(WorkerLog, "DailyLog", Worker)).Should().Equal([WorkerLogPhoto], "his own record's photo is his");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }

    private async Task<Guid[]> ListAsync(Guid entityId, string entityType, Guid user)
    {
        var (status, body) = await GetAsync($"/shramsafal/attachments?entityId={entityId}&entityType={entityType}", user);
        status.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.EnumerateArray().Select(a => a.GetProperty("id").GetGuid()).ToArray();
    }

    private Task<bool> PlotSummaryAsync(Guid user) => AsUserAsync(user, async sp =>
    {
        var result = await ActivatorUtilities.CreateInstance<GetPlotFinanceSummaryHandler>(sp)
            .HandleAsync(new GetPlotFinanceSummaryQuery(user, PlotA));
        Output.WriteLine($"[DOOR] {user} plot-summary -> {(result.IsSuccess ? "ok" : result.Error.Code)}");
        return result.IsSuccess;
    });

    private Task<AgriSync.BuildingBlocks.Results.Result<System.Collections.Generic.List<ShramSafal.Application.Contracts.Dtos.JobCardDto>>> JobCardsAsync(Guid user) =>
        AsUserAsync(user, sp => ActivatorUtilities.CreateInstance<GetJobCardsForFarmHandler>(sp)
            .HandleAsync(new GetJobCardsForFarmQuery(new FarmId(FarmA), new UserId(user), StatusFilter: null)));

    /// <summary>
    /// The door's own rule, found by name: a public static method the ROUTE calls. On a build without it
    /// (dbea472a) the door had no money rule at all, which fails the test rather than the compile.
    /// </summary>
    private static MethodInfo? Rule(Type endpoints, string name) =>
        endpoints.GetMethod(name, BindingFlags.Public | BindingFlags.Static);

    private async Task<bool> Ask(MethodInfo? rule, IServiceProvider sp, Guid user, bool withClock = true)
    {
        rule.Should().NotBeNull("the door must ask a money rule before it answers");
        var repository = sp.GetRequiredService<IShramSafalRepository>();
        var clock = sp.GetRequiredService<IClock>();
        object[] args = withClock
            ? [repository, clock, FarmA, user, CancellationToken.None]
            : [repository, FarmA, user, clock.UtcNow, CancellationToken.None];
        var answer = await (Task<bool>)rule!.Invoke(null, args)!;
        Output.WriteLine($"[DOOR] {user} {rule.Name} -> {answer}");
        return answer;
    }
}
