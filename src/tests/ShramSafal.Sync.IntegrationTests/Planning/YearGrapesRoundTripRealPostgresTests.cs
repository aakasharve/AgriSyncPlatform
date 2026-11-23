// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// YearGrapes_160Works_84Challenges_RoundTrip_LoseNothing: the founder-approved grape year (9 stages, 160 works, 84 challenges) goes through the task format and a REAL
// Postgres (written as the application role, read back by another person's scope) and comes out as the same numbers and the same text, line by line.
//
// WHERE THE FILE COMES FROM. The year file (year.json, ~490 KB) is NOT committed: this is a public repository, the file is the founder's working copy of grape doses that
// no agronomist has checked yet (the approved spec leaves that check open), and a dose in a public fixture reads as advice. The test reads it from the path in the environment
// variable AGRISYNC_YEAR_GRAPES_JSON (for example G:\agrisync-scratch\schedule-kit\year\year.json) and SKIPS, printing why, when it is not set or the file is not there. The
// always-on proof of the same round trip, on a hand-made set that holds every kind of task and every optional part, is ScheduleTaskRealPostgresTests.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Planning;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;
using Xunit.Abstractions;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class YearGrapesRoundTripRealPostgresTests(ScheduleTaskDb lane, ITestOutputHelper output) : IClassFixture<ScheduleTaskDb>
{
    private const string EnvVar = "AGRISYNC_YEAR_GRAPES_JSON";
    private static readonly DateTime Now = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    private static JsonDocument? OpenYearFile(ITestOutputHelper output)
    {
        var path = Environment.GetEnvironmentVariable(EnvVar);
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            output.WriteLine($"[SKIPPED] set {EnvVar} to the grape year file (year.json); it is deliberately not committed (unchecked doses, public repository). Value: '{path}'.");
            return null;
        }

        output.WriteLine($"[YEAR FILE] {path} ({new FileInfo(path).Length} bytes)");
        return JsonDocument.Parse(File.ReadAllText(path));
    }

    [SkippableFact]
    public async Task YearGrapes_160Works_84Challenges_RoundTrip_LoseNothing()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);
        using var file = OpenYearFile(output);
        Skip.If(file is null, $"{EnvVar} is not set (or the file is missing): the grape year file is not committed.");
        var root = file!.RootElement;

        var mapped = YearGrapesMapper.Map(root);

        // ---- 1. The file's own numbers, as the format holds them ---------------------------------------------------------------
        AssertTheNumbers(mapped);

        // ---- 2. Nothing lost in the format alone: the format read back as the file's own fields equals the file, line by line ---
        var fileEvents = root.GetProperty("stages").EnumerateArray().SelectMany(s => s.GetProperty("ev").EnumerateArray()).ToList();
        fileEvents.Should().HaveCount(160);
        foreach (var (task, fileEvent) in mapped.Tasks.Zip(fileEvents))
        {
            YearGrapesMapper.ExportEvent(task, mapped.BaseByTaskKey[task.TaskKey])
                .Should().BeEquivalentTo(YearGrapesMapper.FileEvent(fileEvent), $"{task.TaskKey}: every field the format carries comes back as the file has it");
        }

        // ---- 3. Through a real Postgres: written as the application role (the library row's maker), read back by another person ----------------
        var id = Guid.NewGuid();
        var template = ScheduleTemplate.Create(id, "द्राक्ष: वर्ष", mapped.Stages[0].Name, Now, new UserId(Staff), TenantScope.Public, mapped.Stages);
        template.SetStageSigns(mapped.StageSigns, out var signProblem).Should().BeTrue(signProblem?.Message);
        template.SetTasks(mapped.Tasks, mapped.Challenges, out var setProblem).Should().BeTrue(setProblem?.Message);
        try
        {
            await using (var write = lane.AppContext())
            {
                await using var tx = await write.Database.BeginTransactionAsync();
                await write.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.user_id', {0}, true)", Staff.ToString());
                write.ScheduleTemplates.Add(template);
                await write.SaveChangesAsync();
                await tx.CommitAsync();
            }

            await using var read = lane.AppContext();
            await using var readTx = await read.Database.BeginTransactionAsync();
            await read.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.user_id', {0}, true)", Stranger.ToString());
            var loaded = await read.ScheduleTemplates
                .Include(t => t.Tasks).Include(t => t.Challenges).Include(t => t.StageRows)
                .AsSplitQuery().AsNoTracking().SingleAsync(t => t.Id == id);

            loaded.Tasks.Should().HaveCount(160, "a stranger reads a library (Public) schedule whole");
            loaded.Challenges.Should().HaveCount(84);
            foreach (var expected in mapped.Tasks)
            {
                var row = loaded.Tasks.Single(t => t.TaskKey == expected.TaskKey);
                row.Content.Should().BeEquivalentTo(expected.Normalized(), expected.TaskKey);
                row.ContentHash.Should().Be(expected.ContentHash(), expected.TaskKey);
                row.Content.ContentHash().Should().Be(row.ContentHash, expected.TaskKey + " (the hash of what was read back)");
            }

            foreach (var expected in mapped.Challenges)
            {
                var row = loaded.Challenges.Single(c => c.ChallengeKey == expected.ChallengeKey);
                row.Content.Should().BeEquivalentTo(expected.Normalized(), expected.ChallengeKey);
                row.ContentHash.Should().Be(expected.ContentHash());
            }

            loaded.Stages.Should().Equal(mapped.Stages, "the stage names and stored day ranges come back as written");
            loaded.StageRows.OrderBy(s => s.OrderIndex).Select((s, i) => (i, s.StartSign, s.EndSign)).Where(x => x.StartSign is not null || x.EndSign is not null)
                .Should().Equal(mapped.StageSigns.Select(s => (s.StageIndex, s.StartSign, s.EndSign)), "the stage signs come back as written");

            // The numbers once more, from what the database returned.
            AssertTheNumbers(mapped with
            {
                Tasks = loaded.Tasks.OrderBy(t => t.StageIndex).ThenBy(t => t.Order).Select(t => t.Content).ToList(),
                Challenges = loaded.Challenges.OrderBy(c => c.StageIndex).ThenBy(c => c.Order).Select(c => c.Content).ToList()
            });
        }
        finally
        {
            await using var cleanup = new NpgsqlConnection(lane.SuperuserConn);
            await cleanup.OpenAsync();
            await ExecAsync(cleanup, "DELETE FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", id));
        }
    }

    [SkippableFact]
    public void The_year_file_keeps_the_day_rules_April_Day1_is_177_and_a_day_before_pruning_is_negative()
    {
        using var file = OpenYearFile(output);
        Skip.If(file is null, $"{EnvVar} is not set (or the file is missing): the grape year file is not committed.");

        var mapped = YearGrapesMapper.Map(file!.RootElement);
        var byKey = mapped.Tasks.ToDictionary(t => t.TaskKey);

        // The fruit season: the file's day 1 is the pruning day, stored 0; the file's "37 to 51" is stored 36 to 50 (the book's "days 36 to 50 after pruning").
        byKey["f-036-ga3-elongated"].Timing.FromDay.Should().Be(36);
        byKey["f-036-ga3-elongated"].Timing.ToDay.Should().Be(50);
        byKey["kit-prune"].Timing.FromDay.Should().Be(0, "pruning day itself");

        // A day before pruning is a plain negative stored day: the kit's file day -19 is 20 days before (25 Sep for a pruning on 15 Oct): stored -20, never day 0.
        byKey["kit-pre-irr"].Timing.FromDay.Should().Be(-20);
        byKey["kit-final"].Timing.FromDay.Should().Be(-1, "the file's day 0 is the day before the pruning");
        ScheduleDayNumbers.DaysBeforeStart(byKey["kit-pre-irr"].Timing.FromDay!.Value).Should().Be(20);

        // The April season: April day 1 is stored 177 (the plan's Global Constraints), April day D is 176 + D.
        byKey["a-001-prune"].Timing.FromDay.Should().Be(ScheduleDayNumbers.StoredFromAprilDay(1)).And.Be(177);
        byKey["a-001-water"].Timing.FromDay.Should().Be(178);
        byKey["a-001-water"].Timing.ToDay.Should().Be(176 + 41);
        byKey["a-m3-water"].Timing.FromDay.Should().Be(174, "two days before the April pruning");

        // The resolver turns them into the sample year's dates: 15 Oct 2026 for stored 0, 10 Apr 2027 for stored 177.
        var pruning = new DateOnly(2026, 10, 15);
        var timings = mapped.Tasks.ToDictionary(t => t.TaskKey, t => t.Timing);
        ScheduleTimerResolver.Resolve("kit-prune", timings, pruning).Due!.From.Should().Be(pruning);
        ScheduleTimerResolver.Resolve("a-001-prune", timings, pruning).Due!.From.Should().Be(new DateOnly(2027, 4, 10));
        ScheduleTimerResolver.Resolve("kit-pre-irr", timings, pruning).Due!.From.Should().Be(new DateOnly(2026, 9, 25), "the file's own date column says 25 Sep");
        ScheduleTimerResolver.Resolve("f-s1-ga3-pre2", timings, pruning).HasDate.Should().BeFalse("a dayless work is never given a date");
    }

    private static void AssertTheNumbers(YearGrapesMapper.Mapped mapped)
    {
        var tasks = mapped.Tasks;
        tasks.Should().HaveCount(160, "works");
        mapped.Challenges.Should().HaveCount(84, "challenges");
        mapped.Stages.Should().HaveCount(9);
        tasks.Count(t => t.Dose is not null).Should().Be(85, "doses");
        tasks.Count(t => t.Steps is { Count: > 0 }).Should().Be(160, "works with steps");
        tasks.Sum(t => t.Steps!.Count).Should().Be(417, "step lines");
        tasks.Count(t => t.Sources is { Count: > 0 }).Should().Be(160, "works with a source");
        tasks.Sum(t => t.Sources!.Count).Should().Be(664, "source lines on works");
        mapped.Challenges.Sum(c => c.Sources!.Count).Should().Be(225, "source lines on challenges");
        mapped.Challenges.Should().OnlyContain(c => c.Sources!.Count > 0, "every challenge has a source");
        tasks.Count(t => t.Look?.IfThen is { Count: > 0 }).Should().Be(120, "works with an if-then");
        tasks.Sum(t => t.Look?.IfThen?.Count ?? 0).Should().Be(278, "if-then pairs on works");
        mapped.Challenges.Sum(c => c.IfThen!.Count).Should().Be(79, "if-then pairs on challenges");
        tasks.Count(t => t.Timing.Timer == ScheduleTimerKind.None).Should().Be(63, "dayless works: no date, said so");
        tasks.Count(t => t.Timing.Timer == ScheduleTimerKind.Day).Should().Be(97);
        tasks.Count(t => t.Timing.Timer == ScheduleTimerKind.Day && t.Timing.ToDay is null).Should().Be(6, "an open end stays open");

        // "15 before pruning": the file's own day (counted from its pruning) is below 1 - 15 works lead up to a pruning: 12 kit works and two April and one next-year line.
        var beforePruning = tasks.Count(t => t.Timing.FromDay is { } stored && stored - mapped.BaseByTaskKey[t.TaskKey] + 1 < 0);
        beforePruning.Should().Be(15, "before pruning (file day below 0)");
        tasks.Count(t => t.Timing.FromDay < 0).Should().Be(14, "stored below 0: the 12 kit works before the 15 Oct pruning and the two kit works on the file's day 0");
        tasks.Count(t => t.Ask is not null).Should().Be(11, "works that ask one question");
        tasks.Count(t => t.Look?.Sign is not null).Should().Be(51, "works that say what to look at");
        tasks.Count(t => t.Look?.PhotoRef is not null).Should().Be(6, "works with a picture plate");
        tasks.Count(t => t.Products!.Count > 0).Should().Be(23, "works that list what to take");
        tasks.Sum(t => t.Warnings!.Count).Should().Be(149, "warning lines");
        tasks.Select(t => t.TaskKey).Distinct().Should().HaveCount(160);
        tasks.Select(t => t.ContentHash()).Distinct().Should().HaveCount(160, "no two works are the same content");
        tasks.Should().OnlyContain(t => t.Check() == null);
        mapped.Challenges.Should().OnlyContain(c => c.Check() == null);
        mapped.StageSigns.Should().HaveCount(3, "the stages that start or end on a sign in the file's own words: to harvest, harvest to the April pruning, and to the next fruit pruning");
    }
}
