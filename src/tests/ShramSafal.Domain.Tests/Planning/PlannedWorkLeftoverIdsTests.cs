// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-79, R14; P3): the id of the reminder a log task saved Partial, Delayed or
// Skipped leaves behind is a UUIDv5 of (log, task, "leftover"), the same on the server and on the phone. One shared fixture of vectors
// (sync-contract/tests/fixtures/planned-work-leftover-ids.json) pins both sides: the phone's half is plannedWorkLeftoverIds.test.ts.
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedWorkLeftoverIdsTests
{
    public static TheoryData<string, string, string> Leftover()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var v in Fixture().RootElement.GetProperty("leftover").EnumerateArray())
        {
            data.Add(v.GetProperty("logId").GetString()!, v.GetProperty("taskId").GetString()!, v.GetProperty("id").GetString()!);
        }

        return data;
    }

    public static TheoryData<string, int, string> Job()
    {
        var data = new TheoryData<string, int, string>();
        foreach (var v in Fixture().RootElement.GetProperty("job").EnumerateArray())
        {
            data.Add(v.GetProperty("logId").GetString()!, v.GetProperty("index").GetInt32(), v.GetProperty("id").GetString()!);
        }

        return data;
    }

    [Fact]
    public void The_namespace_is_the_one_every_spoken_reminder_lives_under()
    {
        PlannedWorkIds.Namespace.Should().Be(Guid.Parse(Fixture().RootElement.GetProperty("namespace").GetString()!));
    }

    [Theory]
    [MemberData(nameof(Leftover))]
    public void A_log_task_gets_the_id_the_phone_gives_it(string logId, string taskId, string expected)
    {
        PlannedWorkIds.ForLeftover(Guid.Parse(logId), Guid.Parse(taskId)).Should().Be(Guid.Parse(expected));
    }

    [Theory]
    [MemberData(nameof(Job))]
    public void An_item_of_a_confirmed_voice_parse_gets_the_id_by_its_place(string logId, int index, string expected)
    {
        PlannedWorkIds.ForLeftoverJobItem(Guid.Parse(logId), index).Should().Be(Guid.Parse(expected));
    }

    [Fact]
    public void The_id_is_the_same_every_time_differs_per_task_and_never_collides_with_a_spoken_reminder()
    {
        var log = Guid.Parse("0f1f0000-0000-4000-8000-000000000001");
        var task = Guid.Parse("0f1f0000-0000-4000-8000-000000000002");
        PlannedWorkIds.ForLeftover(log, task).Should().Be(PlannedWorkIds.ForLeftover(log, task));
        PlannedWorkIds.ForLeftover(log, task).Should().NotBe(PlannedWorkIds.ForLeftover(log, Guid.Parse("0f1f0000-0000-4000-8000-000000000003")));
        PlannedWorkIds.ForLeftover(log, task).Should().NotBe(PlannedWorkIds.ForSpokenItem(log, task.ToString()));
        PlannedWorkIds.ForLeftoverJobItem(log, 0).Should().NotBe(PlannedWorkIds.ForJobItem(log, 0));
        PlannedWorkIds.ForLeftover(log, task).ToString()[14].Should().Be('5', "a version 5 id");
    }

    private static JsonDocument Fixture()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "sync-contract", "tests", "fixtures", "planned-work-leftover-ids.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/planned-work-leftover-ids.json was not found above the test binaries.");
    }
}
