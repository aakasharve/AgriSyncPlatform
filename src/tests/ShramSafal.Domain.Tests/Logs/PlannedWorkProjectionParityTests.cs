// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 Task 2 (C# half of the projection pin).
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Which planned items of a content document become a spoken reminder, and exactly what each carries - the same on the server
/// (<see cref="PlannedWorkProjection"/>) and the phone (<c>spokenReminders.ts</c>). One shared fixture
/// (<c>sync-contract/tests/fixtures/planned-work-projection.json</c>) pins both sides.
/// </summary>
public sealed class PlannedWorkProjectionParityTests
{
    public static TheoryData<int> Cases()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Fixture().RootElement.GetProperty("cases").GetArrayLength(); i++)
        {
            data.Add(i);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void The_server_projects_exactly_what_the_phone_shows(int index)
    {
        var root = Fixture().RootElement;
        var c = root.GetProperty("cases")[index];
        var logId = Guid.Parse(root.GetProperty("logId").GetString()!);
        var logDay = DateOnly.Parse(root.GetProperty("logDay").GetString()!);

        var found = PlannedWorkProjection.Project(logId, logDay, c.GetProperty("content"));

        var expected = c.GetProperty("expected").EnumerateArray().Select(e => new SpokenReminder(
            e.GetProperty("id").ValueKind == JsonValueKind.Null
                ? PlannedWorkIds.ForSpokenItem(logId, e.GetProperty("itemKey").GetString()!)
                : Guid.Parse(e.GetProperty("id").GetString()!),
            e.GetProperty("itemKey").GetString()!,
            e.GetProperty("title").GetString()!,
            e.GetProperty("dueDate").ValueKind == JsonValueKind.Null ? null : DateOnly.Parse(e.GetProperty("dueDate").GetString()!),
            e.GetProperty("namedPlotId").ValueKind == JsonValueKind.Null ? null : Guid.Parse(e.GetProperty("namedPlotId").GetString()!),
            e.GetProperty("itemSourceType").ValueKind == JsonValueKind.Null ? null : e.GetProperty("itemSourceType").GetString())).ToList();

        found.Should().Equal(expected, $"case '{c.GetProperty("name").GetString()}'");
    }

    private static JsonDocument Fixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "planned-work-projection.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/planned-work-projection.json was not found above the test output.");
    }
}
