// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2): the compare read serves the reasons of the whole farm's own work
// in ONE read, never one per plot (do NOT repeat CMP-D2's N+1, P001).
//
// The NAMED BOUND: the reasons cost AT MOST ONE command per farm request (exactly one when any plot lists own work, none when none does), whatever the
// number of plots or reasons. The CMP-D2 bound beside it is unchanged: at most TWO commands per plot with a season (its season row and its tasks).
// Real Postgres as agrisync_app through the real host (E3 first). Fake phone numbers only.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class LogPracticeReasonCostRealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    /// <summary>Counts every command EF Core sends to the database and keeps its text (so the reads of one table can be told apart).</summary>
    private sealed class CommandLog : DbCommandInterceptor
    {
        private int _count;
        private readonly ConcurrentBag<string> _texts = [];

        public int Count => Volatile.Read(ref _count);

        public int Reading(string table) => _texts.Count(t => t.Contains(table, StringComparison.OrdinalIgnoreCase));

        public IReadOnlyList<string> TextsReading(string table) => _texts.Where(t => t.Contains(table, StringComparison.OrdinalIgnoreCase)).ToList();

        public void Reset()
        {
            Interlocked.Exchange(ref _count, 0);
            _texts.Clear();
        }

        private void Note(DbCommand command)
        {
            Interlocked.Increment(ref _count);
            _texts.Add(command.CommandText);
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }
    }

    private readonly CommandLog _log = new();

    protected override void AddHostServices(IServiceCollection services)
    {
        services.ConfigureDbContext<ShramSafalDbContext>(options => options.AddInterceptors(_log));
    }

    private const string OwnWork = "वेली बांधणी";
    private const int CommandsPerPlot = 2;

    private static DateOnly DayOf(int dayToday, int day) => TodayIst().AddDays(-dayToday + day);

    [Fact]
    public async Task The_reasons_of_the_whole_farm_are_one_read_whatever_the_number_of_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedInstitutionAsync();
        await HoldsSeeCompareAsync(CoOwner);
        var withReasons = new List<(Guid Log, string Key)>();

        async Task AddPlotAsync(bool reason)
        {
            var (plot, cycle, _) = await FollowingAsync(uni.Id, 20);
            await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
            var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), OwnWork); // own work: takes a reason
            var root = await CompareOkAsync(CoOwner, FarmA);
            var key = PlotOf(root, plot).GetProperty("ownWork").EnumerateArray()
                .Single(o => o.GetProperty("dailyLogId").GetGuid() == log).GetProperty("workKey").GetString()!;
            if (reason)
            {
                var id = Guid.NewGuid();
                var set = await PushAsAsync(Owner, "logreason.set", $"cmpd3-cost-{id:N}", new Dictionary<string, object?>
                {
                    ["reasonId"] = id,
                    ["farmId"] = FarmA,
                    ["dailyLogId"] = log,
                    ["workKey"] = key,
                    ["kind"] = "Weather",
                    ["words"] = "पाऊस",
                    ["saidByVoice"] = false,
                }, "1.0.18");
                set.Status.Should().Be("applied", $"{set.ErrorCode}: {set.ErrorMessage}");
                withReasons.Add((log, key));
            }
        }

        async Task<(int Commands, int Reads, int Plots, int Shown)> MeasureAsync()
        {
            await CompareOkAsync(CoOwner, FarmA); // warm: the first read pays for compiled queries and nothing else
            _log.Reset();
            var root = await CompareOkAsync(CoOwner, FarmA);
            var commands = _log.Count;
            var reads = _log.Reading("log_practice_reasons");
            var plots = root.GetProperty("plots").GetArrayLength();
            var shown = root.GetProperty("plots").EnumerateArray()
                .SelectMany(p => p.GetProperty("ownWork").EnumerateArray())
                .Count(o => o.GetProperty("reason").ValueKind == JsonValueKind.Object);
            Output.WriteLine($"[CMPD3] plots={plots} commands={commands} reasonReads={reads} reasonsShown={shown}");
            if (Environment.GetEnvironmentVariable("CMPD3_COUNT_FILE") is { Length: > 0 } countFile)
            {
                System.IO.File.AppendAllText(countFile, $"plots={plots} commands={commands} reasonReads={reads} reasonsShown={shown}{Environment.NewLine}");
            }

            return (commands, reads, plots, shown);
        }

        await AddPlotAsync(reason: true);
        var few = await MeasureAsync();
        for (var i = 0; i < 11; i++)
        {
            await AddPlotAsync(reason: true);
        }

        var many = await MeasureAsync();

        (many.Plots - few.Plots).Should().BeGreaterThanOrEqualTo(11, "the precondition: the second farm really has more plots");
        few.Shown.Should().Be(1, "the precondition: the reasons are served (else the read is not vacuous)");
        many.Shown.Should().Be(12, "every plot's reason is served");
        few.Reads.Should().Be(1, "the reasons of the farm are ONE command");
        many.Reads.Should().Be(1, "and still ONE command for twelve plots");
        var extraPlots = many.Plots - few.Plots;
        (many.Commands - few.Commands).Should().BeLessThanOrEqualTo(
            CommandsPerPlot * extraPlots,
            $"{extraPlots} more plots (each with a reason) may cost at most {CommandsPerPlot} commands each - the reasons add nothing per plot");
        few.Commands.Should().BeGreaterThan(0, "the counter sees the commands (not vacuous)");
        withReasons.Should().HaveCount(12);
    }

    // spec: lane CMP-D3 fix round 1 (P003): the reads do not scale with history. Thirty rows for ONE item (a chain of supersedes and a tie on the
    // very last instant): the compare read serves the latest by the one rule (created_at_utc DESC, then id DESC) and the store hands back ONE row for it.
    [Fact]
    public async Task Thirty_superseding_rows_for_one_item_serve_the_latest_and_the_read_returns_one_row_for_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedInstitutionAsync();
        await HoldsSeeCompareAsync(CoOwner);
        var (plot, cycle, _) = await FollowingAsync(uni.Id, 20);
        var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), OwnWork);
        var key = PlotOf(await CompareOkAsync(CoOwner, FarmA), plot).GetProperty("ownWork").EnumerateArray()
            .Single(o => o.GetProperty("dailyLogId").GetGuid() == log).GetProperty("workKey").GetString()!;

        // 28 earlier rows, one minute apart, then two rows at the very same instant: the larger id is the latest
        await ExecOnSuperuserAsync(
            """
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            SELECT gen_random_uuid(), @f, @l, @k, 'Practice', 'old-' || g, false, @u, @now - (40 - g) * interval '1 minute'
            FROM generate_series(1, 28) g
            """,
            ("f", FarmA), ("l", log), ("k", key), ("u", Owner), ("now", DateTime.UtcNow));
        var tie = DateTime.UtcNow;
        await ExecOnSuperuserAsync(
            """
            INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc)
            VALUES ('00000000-0000-4000-8000-000000000001', @f, @l, @k, 'Weather', 'tie-low', false, @u, @t),
                   ('ffffffff-ffff-4fff-8fff-ffffffffffff', @f, @l, @k, 'Extra', 'tie-high', false, @u, @t)
            """,
            ("f", FarmA), ("l", log), ("k", key), ("u", Owner), ("t", tie));
        (await CountAsync("SELECT count(*) FROM ssf.log_practice_reasons WHERE daily_log_id = @l", ("l", log))).Should().Be(30, "the precondition: thirty rows for one item");

        // the store, under the farm's scope: ONE row comes back for the item, and it is the latest
        var served = await AsFarmMemberAsync(FarmA, Owner, sp =>
            sp.GetRequiredService<ShramSafal.Application.Ports.ILogPracticeReasonStore>().GetForLogsAsync([log]));
        served.Should().ContainSingle("the read returns the latest row per record + item, never the history");
        served[0].Words.Should().Be("tie-high");

        // the compare read serves it, in ONE command, and that command asks for the latest per item (not the whole history)
        await CompareOkAsync(CoOwner, FarmA); // warm
        _log.Reset();
        var root = await CompareOkAsync(CoOwner, FarmA);
        var reason = PlotOf(root, plot).GetProperty("ownWork").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == log).GetProperty("reason");
        reason.GetProperty("kind").GetString().Should().Be("Extra");
        reason.GetProperty("words").GetString().Should().Be("tie-high");
        _log.Reading("log_practice_reasons").Should().Be(1);
        _log.TextsReading("log_practice_reasons").Single().Should().Contain("DISTINCT ON", "the one command picks the latest row per record + item inside the database");
    }

    [Fact]
    public async Task A_farm_with_no_own_work_reads_no_reasons_at_all()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle, _) = await FollowingAsync(uni.Id, 20);
        await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी"); // asked work: counted, not own work

        await CompareOkAsync(Owner, FarmA);
        _log.Reset();
        var (status, body) = await CompareAsync(Owner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("plots").EnumerateArray().SelectMany(p => p.GetProperty("ownWork").EnumerateArray()).Should().BeEmpty("the precondition");
        _log.Count.Should().BeGreaterThan(0, "the counter sees the commands (not vacuous)");
        _log.Reading("log_practice_reasons").Should().Be(0, "nothing is listed, so nothing is asked");
    }
}
