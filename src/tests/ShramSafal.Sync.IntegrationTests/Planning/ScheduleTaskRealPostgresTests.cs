// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The task format against a REAL Postgres as agrisync_app (E3 first, in every fact):
//   * nothing is lost on the way in and out (every field of every kind of task, the challenges, the stage signs), and the stored hash is the hash of what was
//     read back (jsonb reorders keys: the canonical form is what makes the hash stable);
//   * isolation in BOTH directions (E4): each scope reads only what the row policy lets it, a write names only a tenant the caller belongs to, and the child can
//     never claim a tenant its version does not have (a trigger compares the two);
//   * append-only by privilege; the table's own rules (negative days are valid; a task's columns agree with its timer; one key once per version);
//   * the existing loaders still return a version exactly as before (they do not read the new tables).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;
using Xunit.Abstractions;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleTaskRealPostgresTests(ScheduleTaskDb lane, ITestOutputHelper output) : IClassFixture<ScheduleTaskDb>
{
    private static readonly DateTime Now = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    // ---- nothing is lost -------------------------------------------------------------------------------------------

    /// <summary>Every kind, every timer, every repeat, every optional part set once - the always-on round trip (the grape year file is the other, see the year suite).</summary>
    public static IReadOnlyList<ScheduleTaskContent> Everything() =>
    [
        new("every-field", "लांबट मण्यांचे वाण: GA३", ScheduleTaskKind.Spray,
            ScheduleTaskTiming.OnDays(35, 50, "फुलोरा (दिवस ३६–५०)").Repeating(ScheduleRepeatMode.EveryNDays, 7, endDay: 60),
            ScheduleBasis.OurChoice, StageIndex: 0, Order: 1,
            Why: "मणी लांबट होण्यासाठी.", Dose: "GA३ १५ ppm; ५०% फुलोरा GA३ २० ppm",
            Steps: ["हे फक्त लांबट मणी हवे असलेल्या वाणांसाठी आहे.", "सामू ५.५–६ ठेवा."],
            Products: [new ScheduleProduct("GA३", "१५", "ppm", "लिटर पाणी", "५०० लिटर"), new ScheduleProduct("सायट्रिक ऍसिड")],
            ReEntryHours: 24, PreHarvestDays: 15, Warnings: ["पूर्ण फुलोऱ्यात फवारल्यास मणी गळतात."],
            Look: new ScheduleTaskLook("घड", "५ वेली", "मणी लांबट", "५०%", [new ScheduleIfThen("पाऊस", "फवारणी पुढे ढकला")], "P02"),
            Ask: new ScheduleTaskAsk("फुलोरा ५०% झाला का?", "सकाळी", [new ScheduleAnswer("yes", "आज फवारा"), new ScheduleAnswer("no", "उद्या पुन्हा पाहा")]),
            Sources: [new ScheduleSource("पुस्तक", "८२"), new ScheduleSource("NRC साप्ताहिक सल्ला, १८ मे २०२३")],
            Origin: "reader"),
        new("before-start", "माती तपासणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(-20, -18), ScheduleBasis.Stated, Order: 2),
        new("after-one", "दुसरी फवारणी", ScheduleTaskKind.Spray,
            ScheduleTaskTiming.AfterTask("every-field", usualDays: 4, earliestDays: 3, latestDays: 9, whenWords: "४–५ दिवसांनी")
                .Repeating(ScheduleRepeatMode.PerWeek, 2, endSign: "फळे पक्व झाल्यावर"),
            ScheduleBasis.Experience, StageIndex: 1, Order: 3),
        new("sign-one", "कूज", ScheduleTaskKind.Nutrition,
            ScheduleTaskTiming.WhenSeen("पाकळ्या फुगलेल्या दिसल्यावर", -5, 9, "फुलोऱ्याच्या अगदी आधी"), ScheduleBasis.Assumed, StageIndex: 1, Order: 4),
        new("dayless", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.None("मणी ३–४ मि.मी. झाल्यावर"), ScheduleBasis.Stated, Order: 5),
        new("open-end", "माइट", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(60), ScheduleBasis.Stated, Order: 6),
    ];

    [Fact]
    public async Task Every_field_of_every_kind_of_task_survives_the_database_and_the_stored_hash_is_the_hash_of_what_was_read()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);
        var id = Guid.NewGuid();
        // A version with stages, so the stage indexes (0 and 1) and the signs are checked too.
        var withStages = ScheduleTemplate.Import(
            id, "round trip", ScheduleOwnerType.User, "my source", "Grapes", new UserId(Owner1), TenantScope.Team, Now,
            [new StageDefinition("छाटणी", 0, 40), new StageDefinition("फुलोरा", 41, 60)],
            [new ImportedActivity(null, "Pruning", 0, 0, FrequencyMode.OneTime, 1)], out var importProblem)!;
        importProblem.Should().BeNull();
        withStages.SetStageSigns([new ScheduleStageSign(1, "फुलोरा दिसल्यावर", "मणी धरल्यावर")], out _).Should().BeTrue();
        var challenges = new[]
        {
            new ScheduleChallengeContent("mildew", "केवडा घडांवर (फसवा काळ)", 1, 2, "दिवस ३५–५० (फुलोरा)", "फुलं गळतात", "५ दिवसांच्या अंतराने दोन फवारण्या",
                [new ScheduleIfThen("नोव्हेंबर-डिसेंबरमध्ये पाऊस झाला", "फवारण्या वाढवा")], [new ScheduleSource("GAP", "३५"), new ScheduleSource("पुस्तक", "८३")]),
            new ScheduleChallengeContent("bare", "भुरी"),
        };
        withStages.SetTasks(Everything(), challenges, out var setProblem).Should().BeTrue(setProblem?.Message);
        try
        {
            await RoundTripAsync(id, withStages, challenges);
        }
        finally
        {
            // The fixture's database is shared by the other facts of this class: take this version (and, by cascade, its tasks, challenges and stages) out again.
            await using var cleanup = new NpgsqlConnection(lane.SuperuserConn);
            await cleanup.OpenAsync();
            await ScheduleTaskDb.ExecAsync(cleanup, "DELETE FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", id));
        }
    }

    private async Task RoundTripAsync(Guid id, ScheduleTemplate withStages, ScheduleChallengeContent[] challenges)
    {
        // Written as the application role, in ONE SaveChanges with its parent (an EXISTS-based policy would fail here: F8), under the owner's own scope.
        await using (var write = lane.AppContext())
        {
            await using var tx = await write.Database.BeginTransactionAsync();
            await write.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.farm_id', {0}, true), set_config('agrisync.user_id', {1}, true)", Farm1.ToString(), Owner1.ToString());
            write.ScheduleTemplates.Add(withStages);
            await write.SaveChangesAsync();
            await tx.CommitAsync();
        }

        await using var read = lane.AppContext();
        await using var readTx = await read.Database.BeginTransactionAsync();
        await read.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.farm_id', {0}, true), set_config('agrisync.user_id', {1}, true)", Farm1.ToString(), Owner1.ToString());
        var loaded = await read.ScheduleTemplates
            .Include(t => t.Tasks).Include(t => t.Challenges).Include(t => t.StageRows).Include(t => t.Activities)
            .AsSplitQuery().AsNoTracking().SingleAsync(t => t.Id == id);

        loaded.Tasks.Should().HaveCount(6);
        loaded.Challenges.Should().HaveCount(2);
        foreach (var expected in Everything())
        {
            var row = loaded.Tasks.Single(t => t.TaskKey == expected.TaskKey);
            row.Content.Should().BeEquivalentTo(expected.Normalized(), $"task {expected.TaskKey}: every field comes back");
            row.ContentHash.Should().Be(expected.ContentHash(), "the hash stored is the hash of the content as written");
            row.Content.ContentHash().Should().Be(row.ContentHash, "...and of the content as read back (jsonb reorders keys; the canonical form does not care)");
            row.TenantScope.Should().Be(TenantScope.Team);
            row.OwnerUserId.Should().Be(new UserId(Owner1));
        }

        foreach (var expected in challenges)
        {
            var row = loaded.Challenges.Single(c => c.ChallengeKey == expected.ChallengeKey);
            row.Content.Should().BeEquivalentTo(expected.Normalized());
            row.ContentHash.Should().Be(expected.ContentHash());
        }

        // The derived columns agree with the content.
        loaded.Tasks.Single(t => t.TaskKey == "before-start").Should().Match<ScheduleTask>(t => t.FromDay == -20 && t.ToDay == -18 && t.TimerKind == ScheduleTimerKind.Day);
        loaded.Tasks.Single(t => t.TaskKey == "after-one").Should().Match<ScheduleTask>(t => t.AfterTaskKey == "every-field" && t.FromDay == null && t.TimerKind == ScheduleTimerKind.After);
        loaded.Tasks.Single(t => t.TaskKey == "sign-one").Should().Match<ScheduleTask>(t => t.FromDay == null && t.TimerKind == ScheduleTimerKind.Sign);
        loaded.Tasks.Single(t => t.TaskKey == "open-end").Should().Match<ScheduleTask>(t => t.FromDay == 60 && t.ToDay == null);
        loaded.StageRows.OrderBy(s => s.OrderIndex).Select(s => (s.StartSign, s.EndSign))
            .Should().Equal(new (string?, string?)[] { (null, null), ("फुलोरा दिसल्यावर", "मणी धरल्यावर") });
        loaded.Stages.Select(s => (s.Name, s.StartDay, s.EndDay)).Should().Equal(new (string, int, int)[] { ("छाटणी", 0, 40), ("फुलोरा", 41, 60) });
    }

    [Fact]
    public async Task The_existing_loaders_return_a_version_with_tasks_exactly_as_before_and_do_not_read_the_task_tables()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);

        // Review Focus 4 for this slice: nothing a released phone reads changes. The repository's own loaders (the pull, clone, edit and publish use them)
        // return the version with its activities and stages and an EMPTY task list: tasks are read only by a loader that asks for them.
        await using var db = lane.AppContext();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.user_id', {0}, true)", Owner1.ToString());
        var repository = new ShramSafalRepository(db);

        var one = await repository.GetScheduleTemplateByIdAsync(Team1Id);
        one.Should().NotBeNull();
        one!.Tasks.Should().BeEmpty("the by-id loader does not Include tasks (slice 3's own loader will)");
        one.Challenges.Should().BeEmpty();
        one.HasStoredDays.Should().BeFalse("a version made empty reads as one that stores no days, as before");

        var all = await repository.GetScheduleTemplatesAsync();
        all.Select(t => t.Id).Should().Contain([LibraryId, Team1Id, Private2Id, Team2Id]);
        all.Should().OnlyContain(t => t.Tasks.Count == 0 && t.Challenges.Count == 0);
        all.Single(t => t.Id == LibraryId).Activities.Should().ContainSingle("the legacy activities of a version with tasks are untouched");
        all.Single(t => t.Id == LibraryId).Stages.Should().Equal(new StageDefinition("छाटणी", 0, 40));
    }

    // ---- isolation, both directions (E4) -------------------------------------------------------------------------------

    public static IEnumerable<object?[]> ReadMatrix() =>
    [
        // who, farm scope, what they may read (a library row is everyone's; a Team row its owner's and the people of the owner's farm; a Private row its owner's)
        ["owner of farm 1, user scope", Owner1, null, new[] { LibraryTask, Team1Task }],
        ["owner of farm 1, farm 1 scope", Owner1, Farm1, new[] { LibraryTask, Team1Task }],
        ["worker of farm 1, user scope", Worker1, null, new[] { LibraryTask, Team1Task }],
        ["worker of farm 1, farm 1 scope", Worker1, Farm1, new[] { LibraryTask, Team1Task }],
        ["paused seat of farm 1", Paused1, null, new[] { LibraryTask }],
        ["owner of farm 2, user scope", Owner2, null, new[] { LibraryTask, Private2Task, Team2Task }],
        ["owner of farm 2, farm 2 scope", Owner2, Farm2, new[] { LibraryTask, Private2Task, Team2Task }],
        ["a stranger with no farm", Stranger, null, new[] { LibraryTask }],
        ["staff, user scope", Staff, null, new[] { LibraryTask }],
        ["owner of farm 1 under FARM 2's scope (a seat of nobody there)", Owner1, Farm2, new[] { LibraryTask, Team1Task }],
        ["a request that names no user (a farm scope without a person)", null, Farm1, new[] { LibraryTask }],
        ["no scope at all", null, null, new[] { LibraryTask }],
    ];

    [Theory]
    [MemberData(nameof(ReadMatrix))]
    public async Task A_scope_reads_only_the_rows_the_policy_gives_it(string who, Guid? user, Guid? farm, string[] expectedTasks)
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);

        (await lane.VisibleKeysAsync(user, farm)).Should().Equal(expectedTasks.OrderBy(k => k, StringComparer.Ordinal), who);

        // The challenges follow the same policy: the same rows, by their versions.
        var expectedChallenges = expectedTasks.Select(k => k + "-c").OrderBy(k => k, StringComparer.Ordinal);
        (await lane.VisibleKeysAsync(user, farm, "ssf.schedule_challenges", "challenge_key")).Should().Equal(expectedChallenges, who);
    }

    [Fact]
    public async Task A_write_names_only_a_tenant_the_caller_belongs_to_and_never_a_tenant_its_version_does_not_have()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);
        const int @private = (int)TenantScope.Private;
        const int team = (int)TenantScope.Team;
        const int @public = (int)TenantScope.Public;

        // The owner writes onto his own version; so does a worker of his farm (the typist of the owner's schedule, D-88).
        (await lane.TryInsertTaskAsync(Owner1, Farm1, Team1Id, team, Owner1, "w-owner")).Should().BeNull();
        (await lane.TryInsertTaskAsync(Worker1, Farm1, Team1Id, team, Owner1, "w-worker")).Should().BeNull("a worker of the owner's farm types the owner's schedule");
        (await lane.TryInsertTaskAsync(Owner2, Farm2, Private2Id, @private, Owner2, "w-private")).Should().BeNull();

        // Foreign CHILD: another person's row policy refuses a row that names a tenant the caller is not in (42501 = the row policy).
        (await lane.TryInsertTaskAsync(Owner2, Farm2, Team1Id, team, Owner1, "x1")).Should().Be("42501", "farm 2's owner is no one of farm 1's team");
        (await lane.TryInsertTaskAsync(Stranger, null, Team1Id, team, Owner1, "x2")).Should().Be("42501");
        (await lane.TryInsertTaskAsync(Worker1, Farm1, Team1Id, @private, Owner1, "x3")).Should().Be("42501", "a worker never writes a Private row of someone else");
        (await lane.TryInsertTaskAsync(Paused1, null, Team1Id, team, Owner1, "x4")).Should().Be("42501", "a paused seat is not on the team");
        (await lane.TryInsertTaskAsync(null, Farm1, Team1Id, team, Owner1, "x5")).Should().Be("42501", "a write needs a person");
        (await lane.TryInsertTaskAsync(Owner1, Farm1, Team1Id, team, null, "x6")).Should().Be("42501", "a row that names no owner is for the migration role only");

        // Foreign PARENT (E4: the foreign key checks outside the row policy, so the version itself must agree): a row naming ANOTHER person's version as its
        // parent is refused even when the caller names himself as its owner, because the row's tenant must be the version's.
        (await lane.TryInsertTaskAsync(Owner2, Farm2, Team1Id, team, Owner2, "y1")).Should().Be("42501", "the version is farm 1 owner's, not farm 2 owner's");
        (await lane.TryInsertTaskAsync(Owner1, Farm1, Team2Id, team, Owner1, "y2")).Should().Be("42501", "farm 2's version is not farm 1's owner's");
        (await lane.TryInsertTaskAsync(Owner1, Farm1, Team1Id, @public, Owner1, "y3")).Should().Be("42501", "a Team version's tasks are Team, never Public");
        (await lane.TryInsertTaskAsync(Owner1, Farm1, Guid.NewGuid(), team, Owner1, "y4")).Should().Be("42501", "no such version");

        // The documented limit (the same as the library rows have today, which have no policy at all): a row of a Public version, owned by the person who writes
        // it, is not refused by the database - the application's ScheduleReview gate is the wall for who may write the library.
        (await lane.TryInsertTaskAsync(Staff, null, LibraryId, @public, Staff, "z1")).Should().BeNull();
        (await lane.TryInsertTaskAsync(Stranger, null, LibraryId, @public, Staff, "z2")).Should().Be("42501", "...but never a row that names someone else as its owner");
    }

    [Fact]
    public async Task The_application_role_can_read_and_write_but_never_change_or_remove_a_task()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);

        foreach (var table in new[] { "ssf.schedule_tasks", "ssf.schedule_challenges" })
        {
            await lane.AsAppAsync<int>(null, null, async db =>
            {
                foreach (var (privilege, expected) in new[] { ("SELECT", true), ("INSERT", true), ("UPDATE", false), ("DELETE", false), ("TRUNCATE", false) })
                {
                    await using var cmd = db.CreateCommand();
                    cmd.CommandText = "SELECT has_table_privilege(current_user, @t, @p)";
                    cmd.Parameters.AddWithValue("t", table);
                    cmd.Parameters.AddWithValue("p", privilege);
                    ((bool)(await cmd.ExecuteScalarAsync())!).Should().Be(expected, $"{privilege} on {table}");
                }

                return 0;
            });

            (await lane.SuperCountAsync(
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = @t AND c.relrowsecurity AND c.relforcerowsecurity",
                ("t", table.Split('.')[1]))).Should().Be(1, $"{table} is under FORCE row-level security");
        }

        // A real UPDATE and DELETE are refused (42501), whoever asks.
        var update = await lane.AsAppAsync<string?>(Owner1, Farm1, db => TryAsync(db, "UPDATE ssf.schedule_tasks SET name = 'changed' WHERE task_key = 'team1-task'"));
        var delete = await lane.AsAppAsync<string?>(Owner1, Farm1, db => TryAsync(db, "DELETE FROM ssf.schedule_tasks WHERE task_key = 'team1-task'"));
        update.Should().Be("42501");
        delete.Should().Be("42501");
        (await lane.SuperCountAsync("SELECT count(*) FROM ssf.schedule_tasks WHERE task_key = 'team1-task' AND name = 'काम team1-task'")).Should().Be(1);
    }

    // ---- the table's own rules -----------------------------------------------------------------------------------------

    [Fact]
    public async Task The_table_holds_negative_days_keeps_a_task_s_columns_in_step_with_its_timer_and_one_key_once_per_version()
    {
        await lane.AssertAppRoleIsNotVacuousAsync(output);
        Task<string?> Insert(string key, string timer, string? from, string? to, string? after, int times = 1) => InsertSuperAsync($"""
            INSERT INTO ssf.schedule_tasks (id, schedule_template_id, tenant_scope, owner_user_id, task_key, stage_index, order_index, name, kind, timer_kind,
                                            from_day, to_day, after_task_key, content, content_hash)
            VALUES (gen_random_uuid(), '{Team1Id}', 1, '{Owner1}', '{key}', 0, 0, 'n', 'work', '{timer}', {from ?? "NULL"}, {to ?? "NULL"}, {(after is null ? "NULL" : $"'{after}'")},
                    jsonb_build_object(), repeat('a', 64))
            """, times);

        (await Insert("c-neg", "day", "-20", "-18", null)).Should().BeNull("a negative day is valid: 'छाटणीआधी २० दिवस'");
        (await Insert("c-backwards", "day", "5", "4", null)).Should().Be("23514", "a window may not end before it starts");
        (await Insert("c-nofrom", "day", null, null, null)).Should().Be("23514", "a day timer needs its first day");
        (await Insert("c-twice", "after", "3", null, "x")).Should().Be("23514", "an 'after' holds no day");
        (await Insert("c-none-with-day", "none", "3", null, null)).Should().Be("23514", "no timer yet holds no day");
        (await Insert("c-sign-with-after", "sign", null, null, "x")).Should().Be("23514");
        (await Insert("c-far", "day", "9999", null, null)).Should().Be("23514", "a day stays within 3650 either way");
        (await Insert("c-badtimer", "weekly", null, null, null)).Should().Be("23514");
        (await Insert("c-dup", "none", null, null, null, times: 2)).Should().Be("23505", "one key once per version");
    }

    /// <summary>Runs the INSERT <paramref name="times"/> times as superuser in one transaction that is always rolled back; the SQLSTATE of the first refusal, or null.</summary>
    private async Task<string?> InsertSuperAsync(string sql, int times)
    {
        await using var db = new NpgsqlConnection(lane.SuperuserConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        for (var i = 0; i < times; i++)
        {
            if (await TryAsync(db, sql) is { } state)
            {
                return state;
            }
        }

        return null;
    }

    private static async Task<string?> TryAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }
}
