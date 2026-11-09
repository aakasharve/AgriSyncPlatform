// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 (founder D-29: a reminder's due date comes from a clear cue only, never "today by default").
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// The server's port of the phone's <c>resolveDueDate</c> (<c>core/domain/dueDateResolver.ts</c>): turn a spoken "when" into a
/// day, but ONLY for an unambiguous cue. A vague cue (नंतर, लवकर, या आठवड्यात, कधीतरी), no cue, or one the rules do not know
/// is <c>null</c> - undated, which is never late. It never invents a date and never answers "today" for nothing.
///
/// <para>Same rules, same order: an explicit day count ("३ दिवसांनी", "in 2 days"), then परवा, उद्या / tomorrow, आज / today,
/// then a named weekday (the NEXT one, strictly in the future: the same day is +7, since a farmer who wants today says आज).
/// The phone's resolver and this one are pinned to each other by one shared fixture
/// (<c>sync-contract/tests/fixtures/planned-work-due-cues.json</c>, produced by the phone's own function).</para>
/// </summary>
public static class DueHintResolver
{
    private static readonly Regex DayCount = new(@"([0-9]+)\s*(?:दिवस|day)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(250));

    private static readonly (DayOfWeek Day, string[] Markers)[] Weekdays =
    [
        (DayOfWeek.Sunday, ["रविवार", "sunday"]),
        (DayOfWeek.Monday, ["सोमवार", "monday"]),
        (DayOfWeek.Tuesday, ["मंगळवार", "tuesday"]),
        (DayOfWeek.Wednesday, ["बुधवार", "wednesday"]),
        (DayOfWeek.Thursday, ["गुरुवार", "thursday"]),
        (DayOfWeek.Friday, ["शुक्रवार", "friday"]),
        (DayOfWeek.Saturday, ["शनिवार", "saturday"]),
    ];

    /// <param name="dueHint">The spoken or typed cue (e.g. "उद्या", "३ दिवसांनी", "Friday"). Null or blank = no cue.</param>
    /// <param name="today">The reference day: the day the cue was spoken.</param>
    /// <returns>A day for a CLEAR cue; otherwise null.</returns>
    public static DateOnly? Resolve(string? dueHint, DateOnly today)
    {
        if (string.IsNullOrWhiteSpace(dueHint))
        {
            return null;
        }

        var hint = dueHint.Trim().ToLowerInvariant();

        // 1) Explicit day count: "N दिवसांनी" / "N days" / "in N days".
        var match = DayCount.Match(ToLatinDigits(hint));
        if (match.Success)
        {
            if (long.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var n)
                && AddDays(today, n) is { } counted)
            {
                return counted;
            }

            // A count too large to be a day at all is not a clear cue: undated, never a guess.
            return null;
        }

        // 2) परवा (day after tomorrow) - checked before उद्या; distinct tokens.
        if (hint.Contains("परवा", StringComparison.Ordinal))
        {
            return AddDays(today, 2);
        }

        // 3) उद्या / tomorrow.
        if (hint.Contains("उद्या", StringComparison.Ordinal) || hint.Contains("tomorrow", StringComparison.Ordinal))
        {
            return AddDays(today, 1);
        }

        // 4) आज / today.
        if (hint.Contains("आज", StringComparison.Ordinal) || hint.Contains("today", StringComparison.Ordinal))
        {
            return AddDays(today, 0);
        }

        // 5) Named weekday -> the next occurrence (strictly future; the same day is +7).
        foreach (var (day, markers) in Weekdays)
        {
            if (markers.Any(marker => hint.Contains(marker, StringComparison.Ordinal)))
            {
                var delta = ((int)day - (int)today.DayOfWeek + 7) % 7;
                return AddDays(today, delta == 0 ? 7 : delta);
            }
        }

        // Vague or unrecognised (नंतर, लवकर, या आठवड्यात, कधीतरी, ...) -> no date.
        return null;
    }

    private static DateOnly? AddDays(DateOnly day, long n)
    {
        var target = (long)day.DayNumber + n;
        return target is >= 0 and <= 3652058 ? DateOnly.FromDayNumber((int)target) : null;
    }

    /// <summary>Devanagari digits (U+0966-U+096F) to ASCII digits.</summary>
    private static string ToLatinDigits(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            sb.Append(ch is >= '०' and <= '९' ? (char)('0' + (ch - '०')) : ch);
        }

        return sb.ToString();
    }
}
