// spec: voice-instant-phase-a-2026-11-23 (Task 0, server half) - the Server-Timing response header of a voice parse.
//
// Authored from the acceptance criteria only. In-memory: a DefaultHttpContext and a capturing logger, no host, no database
// (this project's real-Postgres tests are not touched).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using ShramSafal.Api.Endpoints;
using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Voice;

public sealed class VoiceServerTimingHeaderTests
{
    private const string HeaderName = "Server-Timing";

    private static readonly Regex Shape = new(
        "^s3;dur=(?<s3>[0-9]+), stt;dur=(?<stt>[0-9]+), struct;dur=(?<struct>[0-9]+), total;dur=(?<total>[0-9]+)$",
        RegexOptions.CultureInvariant);

    private static string Write(
        VoiceStageTimings? timings,
        TimeSpan handler,
        ILogger? logger = null,
        DefaultHttpContext? context = null)
    {
        context ??= new DefaultHttpContext();
        AiEndpoints.WriteVoiceTimings(context, logger ?? new CapturingLogger(), timings, handler, Guid.NewGuid(), 31_000);
        return context.Response.Headers[HeaderName].ToString();
    }

    private static Match Parse(string header)
    {
        var match = Shape.Match(header);
        Assert.True(match.Success, $"not a valid Server-Timing value: '{header}'");
        return match;
    }

    [Fact]
    public void The_header_carries_s3_stt_struct_and_total_in_whole_milliseconds()
    {
        var header = Write(new VoiceStageTimings(120, 2400, 3100, 5800, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(4000));

        Assert.Equal("s3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800", header);
    }

    [Fact]
    public void Total_is_never_less_than_the_time_spent_in_the_handler()
    {
        var header = Write(new VoiceStageTimings(10, 20, 30, 100, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(250));

        var match = Parse(header);
        Assert.Equal(250, int.Parse(match.Groups["total"].Value, CultureInfo.InvariantCulture)); // covers the handler's own database work
        Assert.Equal(10, int.Parse(match.Groups["s3"].Value, CultureInfo.InvariantCulture)); // the stages are left alone
        Assert.Equal(20, int.Parse(match.Groups["stt"].Value, CultureInfo.InvariantCulture));
        Assert.Equal(30, int.Parse(match.Groups["struct"].Value, CultureInfo.InvariantCulture));
    }

    [Fact]
    public void When_the_orchestrator_total_is_larger_it_is_kept()
    {
        var header = Write(new VoiceStageTimings(1, 2, 3, 900, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(250));

        Assert.Equal(900, int.Parse(Parse(header).Groups["total"].Value, CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(0.4)]
    [InlineData(0.5)]
    [InlineData(12.4)]
    [InlineData(12.5)]
    [InlineData(12.6)]
    [InlineData(999.999)]
    [InlineData(123456.789)]
    public void A_fractional_handler_time_never_makes_a_non_integer_value_and_total_is_at_least_the_whole_handler_milliseconds(double handlerMs)
    {
        var header = Write(null, TimeSpan.FromMilliseconds(handlerMs));

        Assert.DoesNotContain(".", header, StringComparison.Ordinal);
        var total = int.Parse(Parse(header).Groups["total"].Value, CultureInfo.InvariantCulture);
        Assert.True(total >= (int)Math.Floor(handlerMs), $"total {total} is below the handler time {handlerMs}");
        Assert.True(total <= (int)Math.Ceiling(handlerMs) + 1, $"total {total} is far above the handler time {handlerMs}");
    }

    [Fact]
    public void A_missing_timings_object_still_writes_a_valid_header_with_zero_stages_and_the_handler_time_as_total()
    {
        var header = Write(null, TimeSpan.FromMilliseconds(321));

        Assert.Equal("s3;dur=0, stt;dur=0, struct;dur=0, total;dur=321", header);
    }

    [Theory]
    [InlineData(-1, 5, 6, 7)]
    [InlineData(5, -1, 6, 7)]
    [InlineData(5, 6, -1, 7)]
    [InlineData(5, 6, 7, -1)]
    [InlineData(int.MinValue, int.MinValue, int.MinValue, int.MinValue)]
    public void A_negative_stage_or_total_is_never_written(int s3, int stt, int structure, int total)
    {
        var header = Write(new VoiceStageTimings(s3, stt, structure, total, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(7));

        Assert.DoesNotContain("-", header, StringComparison.Ordinal);
        var match = Parse(header);
        foreach (var group in new[] { "s3", "stt", "struct", "total" })
        {
            Assert.True(int.Parse(match.Groups[group].Value, CultureInfo.InvariantCulture) >= 0);
        }
    }

    [Fact]
    public void A_negative_handler_time_never_makes_a_negative_total()
    {
        var header = Write(new VoiceStageTimings(0, 0, 0, 0, VoiceStageTimings.OneCallPath), TimeSpan.FromMilliseconds(-50));

        Assert.DoesNotContain("-", header, StringComparison.Ordinal);
        Assert.Equal(0, int.Parse(Parse(header).Groups["total"].Value, CultureInfo.InvariantCulture));
    }

    [Fact]
    public void The_largest_possible_numbers_do_not_overflow()
    {
        var header = Write(
            new VoiceStageTimings(int.MaxValue, int.MaxValue, int.MaxValue, int.MaxValue, VoiceStageTimings.TwoStagePath),
            TimeSpan.MaxValue);

        var match = Parse(header);
        Assert.Equal(int.MaxValue, int.Parse(match.Groups["total"].Value, CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData("fr-FR")]
    [InlineData("ar-SA")]
    [InlineData("mr-IN")]
    public void The_header_is_plain_ascii_digits_in_every_culture(string culture)
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(culture);

            var header = Write(new VoiceStageTimings(1234, 56789, 100, 700000, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(1234.5));

            Assert.Equal("s3;dur=1234, stt;dur=56789, struct;dur=100, total;dur=700000", header);
        }
        finally
        {
            CultureInfo.CurrentCulture = before;
        }
    }

    [Fact]
    public void The_header_is_set_once_and_replaces_any_earlier_value()
    {
        var context = new DefaultHttpContext();
        context.Response.Headers[HeaderName] = "earlier;dur=1";

        Write(new VoiceStageTimings(1, 2, 3, 4, VoiceStageTimings.TwoStagePath), TimeSpan.Zero, context: context);

        var values = context.Response.Headers[HeaderName];
        Assert.Single(values);
        Assert.Equal("s3;dur=1, stt;dur=2, struct;dur=3, total;dur=4", values.ToString());
    }

    [Fact]
    public void One_log_line_names_the_path_and_the_numbers()
    {
        var logger = new CapturingLogger();

        Write(new VoiceStageTimings(120, 2400, 3100, 5800, VoiceStageTimings.TwoStagePath), TimeSpan.FromMilliseconds(5000), logger);

        var line = Assert.Single(logger.Lines);
        Assert.Contains(VoiceStageTimings.TwoStagePath, line, StringComparison.Ordinal);
        foreach (var number in new[] { "120", "2400", "3100", "5800" })
        {
            Assert.Contains(number, line, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A_cached_answer_says_so_in_the_log_so_a_zero_is_never_read_as_instant()
    {
        var logger = new CapturingLogger();

        Write(new VoiceStageTimings(0, 0, 0, 3, VoiceStageTimings.CachedPath), TimeSpan.FromMilliseconds(3), logger);

        var line = Assert.Single(logger.Lines);
        Assert.Contains(VoiceStageTimings.CachedPath, line, StringComparison.Ordinal);
    }

    private sealed class CapturingLogger : ILogger
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Lines.Add(formatter(state, exception));
        }
    }
}
