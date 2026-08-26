using AgriSync.BuildingBlocks.Analytics;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

/// <summary>
/// CWE-117. CodeQL flagged four "Log entries created from user input" sinks on
/// PR #56, all of them in the RG5 rejection logging added in this release.
/// These lines exist so a silent failure reaches a human; evidence an attacker
/// can write into is not evidence.
/// </summary>
public sealed class LogSafeTests
{
    [Theory]
    [InlineData("create_daily_log")]
    [InlineData("1.0.7")]
    [InlineData("device-abc-123")]
    public void ordinary_values_pass_through_untouched(string value)
    {
        // If the guard mangled legitimate values the logs would become useless,
        // which is its own kind of blindness.
        Assert.Equal(value, LogSafe.Text(value));
    }

    [Theory]
    [InlineData("create_daily_log\nWARN forged line")]
    [InlineData("create_daily_log\r\nWARN forged line")]
    [InlineData("create_daily_log\rWARN forged line")]
    public void a_newline_cannot_forge_a_second_log_line(string hostile)
    {
        var safe = LogSafe.Text(hostile);

        // The whole attack is getting a line break into the sink.
        Assert.DoesNotContain("\n", safe);
        Assert.DoesNotContain("\r", safe);
        // The text survives, joined — we are defusing the value, not deleting it.
        Assert.Equal("create_daily_logWARN forged line", safe);
    }

    [Fact]
    public void tabs_nulls_and_escape_sequences_are_dropped_too()
    {
        // Not just \n: a NUL truncates in some readers and ESC can drive a
        // terminal. char.IsControl covers the family.
        Assert.Equal("abcd", LogSafe.Text("a\tb\0cd"));
    }

    [Fact]
    public void one_field_cannot_flood_the_line_and_truncation_is_visible()
    {
        var safe = LogSafe.Text(new string('x', LogSafe.MaxLength * 4));

        Assert.StartsWith(new string('x', LogSafe.MaxLength), safe, StringComparison.Ordinal);
        // A reader must be able to tell a shortened value from a short one.
        Assert.EndsWith(LogSafe.TruncationMarker, safe, StringComparison.Ordinal);
        Assert.Equal(LogSafe.MaxLength + LogSafe.TruncationMarker.Length, safe.Length);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\r\t")]
    public void nothing_to_report_says_so_rather_than_logging_a_blank(string? value)
    {
        // A blank field reads as "no value was sent". "unknown" is the honest
        // rendering, and the all-control case means someone was probing.
        Assert.Equal(LogSafe.Unknown, LogSafe.Text(value));
    }

    [Fact]
    public void a_value_of_exactly_the_cap_is_not_marked_as_truncated()
    {
        var exact = new string('y', LogSafe.MaxLength);

        Assert.Equal(exact, LogSafe.Text(exact));
        Assert.DoesNotContain(LogSafe.TruncationMarker, LogSafe.Text(exact));
    }
}
