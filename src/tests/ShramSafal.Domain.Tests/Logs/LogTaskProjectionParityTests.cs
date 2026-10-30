// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.Content;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Lane F1 — C# ↔ TS TASK-LINE PARITY, the C# half. A phone that sends <c>content</c> sends no
/// <c>add_log_task</c>; the server writes the task lines itself (<see cref="LogTaskProjection"/>), and
/// schedule matching, compliance, the exports, the DFES day root and every OLDER phone read them. They
/// must be word for word what the phone's <c>buildTaskPayloads</c> sends.
///
/// <para>One shared fixture pins both sides: <c>sync-contract/tests/fixtures/log-task-projection.json</c>
/// (two REAL parse responses of 2026-10-30 plus edge values). The TS half,
/// <c>logTaskPayloads.projectionParity.test.ts</c>, proves the phone produces <c>expected</c>; this proves
/// the server does.</para>
/// </summary>
public sealed class LogTaskProjectionParityTests
{
    private sealed record Expected(string ActivityType, string? Notes);

    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var c in Fixture().RootElement.GetProperty("cases").EnumerateArray())
        {
            data.Add(c.GetProperty("name").GetString()!);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void The_server_writes_exactly_the_lines_the_phone_would_have_sent(string name)
    {
        var c = Fixture().RootElement.GetProperty("cases").EnumerateArray()
            .Single(x => x.GetProperty("name").GetString() == name);
        var logId = Guid.Parse(c.GetProperty("logId").GetString()!);
        var content = c.GetProperty("content");

        var lines = LogTaskProjection.Project(logId, content)
            .Select(t => new Expected(t.ActivityType, t.Notes))
            .ToList();
        var expected = c.GetProperty("expected").EnumerateArray()
            .Select(e => new Expected(
                e.GetProperty("activityType").GetString()!,
                e.GetProperty("notes").ValueKind == JsonValueKind.Null ? null : e.GetProperty("notes").GetString()))
            .ToList();

        lines.Should().Equal(expected);
        LogContentDocument.Validate(content).Should().BeNull("the fixture document is a valid content document");
    }

    [Fact]
    public void Task_ids_are_the_same_every_time_and_never_shared_between_logs()
    {
        var logA = Guid.Parse("0f1f0000-0000-4000-8000-000000000001");
        var logB = Guid.Parse("0f1f0000-0000-4000-8000-000000000002");

        LogTaskProjection.TaskIdFor(logA, "irrigation", "irr-1")
            .Should().Be(LogTaskProjection.TaskIdFor(logA, "irrigation", "irr-1"), "a resend must not write a second line");
        LogTaskProjection.TaskIdFor(logA, "irrigation", "irr-1")
            .Should().NotBe(LogTaskProjection.TaskIdFor(logB, "irrigation", "irr-1"), "two logs never collide on log_tasks");
        LogTaskProjection.TaskIdFor(logA, "irrigation", "x")
            .Should().NotBe(LogTaskProjection.TaskIdFor(logA, "inputs", "x"));

        // RFC 4122 version 5, variant 1.
        var id = LogTaskProjection.TaskIdFor(logA, "inputs", "p-1").ToString();
        id[14].Should().Be('5');
        "89ab".Should().Contain(id[19].ToString());
    }

    [Theory]
    [InlineData(2.0, "2")]
    [InlineData(1.5, "1.5")]
    [InlineData(0.25, "0.25")]
    [InlineData(250.0, "250")]
    [InlineData(1200.5, "1200.5")]
    [InlineData(0.001, "0.001")]
    [InlineData(1e-7, "1e-7")]
    [InlineData(1.5e16, "15000000000000000")]
    [InlineData(1e21, "1e+21")]
    [InlineData(-3.0, "-3")]
    public void Numbers_read_the_way_JavaScript_writes_them(double value, string expected)
    {
        LogTaskProjection.JsNumber(value).Should().Be(expected);
    }

    [Fact]
    public void An_item_with_no_usable_activity_gets_no_line_but_keeps_its_place_in_the_content()
    {
        using var doc = JsonDocument.Parse("""{"schema":1,"cropActivities":[{"id":"c1","title":"  "},{"id":"c2","title":7},{"id":"c3","title":"Pruning"}]}""");
        LogTaskProjection.Project(Guid.NewGuid(), doc.RootElement)
            .Select(t => t.ActivityType).Should().Equal("Pruning");
    }

    private static JsonDocument Fixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "log-task-projection.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/log-task-projection.json was not found above the test output.");
    }
}
