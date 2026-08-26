namespace AgriSync.BuildingBlocks.Analytics;

/// <summary>
/// Makes a client-supplied string safe to put in a log line.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> The RG5 rejection logging added in this release put
/// <c>mutationType</c>, <c>deviceId</c>, <c>clientRequestId</c> and
/// <c>appVersion</c> straight into a log message. Every one of those arrives
/// from the client. CodeQL flagged it as <i>"Log entries created from user
/// input"</i> (CWE-117) on the pull request, correctly: a client that sends a
/// value containing <c>\n</c> can append whatever it likes to the log, and what
/// it likes is a fabricated line that looks exactly like a real one.
/// </para>
/// <para>
/// That matters more here than it would almost anywhere else. These log lines
/// exist so a silent failure reaches us — they are the evidence a human reads
/// when farmer work starts being refused. Evidence an attacker can write into
/// is not evidence. Fixing the observability gap while opening a way to forge
/// the observations would have been worse than leaving the gap.
/// </para>
/// <para>
/// <b>What it does.</b> Drops every control character — newline and carriage
/// return included, which is the actual injection vector — and caps the length
/// so one field cannot flood a line. Truncation is marked, so a reader can tell
/// a shortened value from a short one. Null, empty and all-whitespace collapse
/// to an explicit marker rather than a blank that reads as "no value recorded".
/// </para>
/// <para>
/// <b>What it does NOT do.</b> It does not escape, encode or quote. A sanitised
/// value is for a human reading a log, not for round-tripping. It is also not a
/// redaction: callers stay responsible for never passing farmer content in the
/// first place — the rejection logger deliberately omits <c>ErrorMessage</c>
/// for that reason, and no sanitiser can undo logging the wrong field.
/// </para>
/// </remarks>
public static class LogSafe
{
    /// <summary>Stands in for a value that was absent or entirely whitespace.</summary>
    public const string Unknown = "unknown";

    /// <summary>Appended when a value was cut short, so short and shortened are distinguishable.</summary>
    public const string TruncationMarker = "…[cut]";

    /// <summary>
    /// Long enough for every legitimate value here — mutation names, device ids,
    /// request ids and semver strings are all well under it — and short enough
    /// that a hostile value cannot bury the rest of the line.
    /// </summary>
    public const int MaxLength = 120;

    /// <summary>
    /// Returns <paramref name="value"/> with control characters removed and the
    /// length capped, or <see cref="Unknown"/> when there is nothing to report.
    /// </summary>
    public static string Text(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return Unknown;
        }

        var span = value.AsSpan();
        var buffer = new System.Text.StringBuilder(Math.Min(span.Length, MaxLength));
        var truncated = false;

        foreach (var ch in span)
        {
            // char.IsControl covers \n, \r, \t, NUL and the rest of C0/C1 — the
            // whole family that can forge a line break or confuse a log reader.
            if (char.IsControl(ch))
            {
                continue;
            }

            if (buffer.Length == MaxLength)
            {
                truncated = true;
                break;
            }

            buffer.Append(ch);
        }

        if (buffer.Length == 0)
        {
            // The value was non-empty but every character was a control
            // character — i.e. someone was probing. Say unknown rather than
            // emit an empty field that reads as "nothing was sent".
            return Unknown;
        }

        return truncated ? buffer.Append(TruncationMarker).ToString() : buffer.ToString();
    }
}
