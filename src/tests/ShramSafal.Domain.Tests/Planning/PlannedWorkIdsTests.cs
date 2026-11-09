// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 Task 2 (a replay never duplicates a spoken task).
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// The id of a task made from a spoken planned item is a UUIDv5 of (log, item), the same on the server and on the phone.
/// One shared fixture of vectors (<c>sync-contract/tests/fixtures/planned-work-ids.json</c>) pins both sides: the phone's
/// half is <c>plannedWorkIds.test.ts</c>.
/// </summary>
public sealed class PlannedWorkIdsTests
{
    public static TheoryData<string, string, string> Spoken()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var v in Fixture().RootElement.GetProperty("spoken").EnumerateArray())
        {
            data.Add(v.GetProperty("logId").GetString()!, v.GetProperty("itemId").GetString()!, v.GetProperty("id").GetString()!);
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
    public void The_namespace_is_the_fixtures_namespace()
    {
        PlannedWorkIds.Namespace.Should().Be(Guid.Parse(Fixture().RootElement.GetProperty("namespace").GetString()!));
    }

    [Theory]
    [MemberData(nameof(Spoken))]
    public void A_spoken_item_gets_the_id_the_phone_gives_it(string logId, string itemId, string expected)
    {
        PlannedWorkIds.ForSpokenItem(Guid.Parse(logId), itemId).Should().Be(Guid.Parse(expected));
    }

    [Theory]
    [MemberData(nameof(Job))]
    public void An_item_of_a_confirmed_voice_parse_gets_the_id_by_its_place(string logId, int index, string expected)
    {
        PlannedWorkIds.ForJobItem(Guid.Parse(logId), index).Should().Be(Guid.Parse(expected));
    }

    [Fact]
    public void The_id_is_the_same_every_time_differs_per_log_and_per_item_and_is_a_version_5_id()
    {
        var logA = Guid.Parse("0f1f0000-0000-4000-8000-000000000001");
        var logB = Guid.Parse("0f1f0000-0000-4000-8000-000000000002");

        PlannedWorkIds.ForSpokenItem(logA, "t1").Should().Be(PlannedWorkIds.ForSpokenItem(logA, "t1"));
        PlannedWorkIds.ForSpokenItem(logA, "t1").Should().NotBe(PlannedWorkIds.ForSpokenItem(logB, "t1"), "two logs never collide");
        PlannedWorkIds.ForSpokenItem(logA, "t1").Should().NotBe(PlannedWorkIds.ForSpokenItem(logA, "t2"));
        PlannedWorkIds.ForSpokenItem(logA, "0").Should().NotBe(PlannedWorkIds.ForJobItem(logA, 0), "a content item and a parse item never share an id");

        var text = PlannedWorkIds.ForSpokenItem(logA, "t1").ToString();
        text[14].Should().Be('5');
        "89ab".Should().Contain(text[19].ToString());
    }

    [Fact]
    public void The_id_does_not_depend_on_an_items_place_in_the_list()
    {
        // The key is the item's OWN id, so a later reorder, or an item inserted in the middle, can never re-create or collide.
        var log = Guid.Parse("0f1f0000-0000-4000-8000-000000000003");
        PlannedWorkIds.ForSpokenItem(log, "pipeline").Should().Be(PlannedWorkIds.ForSpokenItem(log, "pipeline"));
    }

    private static JsonDocument Fixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "planned-work-ids.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/planned-work-ids.json was not found above the test output.");
    }
}
