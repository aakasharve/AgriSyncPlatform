// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D2, FIX ROUND 1 (review CMPD2-REVIEW-1: P001, P005, P008).
//
//   P001  the farm read must not cost a query per plot for the farm-wide reads (farm, cycles, subscriptions, library, standing, origins,
//         the records' logs, the money-word check): the commands EF sends are counted for a farm of few plots and a farm of many.
//   P005  each filter clause has its own failing test: a seat limited to his own records that holds "तुलना पाहणे" (MayReadRecordOf),
//         and the money words of a NOT-RECOGNISED record.
//   P008  counts attach to the stage they were computed for, never by name: two stages with the same name.
// Real Postgres as agrisync_app through the real host (E3 first). Fake phone numbers only.
using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmCompareFix1RealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    private const string SecretNote = "गुप्त-टीप-९९";

    /// <summary>Counts every command EF Core sends to the database (the "command round-trips" of one request).</summary>
    private sealed class CommandCounter : DbCommandInterceptor
    {
        private int _count;

        public int Count => Volatile.Read(ref _count);

        public void Reset() => Interlocked.Exchange(ref _count, 0);

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Interlocked.Increment(ref _count);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            Interlocked.Increment(ref _count);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        {
            Interlocked.Increment(ref _count);
            return result;
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return ValueTask.FromResult(result);
        }
    }

    private readonly CommandCounter _counter = new();

    protected override void AddHostServices(IServiceCollection services)
    {
        services.ConfigureDbContext<ShramSafalDbContext>(options => options.AddInterceptors(_counter));
    }

    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate Uni)> UniversityPlotAsync(int dayToday = 20)
    {
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle, _) = await FollowingAsync(uni.Id, dayToday);
        return (plot, cycle, uni);
    }

    private static DateOnly DayOf(int dayToday, int day) => TodayIst().AddDays(-dayToday + day);

    // ---- P001 -------------------------------------------------------------------------------------------------------

    /// <summary>
    /// The one bound: each plot with a season costs at most TWO commands (its season row and that season's tasks). Everything else - the farm,
    /// the plots' seasons, the followed schedules, the library listing, the owner's standing, the origins, every log of every plot, the money
    /// check of every listed record - is read ONCE per farm. The reader is a co-owner who does not hear wages, so every piece of own work
    /// takes the money-word check.
    /// </summary>
    private const int CommandsPerPlot = 2;

    [Fact]
    public async Task The_read_costs_no_query_per_plot_beyond_a_named_bound_of_two()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedInstitutionAsync();
        await HoldsSeeCompareAsync(CoOwner);

        async Task AddPlotAsync()
        {
            var (plot, cycle, _) = await FollowingAsync(uni.Id, 20);
            await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
            await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी"); // own work: takes the money-word check
        }

        async Task<(int Commands, int Plots)> MeasureAsync()
        {
            await CompareOkAsync(CoOwner, FarmA); // warm: the first read pays for compiled queries and nothing else
            _counter.Reset();
            var root = await CompareOkAsync(CoOwner, FarmA);
            var commands = _counter.Count;
            var plots = root.GetProperty("plots").GetArrayLength();
            Output.WriteLine($"[P001] plots={plots} commands={commands}");
            if (Environment.GetEnvironmentVariable("CMPD2_COUNT_FILE") is { Length: > 0 } countFile)
            {
                System.IO.File.AppendAllText(countFile, $"plots={plots} commands={commands}{Environment.NewLine}");
            }

            return (commands, plots);
        }

        await AddPlotAsync();
        var few = await MeasureAsync();
        for (var i = 0; i < 11; i++)
        {
            await AddPlotAsync();
        }

        var many = await MeasureAsync();

        (many.Plots - few.Plots).Should().BeGreaterThanOrEqualTo(11, "the precondition: the second farm really has more plots");
        var extraPlots = many.Plots - few.Plots;
        (many.Commands - few.Commands).Should().BeLessThanOrEqualTo(
            CommandsPerPlot * extraPlots,
            $"{extraPlots} more plots may cost at most {CommandsPerPlot} commands each (its season row and its tasks); every farm-wide read is one read");
        few.Commands.Should().BeGreaterThan(0, "the counter sees the commands (not vacuous)");
    }

    // ---- P005 -------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_seat_limited_to_his_own_records_that_holds_SeeCompare_is_listed_only_his_own_work()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var ownersSpray = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
        var ownersWork = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी", notes: SecretNote);
        await HoldsSeeCompareAsync(Mukadam);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "OwnWork", plotIds = (Guid[]?)null }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var hisOwn = await RecordAsync(Mukadam, plot, cycle, DayOf(20, 19), "वेली बांधणी");

        var owner = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        owner.GetProperty("ownWork").EnumerateArray().Select(o => o.GetProperty("dailyLogId").GetGuid())
            .Should().BeEquivalentTo([ownersWork, hisOwn], "the precondition: the owner is told both pieces of own work");

        var (status, body) = await CompareAsync(Mukadam, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var his = PlotOf(Json(body), plot);
        his.GetProperty("ownWork").EnumerateArray().Select(o => o.GetProperty("dailyLogId").GetGuid()).Should().Equal([hisOwn],
            "an own-records-only seat is listed only the work he made himself");
        body.Should().NotContain(ownersWork.ToString()).And.NotContain(ownersSpray.ToString()).And.NotContain(SecretNote);
        // D-68: the owner's spray still counts for every reader
        CountsOf(his, 0, 1).GetProperty("done").GetInt32().Should().Be(1, "the owner's record is a done mark for him too (identical counts for every reader)");
    }

    [Fact]
    public async Task A_not_recognised_record_that_states_money_keeps_its_title_from_a_reader_who_does_not_hear_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var money = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "zxqv wlmk", notes: "रवीला ५०० रु.");
        await HoldsSeeCompareAsync(CoOwner);

        var owner = PlotOf(await CompareOkAsync(Owner, FarmA), plot).GetProperty("notRecognised").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == money);
        owner.GetProperty("title").GetString().Should().Be("zxqv wlmk", "the maker reads his own words");

        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var co = PlotOf(Json(body), plot).GetProperty("notRecognised").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == money);
        co.GetProperty("title").ValueKind.Should().Be(JsonValueKind.Null, "D-66: the words of a record that states money stay with the holder");
        body.Should().NotContain("zxqv").And.NotContain("५००").And.NotContain("रवीला");
    }

    // ---- P008 -------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Two_stages_with_the_same_name_each_keep_their_own_counts()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var row = await CheckedScheduleAsync("Grapes - Twin stages",
            [new StageDefinition("Same", 0, 30), new StageDefinition("Same", 31, 60), new StageDefinition("Later", 61, 90)],
            [
                new ImportedActivity("spray", "बुरशीनाशक फवारणी", 5, 25, FrequencyMode.EveryNDays, 5),   // 5 10 15 20 25 -> 5 in the first "Same"
                new ImportedActivity("drip", "ठिबक सिंचन", 31, 45, FrequencyMode.EveryNDays, 5),         // 31 36 41 -> 3 in the second "Same"
            ]);
        var (plot, cycle, _) = await FollowingAsync(row.Id, 50);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 10), "बुरशीनाशक फवारणी");
        await RecordAsync(Owner, plot, cycle, DayOf(50, 36), "ठिबक सिंचन");

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        compare.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("state").GetString()).Should().Equal("passed", "current", "ahead");
        var first = CountsOf(compare, 0, 0);
        var second = CountsOf(compare, 0, 1);
        first.ValueKind.Should().Be(JsonValueKind.Object, "the first stage is counted");
        second.ValueKind.Should().Be(JsonValueKind.Object, "the second stage is counted, not lost to the first one's name");
        (first.GetProperty("asked").GetInt32(), first.GetProperty("done").GetInt32()).Should().Be((5, 1), "the spray's 5 days are in the first 'Same'");
        (second.GetProperty("asked").GetInt32(), second.GetProperty("done").GetInt32()).Should().Be((3, 1), "the irrigation's 3 days are in the second 'Same'");
        CountsOf(compare, 0, 2).ValueKind.Should().Be(JsonValueKind.Null, "the third stage is still ahead");
    }
}
