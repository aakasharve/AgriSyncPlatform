// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 (founder D-29: a reminder's due date comes from a clear cue only).
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// The server's port of the phone's <c>resolveDueDate</c>. One shared fixture
/// (<c>sync-contract/tests/fixtures/planned-work-due-cues.json</c>, produced by the phone's own resolver) pins both sides: the
/// phone's half is <c>dueDateResolver.parity.test.ts</c>.
/// </summary>
public sealed class DueHintResolverTests
{
    public static TheoryData<int> Rows()
    {
        var data = new TheoryData<int>();
        var count = Fixture().RootElement.GetProperty("cases").GetArrayLength() + Fixture().RootElement.GetProperty("extra").GetArrayLength();
        for (var i = 0; i < count; i++)
        {
            data.Add(i);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void The_server_resolves_every_cue_exactly_as_the_phone_does(int row)
    {
        var root = Fixture().RootElement;
        var cases = root.GetProperty("cases");
        JsonElement c;
        DateOnly today;
        if (row < cases.GetArrayLength())
        {
            c = cases[row];
            today = DateOnly.Parse(root.GetProperty("today").GetString()!);
        }
        else
        {
            c = root.GetProperty("extra")[row - cases.GetArrayLength()];
            today = DateOnly.Parse(c.GetProperty("today").GetString()!);
        }

        var hint = c.GetProperty("hint").ValueKind == JsonValueKind.Null ? null : c.GetProperty("hint").GetString();
        var expected = c.GetProperty("expected").ValueKind == JsonValueKind.Null ? (DateOnly?)null : DateOnly.Parse(c.GetProperty("expected").GetString()!);

        DueHintResolver.Resolve(hint, today).Should().Be(expected, $"hint '{hint}' on {today:yyyy-MM-dd}");
    }

    [Theory]
    [InlineData("नंतर")]
    [InlineData("लवकर")]
    [InlineData("या आठवड्यात")]
    [InlineData("कधीतरी")]
    [InlineData("")]
    [InlineData(null)]
    public void An_unclear_cue_is_undated_never_today(string? hint)
    {
        DueHintResolver.Resolve(hint, new DateOnly(2026, 11, 8)).Should().BeNull();
    }

    [Fact]
    public void A_cue_so_far_away_that_no_date_exists_is_undated_not_a_crash()
    {
        DueHintResolver.Resolve("99999999999 दिवसांनी", new DateOnly(2026, 11, 8)).Should().BeNull();
    }

    private static JsonDocument Fixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "planned-work-due-cues.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/planned-work-due-cues.json was not found above the test output.");
    }
}
